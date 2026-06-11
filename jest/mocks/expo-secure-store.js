// In-memory stand-in for the iOS Keychain / Android Keystore.
const store = new Map();

module.exports = {
  getItemAsync: async (key) => (store.has(key) ? store.get(key) : null),
  setItemAsync: async (key, value) => {
    store.set(key, value);
  },
  deleteItemAsync: async (key) => {
    store.delete(key);
  },
  __reset: () => store.clear(),
};
