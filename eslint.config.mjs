import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import eslintConfigPrettier from "eslint-config-prettier";

/**
 * ESLint flat config (Next.js 16 removed the built-in `next lint` command, so
 * we run the `eslint` CLI directly). We consume `eslint-config-next`'s native
 * flat-config arrays and disable any stylistic rules that conflict with
 * Prettier via `eslint-config-prettier`.
 */
const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Generated Prisma client — not ours to lint.
      "src/generated/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  eslintConfigPrettier,
];

export default eslintConfig;
