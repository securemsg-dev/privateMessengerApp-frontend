/**
 * Unit-test config — pure logic only (crypto, Redux slices, utils).
 * Runs in Node with Expo/React Native native modules mapped to lightweight
 * mocks (see jest/mocks/). Component/UI testing would need jest-expo instead.
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^react-native$': '<rootDir>/jest/mocks/react-native.js',
    '^expo-crypto$': '<rootDir>/jest/mocks/expo-crypto.js',
    '^expo-secure-store$': '<rootDir>/jest/mocks/expo-secure-store.js',
    '^expo-sqlite$': '<rootDir>/jest/mocks/expo-sqlite.js',
    '^expo-constants$': '<rootDir>/jest/mocks/expo-constants.js',
    '^expo-file-system$': '<rootDir>/jest/mocks/expo-file-system.js',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          jsx: 'react-jsx',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },
};
