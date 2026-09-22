#!/usr/bin/env node
// Fake spoke for testing a live TCP hub from a laptop on the same Wi-Fi.
// Usage (from fieldmesh/app):  node scripts/spokeTest.js <hub-ip> [port] [session-key]
//
// Wire format, matching src/transports + src/hub/tcpHub.ts:
//   session key : frame(encode(SESSION_KEY, key))            -- single framed (hub reads it raw)
//   after auth  : frame(frame(encode(type, payload)))        -- outer = TcpSocketTransport, inner = YjsSync

const net = require('net');
const Y = require('yjs');

const Msg = { SESSION_KEY: 0x01, STATE_VECTOR: 0x02, YJS_UPDATE: 0x03 };

function frame(p) {
  const out = Buffer.alloc(4 + p.length);
  out.writeUInt32BE(p.length, 0);
  Buffer.from(p).copy(out, 4);
  return out;
}
function encode(type, payload) {
  const out = Buffer.alloc(1 + (payload ? payload.length : 0));
  out[0] = type;
  if (payload) Buffer.from(payload).copy(out, 1);
  return out;
}
function decode(b) {
  return { type: b[0], payload: b.subarray(1) };
}
class FrameReader {
  constructor() { this.buf = Buffer.alloc(0); }
  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    const frames = [];
    let off = 0;
    while (this.buf.length - off >= 4) {
      const len = this.buf.readUInt32BE(off);
      if (this.buf.length - off - 4 < len) break;
      frames.push(this.buf.subarray(off + 4, off + 4 + len));
      off += 4 + len;
    }
    this.buf = this.buf.subarray(off);
    return frames;
  }
}

const [, , host, portArg = '9090', key = 'dev-test-key'] = process.argv;
if (!host) {
  console.error('usage: node scripts/spokeTest.js <hub-ip> [port] [session-key]');
  process.exit(2);
}

const t0 = Date.now();
const log = (...a) => console.log(`[+${String(Date.now() - t0).padStart(5)}ms]`, ...a);
const REMOTE = Symbol('remote');

const doc = new Y.Doc();
const outer = new FrameReader();
const inner = new FrameReader();
let authed = false;
let echoedSV = false;

function sendMsg(type, payload) {
  sock.write(frame(frame(encode(type, payload))));
}
function sendSV() {
  sendMsg(Msg.STATE_VECTOR, Y.encodeStateVector(doc));
}

const sock = net.connect({ host, port: Number(portArg) }, () => {
  log(`connected to ${host}:${portArg}, sending session key "${key}"`);
  sock.write(frame(encode(Msg.SESSION_KEY, Buffer.from(key, 'utf8'))));
  // Hub drops anything coalesced into the same chunk as the key frame; wait before syncing.
  setTimeout(() => {
    authed = true;
    log('sending our state vector');
    sendSV();
  }, 300);
});

doc.on('update', (update, origin) => {
  if (origin === REMOTE || !authed) return;
  sendMsg(Msg.YJS_UPDATE, update);
});

sock.on('data', (chunk) => {
  for (const f of outer.push(chunk)) {
    for (const m of inner.push(f)) {
      const { type, payload } = decode(m);
      if (type === Msg.STATE_VECTOR) {
        log('hub sent STATE_VECTOR');
        const diff = Y.encodeStateAsUpdate(doc, payload);
        if (diff.length > 2) sendMsg(Msg.YJS_UPDATE, diff);
        if (!echoedSV) { echoedSV = true; sendSV(); }
      } else if (type === Msg.YJS_UPDATE) {
        Y.applyUpdate(doc, payload, REMOTE);
        log('hub sent YJS_UPDATE -> doc.test =', JSON.stringify(doc.getMap('test').toJSON()));
      } else {
        log('other msg type', type);
      }
    }
  }
});
sock.on('close', () => { log('socket closed'); process.exit(0); });
sock.on('error', (e) => { log('socket error:', e.message); process.exit(1); });

setTimeout(() => {
  const v = 'hello@' + new Date().toISOString();
  log(`writing test.from-laptop = ${v}`);
  doc.getMap('test').set('from-laptop', v);
}, 1500);

setTimeout(() => {
  log('final doc.test =', JSON.stringify(doc.getMap('test').toJSON()));
  sock.end();
}, 6000);
