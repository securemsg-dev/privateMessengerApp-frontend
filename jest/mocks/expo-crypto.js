const { randomBytes } = require('crypto');

module.exports = {
  getRandomBytes: (n) => Uint8Array.from(randomBytes(n)),
};
