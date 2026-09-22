/**
 * @format
 */

// Must come before anything that pulls in yjs: Yjs mints a client ID via
// lib0/random -> crypto.getRandomValues in Doc's constructor, and Hermes has no
// global crypto, so `new Y.Doc()` throws without this polyfill.
import 'react-native-get-random-values';

import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

AppRegistry.registerComponent(appName, () => App);
