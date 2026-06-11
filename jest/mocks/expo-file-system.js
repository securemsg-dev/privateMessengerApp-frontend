module.exports = {
  cacheDirectory: '/tmp/jest-cache/',
  readAsStringAsync: async () => '',
  writeAsStringAsync: async () => {},
  uploadAsync: async () => ({ status: 204 }),
  getInfoAsync: async () => ({ exists: false }),
  makeDirectoryAsync: async () => {},
  EncodingType: { Base64: 'base64' },
  FileSystemUploadType: { BINARY_CONTENT: 'binary' },
};
