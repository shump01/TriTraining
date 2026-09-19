/**
 * Mint the Sign in with Apple client secret Auth.js needs as AUTH_APPLE_SECRET.
 *
 *   node scripts/apple-client-secret.mts \
 *     --team-id VG8MTG2SWP \
 *     --key-id ABC123DEFG \
 *     --client-id uk.co.richysdev.tritrainer.web \
 *     --key ~/Downloads/AuthKey_ABC123DEFG.p8
 *
 * Prints one JWT. Paste it into the host's AUTH_APPLE_SECRET (never commit
 * it, never commit the .p8). Apple accepts it for at most six months — this
 * mints 180 days, so put a reminder five months out and run it again.
 * Runs on Node ≥ 22.18 (TypeScript type stripping) with the repo's jose.
 */
import { readFileSync } from "node:fs";

import { makeAppleClientSecret } from "../src/lib/apple-client-secret.ts";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  if (!value) {
    console.error(
      `Missing --${name}. Usage: --team-id T --key-id K --client-id C --key path.p8 [--days N]`,
    );
    process.exit(1);
  }
  return value;
}

const daysArg = process.argv.indexOf("--days");
const days = daysArg >= 0 ? Number(process.argv[daysArg + 1]) : undefined;

const jwt = await makeAppleClientSecret({
  teamId: arg("team-id"),
  keyId: arg("key-id"),
  clientId: arg("client-id"),
  privateKeyPem: readFileSync(arg("key"), "utf8"),
  days,
});
process.stdout.write(jwt + "\n");
