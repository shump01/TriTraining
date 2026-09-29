import { createHash } from "crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An in-memory stand-in for the three tables this module touches. It honours
 * the where / orderBy / take / select shapes the module actually uses, so the
 * tests below assert on the ROWS that end up stored — not on which mock
 * methods were called with what. A test that only inspects call arguments
 * passes happily when an extra `deleteMany({ where: { email } })` quietly
 * throws away someone's sign-up.
 */
const fake = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const tables: Record<"user" | "pendingSignup" | "verificationToken", Row[]> = {
    user: [],
    pendingSignup: [],
    verificationToken: [],
  };
  let seq = 0;

  const cmp = (v: unknown, cond: unknown): boolean => {
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if ("lt" in c) return (v as Date) < (c.lt as Date);
      if ("gt" in c) return (v as Date) > (c.gt as Date);
      if ("in" in c) return (c.in as unknown[]).includes(v);
      if ("startsWith" in c) return String(v).startsWith(String(c.startsWith));
    }
    return v instanceof Date && cond instanceof Date ? +v === +cond : v === cond;
  };
  const matches = (row: Row, where: Row = {}) =>
    Object.entries(where).every(([k, cond]) => cmp(row[k], cond));
  const pick = (row: Row, select?: Row) =>
    select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : { ...row };
  const sorted = (rows: Row[], orderBy?: Record<string, "asc" | "desc">) => {
    if (!orderBy) return rows;
    const [k, dir] = Object.entries(orderBy)[0]!;
    return [...rows].sort((a, b) => {
      const d = +(a[k] as Date) - +(b[k] as Date);
      return dir === "desc" ? -d : d;
    });
  };

  const model = (name: keyof typeof tables) => ({
    create: vi.fn(async ({ data, select }: { data: Row; select?: Row }) => {
      if (name === "user" && tables.user.some((u) => u.email === data.email)) {
        throw Object.assign(new Error("unique"), { code: "P2002", unique: true });
      }
      const row = { id: `${name}-${++seq}`, createdAt: new Date(1_000_000 + seq), ...data };
      tables[name].push(row);
      return pick(row, select);
    }),
    findUnique: vi.fn(async ({ where, select }: { where: Row; select?: Row }) => {
      const row = tables[name].find((r) => matches(r, where));
      return row ? pick(row, select) : null;
    }),
    findFirst: vi.fn(
      async ({
        where,
        orderBy,
        select,
      }: {
        where?: Row;
        orderBy?: Record<string, "asc" | "desc">;
        select?: Row;
      }) => {
        const row = sorted(
          tables[name].filter((r) => matches(r, where)),
          orderBy,
        )[0];
        return row ? pick(row, select) : null;
      },
    ),
    findMany: vi.fn(
      async ({
        where,
        orderBy,
        select,
        take,
      }: {
        where?: Row;
        orderBy?: Record<string, "asc" | "desc">;
        select?: Row;
        take?: number;
      }) =>
        sorted(
          tables[name].filter((r) => matches(r, where)),
          orderBy,
        )
          .slice(0, take ?? Infinity)
          .map((r) => pick(r, select)),
    ),
    deleteMany: vi.fn(async ({ where }: { where?: Row }) => {
      const before = tables[name].length;
      tables[name] = tables[name].filter((r) => !matches(r, where));
      return { count: before - tables[name].length };
    }),
  });

  const db = {
    user: model("user"),
    pendingSignup: model("pendingSignup"),
    verificationToken: model("verificationToken"),
    $transaction: vi.fn(async (arg: unknown) =>
      typeof arg === "function"
        ? (arg as (tx: unknown) => unknown)(db)
        : Promise.all(arg as unknown[]),
    ),
  };
  const reset = () => {
    tables.user = [];
    tables.pendingSignup = [];
    tables.verificationToken = [];
    seq = 0;
  };
  return { db, tables, reset };
});

vi.mock("@/lib/prisma", () => ({ prisma: fake.db }));
// A readable stand-in for argon2: a "hash" is h(<password>).
const verifyPassword = vi.hoisted(() =>
  vi.fn(async (hash: string | null | undefined, pw: string) => hash === `h(${pw})`),
);
vi.mock("@/lib/password", () => ({ verifyPassword }));
// The fake's unique violation, recognised the way the module recognises Prisma's.
vi.mock("@/generated/prisma/client", () => ({
  Prisma: {
    PrismaClientKnownRequestError: class {
      static [Symbol.hasInstance](e: unknown) {
        return Boolean((e as { unique?: boolean })?.unique);
      }
    },
  },
}));

import {
  MAX_LIVE_SIGNUPS_PER_EMAIL,
  SIGNUP_TTL_MS,
  clearPendingSignups,
  confirmSignup,
  discardSignupAttempt,
  issueSignupToken,
  newestPendingSignupHash,
  startSignup,
  trimSignupAttempts,
} from "@/lib/signup-verification";

const NOW = new Date("2026-09-29T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const at = (ms: number) => new Date(NOW.getTime() + ms);
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const { tables } = fake;

async function begin(email: string, password: string, when = NOW) {
  const r = await startSignup(email, `h(${password})`, when);
  if (r.kind !== "pending") throw new Error("expected a pending sign-up");
  return r;
}

beforeEach(() => {
  fake.reset();
  vi.clearAllMocks();
});

describe("startSignup", () => {
  it("NEVER creates a User — on either branch", async () => {
    await begin("new@example.com", "pw");
    tables.user.push({ id: "u", email: "owner@example.com" });
    await startSignup("owner@example.com", "h(pw)", NOW);

    // The whole point of the feature: an account exists only after confirming.
    expect(fake.db.user.create).not.toHaveBeenCalled();
    expect(tables.user).toHaveLength(1);
  });

  it("stores nothing for an address that already has an account", async () => {
    tables.user.push({ id: "u", email: "owner@example.com" });

    await expect(startSignup("Owner@Example.com", "h(pw)", NOW)).resolves.toEqual({
      kind: "existing",
    });
    expect(tables.pendingSignup).toHaveLength(0);
    expect(tables.verificationToken).toHaveLength(0);
  });

  it("records the attempt and stores only the HASH of the emailed token", async () => {
    const r = await begin("New@Example.com", "pw");

    expect(tables.pendingSignup).toEqual([
      expect.objectContaining({
        id: r.attemptId,
        email: "new@example.com",
        passwordHash: "h(pw)",
        expires: at(SIGNUP_TTL_MS),
      }),
    ]);
    expect(tables.verificationToken).toEqual([
      {
        identifier: "signup:new@example.com",
        token: sha(r.rawToken),
        expires: at(SIGNUP_TTL_MS),
        id: expect.any(String),
        createdAt: expect.any(Date),
      },
    ]);
    expect(JSON.stringify(tables)).not.toContain(r.rawToken);
    expect(r.expires).toEqual(at(SIGNUP_TTL_MS));
  });

  it("never overwrites an attempt or rotates a link — a re-signup adds to both", async () => {
    const first = await begin("a@example.com", "first");
    const second = await begin("a@example.com", "second");

    expect(tables.pendingSignup.map((r) => r.passwordHash)).toEqual(["h(first)", "h(second)"]);
    expect(tables.verificationToken.map((r) => r.token)).toEqual([
      sha(first.rawToken),
      sha(second.rawToken),
    ]);
  });

  it("does NOT trim — an attempt is only evicted once the new one's email has gone out", async () => {
    // Trimming here evicted an older attempt before knowing whether the new
    // one would survive; a failed send then left the address one poorer.
    for (let i = 0; i < MAX_LIVE_SIGNUPS_PER_EMAIL + 2; i++) await begin("a@example.com", `p${i}`);
    expect(tables.pendingSignup).toHaveLength(MAX_LIVE_SIGNUPS_PER_EMAIL + 2);
  });

  it("sweeps expired attempts AND expired sign-up links — and nothing else", async () => {
    tables.pendingSignup.push({
      id: "old",
      email: "gone@example.com",
      passwordHash: "h",
      expires: at(-1),
      createdAt: at(-SIGNUP_TTL_MS),
    });
    tables.verificationToken.push(
      { identifier: "signup:gone@example.com", token: "t1", expires: at(-1) },
      // Not ours to sweep: a password-reset link, even an expired one.
      { identifier: "pwreset:x@example.com", token: "t2", expires: at(-1) },
      { identifier: "signup:live@example.com", token: "t3", expires: at(HOUR) },
    );

    await begin("new@example.com", "pw");

    expect(tables.pendingSignup.map((r) => r.id)).not.toContain("old");
    const tokens = tables.verificationToken.map((r) => r.token);
    expect(tokens).not.toContain("t1");
    expect(tokens).toContain("t2");
    expect(tokens).toContain("t3");
  });
});

describe("confirmSignup", () => {
  it("rejects an unknown link", async () => {
    await expect(confirmSignup("nope", "pw", NOW)).resolves.toEqual({ status: "invalid_token" });
  });

  it("REGRESSION: the link alone cannot create an account — the password is required", async () => {
    // An attacker signed up with the victim's address. The victim, holding the
    // emailed link, clicks it but types something else. Before this design a
    // click was enough — and stamped emailVerified on the ATTACKER's password,
    // switching off the Apple/Google anti-squatting rule for good.
    const r = await begin("victim@example.com", "attacker");

    await expect(confirmSignup(r.rawToken, "whatever-the-victim-types", NOW)).resolves.toEqual({
      status: "wrong_password",
    });
    expect(tables.user).toHaveLength(0);
  });

  it("does not burn the link on a wrong password — the owner may have mistyped", async () => {
    const r = await begin("a@example.com", "right");

    await confirmSignup(r.rawToken, "wrong", NOW);

    expect(tables.pendingSignup).toHaveLength(1);
    expect(tables.verificationToken).toHaveLength(1);
    await expect(confirmSignup(r.rawToken, "right", NOW)).resolves.toMatchObject({
      status: "created",
    });
  });

  it("creates the account with the password the CONFIRMER chose, via any live link", async () => {
    // The victim signs up; an attacker then signs up the same address. The
    // victim clicks the attacker's (newer) email but types their own password.
    await begin("victim@example.com", "victim");
    const attackers = await begin("victim@example.com", "attacker");

    const result = await confirmSignup(attackers.rawToken, "victim", NOW);

    expect(result).toMatchObject({ status: "created" });
    expect(tables.user).toEqual([
      expect.objectContaining({
        email: "victim@example.com",
        passwordHash: "h(victim)",
        emailVerified: NOW,
      }),
    ]);
  });

  it("retires every attempt and link for the address — and only that address", async () => {
    const r = await begin("a@example.com", "pw");
    await begin("a@example.com", "other");
    await begin("b@example.com", "pw");

    await confirmSignup(r.rawToken, "pw", NOW);

    expect(tables.pendingSignup.map((row) => row.email)).toEqual(["b@example.com"]);
    expect(tables.verificationToken.map((row) => row.identifier)).toEqual(["signup:b@example.com"]);
  });

  it("never touches an account that appeared meanwhile — least of all giving it a password", async () => {
    const r = await begin("a@example.com", "pw");
    // An Apple/Google sign-in created the account after the sign-up began.
    tables.user.push({ id: "oauth-user", email: "a@example.com", passwordHash: null });

    await expect(confirmSignup(r.rawToken, "pw", NOW)).resolves.toEqual({
      status: "already_registered",
    });
    expect(tables.user).toEqual([{ id: "oauth-user", email: "a@example.com", passwordHash: null }]);
    expect(tables.pendingSignup).toHaveLength(0);
  });

  it("maps a unique-violation race to already_registered", async () => {
    const r = await begin("a@example.com", "pw");
    // The account lands between confirm's check and its create.
    fake.db.user.findUnique.mockResolvedValueOnce(null);
    tables.user.push({ id: "raced", email: "a@example.com" });

    await expect(confirmSignup(r.rawToken, "pw", NOW)).resolves.toEqual({
      status: "already_registered",
    });
  });

  it("refuses an expired link, and a live link whose attempts have all expired", async () => {
    const r = await begin("a@example.com", "pw");
    await expect(confirmSignup(r.rawToken, "pw", at(SIGNUP_TTL_MS + 1))).resolves.toEqual({
      status: "invalid_token",
    });
  });

  it("bounds the argon2 work to the live-attempt cap", async () => {
    let r;
    for (let i = 0; i < MAX_LIVE_SIGNUPS_PER_EMAIL + 3; i++)
      r = await begin("a@example.com", `p${i}`);
    verifyPassword.mockClear();

    await confirmSignup(r!.rawToken, "nobody", NOW);

    expect(verifyPassword).toHaveBeenCalledTimes(MAX_LIVE_SIGNUPS_PER_EMAIL);
  });
});

describe("issueSignupToken", () => {
  it("mints nothing for an address with an account, or with nothing pending", async () => {
    tables.user.push({ id: "u", email: "owner@example.com" });
    await expect(issueSignupToken("owner@example.com", NOW)).resolves.toBeNull();
    await expect(issueSignupToken("stranger@example.com", NOW)).resolves.toBeNull();
    expect(tables.verificationToken).toHaveLength(0);
  });

  it("mints a fresh link WITHOUT invalidating earlier ones", async () => {
    const r = await begin("a@example.com", "pw");

    const issued = await issueSignupToken("A@Example.com", at(HOUR));

    expect(issued?.rawToken).toEqual(expect.any(String));
    expect(tables.verificationToken).toHaveLength(2);
    // The ORIGINAL link still confirms.
    await expect(confirmSignup(r.rawToken, "pw", at(2 * HOUR))).resolves.toMatchObject({
      status: "created",
    });
  });

  it("expires the new link WITH the sign-up it confirms, not 24h after the resend", async () => {
    await begin("a@example.com", "pw");

    // Re-sent at 23h: the attempt dies at 24h, so the link must too — a link
    // that says "works for 24 hours" and is dead an hour later is a lie.
    const issued = await issueSignupToken("a@example.com", at(23 * HOUR));

    expect(issued?.expires).toEqual(at(SIGNUP_TTL_MS));
    // ...and the attempt itself was NOT extended (resend is anonymous: anyone
    // could otherwise keep someone else's attempt alive indefinitely).
    expect(tables.pendingSignup[0]!.expires).toEqual(at(SIGNUP_TTL_MS));
  });
});

describe("trimSignupAttempts", () => {
  it("keeps only the newest few live attempts per address", async () => {
    for (let i = 0; i < MAX_LIVE_SIGNUPS_PER_EMAIL + 2; i++) await begin("a@example.com", `p${i}`);
    await begin("b@example.com", "other");

    await trimSignupAttempts("A@Example.com", NOW);

    expect(
      tables.pendingSignup.filter((r) => r.email === "a@example.com").map((r) => r.passwordHash),
    ).toEqual(["p2", "p3", "p4", "p5", "p6"].map((p) => `h(${p})`));
    // Other addresses are untouched.
    expect(tables.pendingSignup.filter((r) => r.email === "b@example.com")).toHaveLength(1);
  });
});

describe("discardSignupAttempt", () => {
  it("removes exactly the attempt and link whose email failed to send", async () => {
    const kept = await begin("a@example.com", "kept");
    const failed = await begin("a@example.com", "failed");

    await discardSignupAttempt("A@Example.com", failed);

    expect(tables.pendingSignup.map((r) => r.passwordHash)).toEqual(["h(kept)"]);
    expect(tables.verificationToken.map((r) => r.token)).toEqual([sha(kept.rawToken)]);
  });
});

describe("clearPendingSignups / newestPendingSignupHash", () => {
  it("clears one address's attempts and links, leaving others", async () => {
    await begin("a@example.com", "pw");
    await begin("b@example.com", "pw");

    await clearPendingSignups("A@Example.com");

    expect(tables.pendingSignup.map((r) => r.email)).toEqual(["b@example.com"]);
    expect(tables.verificationToken.map((r) => r.identifier)).toEqual(["signup:b@example.com"]);
  });

  it("returns the newest LIVE attempt's hash", async () => {
    await begin("a@example.com", "older");
    await begin("a@example.com", "newest");

    await expect(newestPendingSignupHash("A@Example.com", NOW)).resolves.toBe("h(newest)");
    await expect(
      newestPendingSignupHash("a@example.com", at(SIGNUP_TTL_MS + 1)),
    ).resolves.toBeNull();
  });
});
