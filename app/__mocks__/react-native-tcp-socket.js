// Manual Jest mock for react-native-tcp-socket.
// The real module calls `new NativeEventEmitter(NativeModules.TcpSockets)` at import
// time, which throws outside a real RN native runtime (e.g. under Jest). Component
// smoke tests (App.test.tsx) only need `require('react-native-tcp-socket')` to resolve
// without crashing — they never exercise real socket I/O.
class Socket {
  on() {
    return this;
  }
  write(_data, _encoding, cb) {
    if (typeof cb === 'function') cb();
    return true;
  }
  destroy() {
    return this;
  }
}

class Server {
  on() {
    return this;
  }
  listen() {
    return this;
  }
  close() {
    return this;
  }
}

module.exports = {
  createServer: jest.fn(() => new Server()),
  createConnection: jest.fn(() => new Socket()),
  Socket,
  Server,
};
