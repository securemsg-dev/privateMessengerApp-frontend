module.exports = {
  cacheDirectory: '/tmp/jest-cache/',
  documentDirectory: '/tmp/jest-docs/',
  readAsStringAsync: async () => '',
  writeAsStringAsync: async () => {},
  uploadAsync: async () => ({ status: 204 }),
  downloadAsync: async () => ({ status: 200, uri: '/tmp/jest-docs/x' }),
  getInfoAsync: async () => ({ exists: false }),
  makeDirectoryAsync: async () => {},
  deleteAsync: async () => {},
  EncodingType: { Base64: 'base64' },
  FileSystemUploadType: { BINARY_CONTENT: 'binary' },
};
