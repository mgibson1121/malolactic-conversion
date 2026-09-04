import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/tests/**/*.test.ts',
    '**/modules/**/*.test.ts',
    // Phase 10.5 — db/migrate.test.ts was never matched by any of the three
    // patterns above (not under __tests__/, tests/, or modules/) and so was
    // silently never run by `npm test` or CI. Adding it here rather than
    // moving the test file, since db/ is where migrate.ts itself lives.
    '**/db/**/*.test.ts',
  ],
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/../shared/$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
  setupFiles: ['<rootDir>/tests/setup.ts'],
  clearMocks: true,
}

export default config
