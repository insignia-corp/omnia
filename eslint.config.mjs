import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist", "coverage", "drizzle", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // Regra inviolável 2: dinheiro em centavos inteiros. Use src/lib/dinheiro.
      "no-restricted-globals": [
        "error",
        { name: "parseFloat", message: "Use parseCentavos de src/lib/dinheiro." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Number", property: "parseFloat", message: "Use parseCentavos de src/lib/dinheiro." },
      ],
    },
  },
  {
    files: ["**/*.spec.ts", "tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  { files: ["**/*.mjs", "**/*.js"], ...tseslint.configs.disableTypeChecked },
  {
    files: ["**/*.js"],
    languageOptions: { sourceType: "commonjs", globals: { module: "writable", require: "readonly" } },
  },
  prettier,
);
