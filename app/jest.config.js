const path = require('path');

// lib0 is a transitive dependency of yjs, so under pnpm it is not resolvable by
// name from this package; resolve it through yjs, which does depend on it.
// lib0's own "exports" map hides dist/, so build the path from its package root.
const lib0Root = path.dirname(
  require.resolve('lib0/package.json', {
    paths: [path.dirname(require.resolve('yjs/package.json'))],
  }),
);
const lib0BrowserWebcrypto = path.join(lib0Root, 'dist', 'webcrypto.cjs');

module.exports = {
  preset: 'react-native',
  transformIgnorePatterns: [
    'node_modules/(?!(.pnpm|react-native|@react-native|yjs|lib0|react-native-tcp-socket)/)',
    '\\.pnpm/(?!(react-native|@react-native|yjs|lib0|react-native-tcp-socket))',
  ],
  testPathIgnorePatterns: ['/node_modules/', '__mocks__'],
  haste: {
    defaultPlatform: 'ios',
    platforms: ['android', 'ios', 'native'],
  },
  // Installs a global crypto, exactly as react-native-get-random-values does on
  // device, so lib0 takes the same path here as in the app.
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    // Jest's react-native preset picks lib0's react-native build, which needs
    // isomorphic-webcrypto. Metro resolves the browser build instead, so point
    // tests at that one and let them exercise lib0's real code against the
    // polyfilled global crypto rather than a stand-in.
    '^lib0/webcrypto$': lib0BrowserWebcrypto,
  },
};
