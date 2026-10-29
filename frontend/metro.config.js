const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Watch the shared customer-display package for live reload during development
config.watchFolders = [path.resolve(__dirname, '../packages/customer-display')];

// mssql / express / etc. are Node.js-only packages that use `import.meta`.
// They cannot be bundled by Metro for web/RN → stub them out.
const STUB = path.resolve(__dirname, 'shims/empty-module.js');
config.resolver.sourceExts.push('mjs');

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  mssql: STUB,
  express: STUB,
  'body-parser': STUB,
  cors: STUB,
  dotenv: STUB,
  tedious: STUB,
  '@unipro/customer-display': path.resolve(__dirname, '../packages/customer-display'),
  // Monorepo peer dependency mappings
  react: path.resolve(__dirname, 'node_modules/react'),
  'react-native': path.resolve(__dirname, 'node_modules/react-native'),
  'react-native-web': path.resolve(__dirname, 'node_modules/react-native-web'),
  zustand: path.resolve(__dirname, 'node_modules/zustand'),
  'socket.io-client': path.resolve(__dirname, 'node_modules/socket.io-client'),
  'react-native-svg': path.resolve(__dirname, 'node_modules/react-native-svg'),
  'react-native-qrcode-svg': path.resolve(__dirname, 'node_modules/react-native-qrcode-svg'),
  '@expo/vector-icons': path.resolve(__dirname, 'node_modules/@expo/vector-icons'),
  '@react-native-async-storage/async-storage': path.resolve(__dirname, 'node_modules/@react-native-async-storage/async-storage'),
  'expo-router': path.resolve(__dirname, 'node_modules/expo-router'),
};

config.resolver.unstable_enablePackageExports = false;


config.resolver.resolverMainFields = ['react-native', 'browser', 'main'];

config.resolver.blockList = [
  ...(config.resolver.blockList || []),
  new RegExp(path.resolve(__dirname, 'dist').replace(/[/\\]/g, '[/\\\\]') + '.*'),
];

module.exports = config;
