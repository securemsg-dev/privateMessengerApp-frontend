// Minimal stub — slice tests never touch the real DB (initDB is not called,
// so services/database.ts helpers all early-return on the null handle).
module.exports = {
  openDatabaseAsync: async () => {
    throw new Error('expo-sqlite is not available in unit tests');
  },
};
