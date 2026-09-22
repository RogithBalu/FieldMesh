// Mirrors what react-native-get-random-values does in index.js.
//
// Yjs mints a client ID via lib0/random -> crypto.getRandomValues when a Y.Doc
// is constructed. Providing the same global here means tests take the same code
// path as the device; mocking lib0 instead hid a crash where `new Y.Doc()`
// threw on Hermes for want of a global crypto.
const nodeCrypto = require('crypto');

if (typeof global.crypto === 'undefined') {
  global.crypto = {};
}
if (typeof global.crypto.getRandomValues !== 'function') {
  global.crypto.getRandomValues = (buffer) => nodeCrypto.randomFillSync(buffer);
}
