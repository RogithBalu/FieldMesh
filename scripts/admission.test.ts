/**
 * Relay check for the mesh join protocol: A asks, B forwards, C hosts.
 *
 * Each phone loads its own copy of the module — the admission state is module
 * global, so a distinct import specifier is what gives three separate phones
 * in one process.
 *
 *   node --experimental-strip-types scripts/admission.test.ts
 */
const specifier = '../src/lib/mesh/admission.ts';
const A = await import(`${specifier}?phone=a`);
const B = await import(`${specifier}?phone=b`);
const C = await import(`${specifier}?phone=c`);

const DOC = 'inspection:demo';
let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  PASS  ${name}`);
    pass++;
  } else {
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    fail++;
  }
}

const hostCtx = { isHost: true, hostedDoc: DOC, myUserId: 'carol' };
const relayCtx = { isHost: false, hostedDoc: null, myUserId: 'bob' };

console.log('== A asks, B relays, C (host) queues ==');
const req = A.beginRequest({ userId: 'alice', name: 'Alice', role: 'technician', deviceId: 'dev-a', doc: DOC });
check('A records an outstanding request', A.getAdmissionState().outstanding?.rid === req.rid);

// A -> B
const atB = B.receiveRequest(JSON.parse(A.encodeRequest(req)), 'link:a', relayCtx);
check('B forwards, excluding the inbound link', atB.kind === 'forward' && atB.exclude === 'link:a', atB.kind);

// B -> C, one hop further
const relayedReq = B.relayed({ ...req, hops: req.hops, ttl: req.ttl });
const atC = C.receiveRequest(JSON.parse(B.encodeRequest(relayedReq)), 'link:b', hostCtx);
check('C queues it as host', atC.kind === 'queue', atC.kind);
check('C sees it arrived 1 hop away', C.getAdmissionState().pending[0]?.hops === 1, String(C.getAdmissionState().pending[0]?.hops));
check('C shows the requester', C.getAdmissionState().pending[0]?.name === 'Alice');

console.log('== duplicates are dropped ==');
check('B drops a repeat of the same request', B.receiveRequest(JSON.parse(A.encodeRequest(req)), 'link:x', relayCtx).kind === 'ignore');
check('C drops a repeat too', C.receiveRequest(JSON.parse(B.encodeRequest(relayedReq)), 'link:b', hostCtx).kind === 'ignore');
check('C still has exactly one pending', C.getAdmissionState().pending.length === 1);

console.log('== the grant routes back the way it came ==');
const session = { host: '192.168.49.1', port: 9090, key: 'KEY123', doc: DOC, ssid: 'AndroidShare_1', pass: 'pw' };
const out = C.decide(C.getAdmissionState().pending[0].rid, true, 'Carol', session);
check('C produced a decision', !!out);
check('C routes it back to B', out?.route === 'link:b', String(out?.route));
check('C cleared its queue', C.getAdmissionState().pending.length === 0);

// C -> B
const atBDec = B.receiveDecision(JSON.parse(C.encodeDecision(out!.decision)), { myUserId: 'bob' });
check('B routes the decision to A', atBDec.kind === 'route' && atBDec.to === 'link:a', JSON.stringify(atBDec));

// B -> A
const relayedDec = B.relayedDecision(out!.decision);
const atA = A.receiveDecision(JSON.parse(B.encodeDecision(relayedDec)), { myUserId: 'alice' });
check('A resolves its own request', atA.kind === 'resolved', atA.kind);
check('A receives the session key', atA.kind === 'resolved' && atA.decision.session?.key === 'KEY123');
check('A clears its outstanding request', A.getAdmissionState().outstanding === null);

console.log('== a hop budget stops a loop ==');
const D = await import(`${specifier}?phone=d`);
const spent = { ...req, rid: 'exhausted', ttl: 0, hops: 6 };
check('a request with no hops left is dropped', D.receiveRequest(JSON.parse(D.encodeRequest(spent)), 'link:z', relayCtx).kind === 'ignore');

console.log('== malformed frames are dropped, not half-read ==');
check('missing fields', D.receiveRequest({ rid: 'x' }, 'link:z', relayCtx).kind === 'ignore');
check('not an object', D.receiveRequest('nope', 'link:z', relayCtx).kind === 'ignore');
check('decision without ok', D.receiveDecision({ rid: 'y', u: 'alice' }, { myUserId: 'alice' }).kind === 'ignore');

console.log('== a denial carries no session ==');
const E = await import(`${specifier}?phone=e`);
const req2 = A.beginRequest({ userId: 'alice', name: 'Alice', deviceId: 'dev-a', doc: DOC });
E.receiveRequest(JSON.parse(A.encodeRequest(req2)), 'link:a', { isHost: true, hostedDoc: DOC, myUserId: 'eve' });
const denied = E.decide(req2.rid, false, 'Eve', session, 'Not on this crew');
check('a denial omits the session', denied?.decision.session === undefined);
check('a denial keeps the reason', denied?.decision.reason === 'Not on this crew');

console.log(`\npassed: ${pass}   failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
