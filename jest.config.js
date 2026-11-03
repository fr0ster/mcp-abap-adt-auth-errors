module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  // Moving to node:test: a file listed here runs under `node --test` instead.
  testPathIgnorePatterns: [
    '/node_modules/',
    '/src/__tests__/ok.test.ts',
    '/src/__tests__/numbers.test.ts',
    '/src/__tests__/readme.test.ts',
    '/src/__tests__/tables.test.ts',
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/__tests__/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          esModuleInterop: true,
        },
      },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!(.*\\.mjs$))'],
  verbose: true,
  maxWorkers: '50%',
  maxConcurrency: 5,
};
