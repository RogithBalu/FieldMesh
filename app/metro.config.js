const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * This app lives in a pnpm workspace, so its dependencies are symlinks into a
 * store at the monorepo root rather than real directories under app/. Metro
 * only walks node_modules folders it is told about, so without these it fails
 * to resolve packages that exist and that Node resolves fine.
 *
 * @type {import('metro-config').MetroConfig}
 */
const workspaceRoot = path.resolve(__dirname, '..');

const config = {
  // Metro must watch the store, or edits and resolutions there are invisible.
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
