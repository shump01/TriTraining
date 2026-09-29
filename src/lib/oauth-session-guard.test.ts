import { Auth } from "@auth/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sessionFindMany, sessionDeleteMany } = vi.hoisted(() => ({
  sessionFindMany: vi.fn(),
  sessionDeleteMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { session: { findMany: sessionFindMany, deleteMany: sessionDeleteMany } },
}));

import { guardProviderCallback, sessionTokenCandidates } from "./oauth-session-guard";

// NODE_ENV is "test", so the session cookie has no __Secure- prefix.
const NAME = "authjs.session-token";
const NOW = new Date("2026-09-29T12:00:00.000Z");
const LIVE = new Date("2026-10-29T12:00:00.000Z");
const EXPIRED = new Date("2026-09-01T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  sessionFindMany.mockResolvedValue([]);
  sessionDeleteMany.mockResolvedValue({ count: 0 });
});

describe("sessionTokenCandidates", () => {
  it("finds nothing without a session cookie", () => {
    expect(sessionTokenCandidates(null)).toEqual([]);
    expect(sessionTokenCandidates("")).toEqual([]);
    expect(sessionTokenCandidates("theme=dark; other=1")).toEqual([]);
  });

  it("reads the plain session cookie", () => {
    expect(sessionTokenCandidates(`theme=dark; ${NAME}=tok-x`)).toEqual(["tok-x"]);
  });

  it("joins chunks in suffix order, as Auth.js's SessionStore does", () => {
    // Someone writing their own Cookie header can split a token so that no
    // cookie is called exactly NAME — Auth.js still reassembles it.
    const candidates = sessionTokenCandidates(`${NAME}.1=second; ${NAME}.0=first`);
    expect(candidates).toContain("firstsecond");
  });

  it("keeps the FIRST duplicate for the join, but offers every duplicate", () => {
    // Auth.js's parser keeps the first; Next's cookies() keeps the last.
    const candidates = sessionTokenCandidates(`${NAME}=tok-x; ${NAME}=tok-y`);
    expect(candidates).toEqual(expect.arrayContaining(["tok-x", "tok-y"]));
    expect(candidates).not.toContain("tok-xtok-y");
  });

  it("lets an empty first duplicate hide the rest from the join, as Auth.js does", () => {
    const candidates = sessionTokenCandidates(`${NAME}.0=; ${NAME}.0=a; ${NAME}.1=b`);
    expect(candidates).toContain("b");
    expect(candidates).not.toContain("ab");
  });

  it("trims spaces and tabs only, and URL-decodes like Auth.js", () => {
    expect(sessionTokenCandidates(`a=1;\t${NAME} = tok%2Dx ;b=2`)).toEqual(["tok-x"]);
    // Any other whitespace is part of the name, so it is not the session cookie.
    expect(sessionTokenCandidates(`\v${NAME}=tok-v`)).toEqual([]);
    // A malformed escape is kept raw rather than dropped.
    expect(sessionTokenCandidates(`${NAME}=tok%zz`)).toEqual(["tok%zz"]);
  });
});

/** The session token Auth.js itself resolves from a Cookie header, via its public API. */
async function tokenAuthJsReads(cookieHeader: string): Promise<string | null> {
  let seen: string | null = null;
  const none = async () => null;
  const adapter = {
    createUser: none,
    getUser: none,
    getUserByEmail: none,
    getUserByAccount: none,
    updateUser: none,
    linkAccount: none,
    createSession: none,
    updateSession: none,
    deleteSession: none,
    createVerificationToken: none,
    useVerificationToken: none,
    getSessionAndUser: async (token: string) => {
      seen = token;
      return null;
    },
  };
  await Auth(
    new Request("http://localhost/api/auth/session", { headers: { cookie: cookieHeader } }),
    {
      adapter: adapter as never,
      providers: [],
      secret: "test-secret",
      trustHost: true,
      basePath: "/api/auth",
      session: { strategy: "database" },
      logger: { error: () => {}, warn: () => {}, debug: () => {} },
    },
  );
  return seen;
}

describe("sessionTokenCandidates against Auth.js itself", () => {
  // If an Auth.js upgrade changes how it reads the cookie, this fails first.
  it.each([
    `${NAME}=tok-x`,
    `${NAME}=tok-x; ${NAME}=tok-y`,
    `${NAME}.1=second; ${NAME}.0=first`,
    `${NAME}.0=; ${NAME}.0=a; ${NAME}.1=b`,
    `${NAME}=whole; ${NAME}.0=a; ${NAME}.1=b`,
    `a=1;\t${NAME} = tok%2Dx ;b=2`,
    `${NAME}=tok%zz`,
    `\v${NAME}=tok-v; ${NAME}.2=c`,
    `${NAME}X=odd; ${NAME}.10=j; ${NAME}.9=i`,
    `junk; ${NAME}=after-junk`,
    `${NAME}="quoted"`,
    `=; ${NAME}=x=y=z`,
  ])("includes the token Auth.js reads from %j", async (header) => {
    const expected = await tokenAuthJsReads(header);
    expect(expected).toBeTruthy();
    expect(sessionTokenCandidates(header)).toContain(expected);
  });
});

describe("guardProviderCallback", () => {
  it("proceeds without touching the database when there is no session cookie", async () => {
    expect(await guardProviderCallback("theme=dark", "owner@example.com", NOW)).toBe("proceed");
    expect(sessionFindMany).not.toHaveBeenCalled();
  });

  it("proceeds when the cookie names no session we have", async () => {
    expect(await guardProviderCallback(`${NAME}=stale`, "owner@example.com", NOW)).toBe("proceed");
    expect(sessionDeleteMany).not.toHaveBeenCalled();
  });

  it("REFUSES a sign-in made while signed in as a different address, and links nothing", async () => {
    // The attack: signed in to the squatted victim@example.com row, clicking
    // "Continue with Google" as attacker@gmail.com.
    sessionFindMany.mockResolvedValue([
      { id: "s-x", expires: LIVE, user: { email: "victim@example.com" } },
    ]);

    const verdict = await guardProviderCallback(`${NAME}=tok-x`, "attacker@gmail.com", NOW);

    expect(verdict).toBe("refuse");
    expect(sessionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sessionToken: { in: ["tok-x"] } } }),
    );
    // The athlete stays signed in as they were; nothing is changed.
    expect(sessionDeleteMany).not.toHaveBeenCalled();
  });

  it("refuses when the provider sent no address at all", async () => {
    sessionFindMany.mockResolvedValue([
      { id: "s-x", expires: LIVE, user: { email: "victim@example.com" } },
    ]);
    expect(await guardProviderCallback(`${NAME}=tok-x`, undefined, NOW)).toBe("refuse");
  });

  it("refuses when ANY session the cookie could mean belongs to another address", async () => {
    // Duplicates: Auth.js would use tok-x (first), cookies() would show tok-y.
    sessionFindMany.mockResolvedValue([
      { id: "s-x", expires: LIVE, user: { email: "victim@example.com" } },
      { id: "s-y", expires: LIVE, user: { email: "attacker@gmail.com" } },
    ]);

    const verdict = await guardProviderCallback(
      `${NAME}=tok-x; ${NAME}=tok-y`,
      "attacker@gmail.com",
      NOW,
    );

    expect(verdict).toBe("refuse");
    expect(sessionFindMany.mock.calls[0]![0].where.sessionToken.in).toEqual(
      expect.arrayContaining(["tok-x", "tok-y"]),
    );
  });

  it("looks up a chunked token whole", async () => {
    sessionFindMany.mockResolvedValue([
      { id: "s-x", expires: LIVE, user: { email: "victim@example.com" } },
    ]);

    const verdict = await guardProviderCallback(
      `${NAME}.0=tok-; ${NAME}.1=x`,
      "attacker@gmail.com",
      NOW,
    );

    expect(verdict).toBe("refuse");
    expect(sessionFindMany.mock.calls[0]![0].where.sessionToken.in).toContain("tok-x");
  });

  it("signs a same-address session out so Auth.js takes its signed-out path", async () => {
    sessionFindMany.mockResolvedValue([
      { id: "s-o", expires: LIVE, user: { email: "Owner@Example.com" } },
    ]);

    const verdict = await guardProviderCallback(`${NAME}=tok-o`, "owner@example.com", NOW);

    expect(verdict).toBe("proceed");
    expect(sessionDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ["s-o"] } } });
  });

  it("deletes an expired session of another address rather than refusing", async () => {
    // Auth.js would still link into it (it never checks expiry), so it must
    // go — but it no longer signs anyone in, so there is nothing to refuse.
    sessionFindMany.mockResolvedValue([
      { id: "s-x", expires: EXPIRED, user: { email: "victim@example.com" } },
    ]);

    const verdict = await guardProviderCallback(`${NAME}=tok-x`, "attacker@gmail.com", NOW);

    expect(verdict).toBe("proceed");
    expect(sessionDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ["s-x"] } } });
  });

  it("fails closed when the lookup fails", async () => {
    sessionFindMany.mockRejectedValue(new Error("db down"));
    await expect(guardProviderCallback(`${NAME}=tok-x`, "attacker@gmail.com", NOW)).rejects.toThrow(
      "db down",
    );
  });
});
