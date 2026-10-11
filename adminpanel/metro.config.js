// Expo's default Metro config, plus one fix for three.js on phones.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// three >= 0.186 replaced its CommonJS build with a stub that calls process.emitWarning, which
// doesn't exist in React Native ("undefined is not a function"). React Three Fiber's native build
// require()s three, so send every import of three to the ES module build instead.
const threeModule = path.join(path.dirname(require.resolve('three')), 'three.module.js');
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'three') return { type: 'sourceFile', filePath: threeModule };
  return (resolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
