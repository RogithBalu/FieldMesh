/**
 * Yjs (through lib0) takes `getRandomValues` from isomorphic-webcrypto on
 * React Native, and that implementation throws until its asynchronous
 * `ensureSecure()` has settled. On a cold offline launch the cached checklist
 * creates its Y.Doc right after those modules load, before that promise
 * resolves, and the render crashed the app ("You must wait until the library
 * is secure"). react-native-get-random-values (imported before this module)
 * installs a synchronous, natively seeded `crypto.getRandomValues`, so hand
 * that to isomorphic-webcrypto before lib0 binds the function.
 */
import webcrypto from 'isomorphic-webcrypto/src/react-native';

const native = globalThis.crypto?.getRandomValues;
if (typeof native === 'function') {
  webcrypto.getRandomValues = (array: ArrayBufferView) => native.call(globalThis.crypto, array as never) as ArrayBufferView;
}
