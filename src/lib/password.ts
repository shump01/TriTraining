import { hash, verify } from "@node-rs/argon2";

/**
 * argon2id parameters (OWASP-recommended baseline). argon2id is memory-hard and
 * resistant to both GPU and side-channel attacks.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * A real argon2 hash verified against unknown users so that the "no such user"
 * code path costs the same as a genuine password check — defeating timing-based
 * user enumeration.
 */
let dummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHash ??= hash("timing-equalizer-not-a-real-password", ARGON2_OPTIONS);
  return dummyHash;
}

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, ARGON2_OPTIONS);
}

/**
 * Verify a plaintext password against a stored hash. When `storedHash` is
 * null/undefined (user not found, or OAuth-only user), a dummy verification is
 * still performed to keep response timing constant.
 */
export async function verifyPassword(
  storedHash: string | null | undefined,
  plaintext: string,
): Promise<boolean> {
  if (!storedHash) {
    await verify(await getDummyHash(), plaintext).catch(() => false);
    return false;
  }
  try {
    return await verify(storedHash, plaintext);
  } catch {
    return false;
  }
}
