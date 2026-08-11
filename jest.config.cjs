module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  setupFiles: ["<rootDir>/tests/jest.setup.cjs"],
  transform: {
    "^.+\\.ts$": ["ts-jest", {
      tsconfig: {
        types: ["node", "jest"],
        isolatedModules: true,
      },
    }],
  },
};
