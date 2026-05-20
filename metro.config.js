const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite uses wa-sqlite (WebAssembly) for web support.
// Metro doesn't handle .wasm files by default — add it as an asset extension.
config.resolver.assetExts.push('wasm');

module.exports = config;
