/**
 * Laptop stand-in for a phone on the Wi-Fi hotspot relay — the same wire
 * protocol the app's hotspot module speaks (length-prefixed frames, a
 * SESSION_KEY handshake, then Yjs state-vector sync), so one phone can be
 * tested end to end from a laptop.
 *
 *   # Be a spoke: join the phone's hotspot Wi-Fi first, then
 *   MODE=spoke HOST=192.168.49.1 PORT=9090 KEY=ABCD... pnpm tsx src/tests/hotspot-peer.ts
 *
 *   # Be a hub: run a hotspot on the laptop (nmcli dev wifi hotspot ...), then
 *   MODE=hub PORT=9090 KEY=ABCD... DOC=inspection:<id> SSID=FMHUB PASS=... HOSTIP=10.42.0.1 pnpm tsx src/tests/hotspot-peer.ts
 *   → prints the FMSESSION2 code to paste into the phone's "Scan a session QR" screen.
 *
 * Both modes: SET=fieldId=value writes an edit into the shared doc after sync
 * (e.g. SET=oil_temperature=81), and every incoming edit is printed.
 */
import * as net from "node:net";
import * as Y from "yjs";
import { tick, encodeHlc, type EditEntry } from "@fieldmesh/shared";

const MODE = process.env.MODE ?? "spoke";
const HOST = process.env.HOST ?? "192.168.49.1";
const PORT = Number(process.env.PORT ?? 9090);
const KEY = process.env.KEY ?? "";
const DOC = process.env.DOC ?? "inspection:unknown";
const SET = process.env.SET;
const NAME = process.env.NAME ?? "Laptop";
const DEVICE = process.env.DEVICE ?? "laptop-sim";

const Msg = { SESSION_KEY: 0x01, STATE_VECTOR: 0x02, YJS_UPDATE: 0x03, PING: 0x04, PONG: 0x05, HELLO: 0x10 } as const;

function frame(payload: Uint8Array): Buffer {
  const out = Buffer.alloc(4 + payload.length);
  out.writeUInt32BE(payload.length, 0);
  Buffer.from(payload).copy(out, 4);
  return out;
}
function encode(type: number, payload?: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + (payload?.length ?? 0));
  out[0] = type;
  if (payload) out.set(payload, 1);
  return out;
}
class FrameReader {
  private buf = Buffer.alloc(0);
  push(chunk: Buffer): Uint8Array[] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const frames: Uint8Array[] = [];
    let off = 0;
    while (this.buf.length - off >= 4) {
      const len = this.buf.readUInt32BE(off);
      if (this.buf.length - off - 4 < len) break;
      frames.push(new Uint8Array(this.buf.subarray(off + 4, off + 4 + len)));
      off += 4 + len;
    }
    this.buf = this.buf.subarray(off);
    return frames;
  }
}

const doc = new Y.Doc();
const edits = doc.getMap("edits");
edits.observe((ev) => {
  ev.changes.keys.forEach((_c, key) => {
    const v = edits.get(key) as any;
    if (v) console.log(`  ← edit ${v.fieldId} = ${JSON.stringify(v.value)} by ${v.author} device=${v.device}`);
  });
});

function attachSync(sock: net.Socket, label: string) {
  const reader = new FrameReader();
  let gotSV = false;
  const send = (type: number, payload: Uint8Array) => sock.write(frame(encode(type, payload)));
  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== sock) send(Msg.YJS_UPDATE, update);
  };
  doc.on("update", onUpdate);
  sock.on("data", (chunk: Buffer) => {
    for (const f of reader.push(chunk)) {
      const type = f[0];
      const payload = f.subarray(1);
      if (type === Msg.STATE_VECTOR) {
        const diff = Y.encodeStateAsUpdate(doc, payload);
        if (diff.length > 2) send(Msg.YJS_UPDATE, diff);
        if (!gotSV) {
          gotSV = true;
          send(Msg.STATE_VECTOR, Y.encodeStateVector(doc));
          console.log(`${label}: synced (${edits.size} edits in doc)`);
          if (SET) setTimeout(() => writeEdit(SET), 500);
        }
      } else if (type === Msg.YJS_UPDATE) {
        Y.applyUpdate(doc, payload, sock);
      } else if (type === Msg.PING) {
        send(Msg.PONG, new Uint8Array(0));
      } else if (type === Msg.HELLO) {
        console.log(`${label}: hello ${Buffer.from(payload).toString("utf8")}`);
      }
    }
  });
  sock.on("close", () => {
    doc.off("update", onUpdate);
    console.log(`${label}: closed`);
  });
  send(Msg.HELLO, Buffer.from(JSON.stringify({ u: "laptop-user", n: NAME, r: "technician", d: DEVICE, c: false })));
  send(Msg.STATE_VECTOR, Y.encodeStateVector(doc));
}

function writeEdit(spec: string) {
  const i = spec.indexOf("=");
  const fieldId = spec.slice(0, i);
  const raw = spec.slice(i + 1);
  const value: unknown = raw === "pass" || raw === "fail" ? raw : Number.isFinite(Number(raw)) && raw.trim() !== "" ? Number(raw) : raw;
  const superseded = new Set<string>();
  const mine: EditEntry[] = [];
  edits.forEach((v: any) => {
    if (v?.fieldId === fieldId) {
      mine.push(v);
      for (const p of v.parents ?? []) superseded.add(p);
    }
  });
  const heads = mine.filter((e) => !superseded.has(e.id)).map((e) => e.id);
  const entry: EditEntry = {
    id: `lap-${Date.now().toString(36)}`,
    fieldId,
    value,
    author: "laptop-user",
    device: DEVICE,
    hlc: encodeHlc(tick(null, DEVICE)),
    parents: heads,
    schemaVersion: 1,
  };
  doc.transact(() => {
    edits.set(entry.id, entry);
    doc.getMap("fields").set(fieldId, value);
  });
  console.log(`  → wrote ${fieldId} = ${JSON.stringify(value)} (parents ${heads.length})`);
}

if (MODE === "spoke") {
  console.log(`spoke: connecting to ${HOST}:${PORT}`);
  const sock = net.createConnection({ host: HOST, port: PORT }, () => {
    console.log("spoke: connected, sending session key");
    sock.write(frame(encode(Msg.SESSION_KEY, Buffer.from(KEY, "utf8"))));
    attachSync(sock, "spoke");
  });
  sock.on("error", (e) => {
    console.error("spoke error:", e.message);
    process.exit(1);
  });
} else {
  const ssid = process.env.SSID ?? "";
  const pass = process.env.PASS ?? "";
  const hostIp = process.env.HOSTIP ?? "10.42.0.1";
  const server = net.createServer((sock) => {
    const reader = new FrameReader();
    let authed = false;
    console.log(`hub: client ${sock.remoteAddress}:${sock.remotePort} connected`);
    const onData = (chunk: Buffer) => {
      if (authed) return;
      for (const f of reader.push(chunk)) {
        if (f[0] !== Msg.SESSION_KEY || Buffer.from(f.subarray(1)).toString("utf8") !== KEY) {
          console.log("hub: bad session key, dropping");
          sock.destroy();
          return;
        }
        authed = true;
        sock.off("data", onData);
        console.log("hub: spoke authenticated");
        attachSync(sock, "hub");
        return;
      }
    };
    sock.on("data", onData);
    sock.on("error", () => {});
  });
  server.listen(PORT, "0.0.0.0", () => {
    const code = "FMSESSION2:" + JSON.stringify({ host: hostIp, port: PORT, key: KEY, doc: DOC, ssid, pass, name: NAME });
    console.log(`hub: listening on ${hostIp}:${PORT}`);
    console.log(`SESSION_CODE=${code}`);
  });
}
