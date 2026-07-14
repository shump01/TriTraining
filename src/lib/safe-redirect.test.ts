import { describe, expect, it } from "vitest";

import { safeCallbackPath } from "@/lib/safe-redirect";

describe("safeCallbackPath", () => {
  it("accepts a normal same-origin path (with query + fragment)", () => {
    expect(safeCallbackPath("/dashboard")).toBe("/dashboard");
    expect(safeCallbackPath("/plans/abc123/edit")).toBe("/plans/abc123/edit");
    expect(safeCallbackPath("/groups/join/tok?x=1#top")).toBe("/groups/join/tok?x=1#top");
  });

  it("falls back for empty / nullish input", () => {
    expect(safeCallbackPath(undefined)).toBe("/dashboard");
    expect(safeCallbackPath(null)).toBe("/dashboard");
    expect(safeCallbackPath("")).toBe("/dashboard");
  });

  it("rejects absolute URLs (open redirect)", () => {
    expect(safeCallbackPath("https://evil.com")).toBe("/dashboard");
    expect(safeCallbackPath("http://evil.com/path")).toBe("/dashboard");
  });

  it("rejects protocol-relative URLs", () => {
    expect(safeCallbackPath("//evil.com")).toBe("/dashboard");
    expect(safeCallbackPath("/\\evil.com")).toBe("/dashboard");
  });

  it("rejects the javascript: / data: schemes", () => {
    expect(safeCallbackPath("javascript:alert(1)")).toBe("/dashboard");
    expect(safeCallbackPath("data:text/html,<script>1</script>")).toBe("/dashboard");
  });

  it("rejects back-slash and control/whitespace smuggling", () => {
    expect(safeCallbackPath("/foo\\bar")).toBe("/dashboard");
    expect(safeCallbackPath("/\tjavascript:alert(1)")).toBe("/dashboard");
    expect(safeCallbackPath("/foo\nbar")).toBe("/dashboard");
    expect(safeCallbackPath("/ /evil.com")).toBe("/dashboard");
  });

  it("honors a custom fallback", () => {
    expect(safeCallbackPath("https://evil.com", "/login")).toBe("/login");
  });
});
