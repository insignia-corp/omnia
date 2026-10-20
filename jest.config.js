/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.json" }] },
  moduleFileExtensions: ["ts", "js", "json"],
  testMatch: ["<rootDir>/src/**/*.spec.ts"],
  collectCoverageFrom: ["src/**/*.ts", "!src/main.ts"],
};
