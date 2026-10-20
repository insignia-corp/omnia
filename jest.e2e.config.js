/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.json" }] },
  testMatch: ["<rootDir>/tests/**/*.e2e-spec.ts"],
  testTimeout: 30000,
};
