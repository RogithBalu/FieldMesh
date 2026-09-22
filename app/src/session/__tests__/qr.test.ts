import {
  buildWifiQr,
  buildSessionQr,
  parseSessionQr,
  generateSessionKey,
} from '../qr';
import {SessionInfo, SessionQrError, SessionQrErrorCode} from '../types';

const valid: SessionInfo = {
  host: '192.168.49.1',
  port: 9090,
  key: 'ABCD2345EFGH',
  doc: 'inspection:test-001',
};

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(SessionQrError);
    expect((e as SessionQrError).code).toBe(code);
    return;
  }
  throw new Error('expected a SessionQrError, none thrown');
}

describe('buildWifiQr', () => {
  it('produces the standard Wi-Fi QR grammar', () => {
    expect(buildWifiQr('FieldMesh_A1', 'hunter2pass')).toBe(
      'WIFI:T:WPA;S:FieldMesh_A1;P:hunter2pass;H:false;;',
    );
  });

  it('escapes separator characters so a passphrase cannot truncate the payload', () => {
    // An unescaped ';' would end the password field early and the phone would
    // join with the wrong credentials.
    const qr = buildWifiQr('Site;A', 'pa:ss;word\\x');
    expect(qr).toBe('WIFI:T:WPA;S:Site\\;A;P:pa\\:ss\\;word\\\\x;H:false;;');
  });

  it('rejects an empty ssid', () => {
    expectCode(() => buildWifiQr('', 'pw'), SessionQrErrorCode.INVALID_FIELD);
  });
});

describe('session QR round-trip', () => {
  it('parses back exactly what it built', () => {
    expect(parseSessionQr(buildSessionQr(valid))).toEqual(valid);
  });

  it('carries the optional ssid when present', () => {
    const withSsid = {...valid, ssid: 'FieldMesh_A1'};
    expect(parseSessionQr(buildSessionQr(withSsid))).toEqual(withSsid);
  });

  it('omits ssid entirely when not given', () => {
    expect(parseSessionQr(buildSessionQr(valid)).ssid).toBeUndefined();
  });

  it('tolerates surrounding whitespace from a scanner', () => {
    expect(parseSessionQr(`  ${buildSessionQr(valid)}\n`)).toEqual(valid);
  });
});

describe('parseSessionQr rejects untrusted input', () => {
  it('rejects a non-FieldMesh QR', () => {
    expectCode(
      () => parseSessionQr('https://example.com'),
      SessionQrErrorCode.NOT_FIELDMESH,
    );
  });

  it('rejects a Wi-Fi QR scanned into the wrong field', () => {
    expectCode(
      () => parseSessionQr(buildWifiQr('a', 'b')),
      SessionQrErrorCode.NOT_FIELDMESH,
    );
  });

  it('rejects a future schema version', () => {
    expectCode(
      () => parseSessionQr('FMSESSION2:{}'),
      SessionQrErrorCode.BAD_VERSION,
    );
  });

  it('rejects malformed JSON', () => {
    expectCode(
      () => parseSessionQr('FMSESSION1:{not json'),
      SessionQrErrorCode.MALFORMED,
    );
  });

  it('rejects a JSON array', () => {
    expectCode(
      () => parseSessionQr('FMSESSION1:[]'),
      SessionQrErrorCode.MALFORMED,
    );
  });

  it('rejects an oversized payload without parsing it', () => {
    expectCode(
      () => parseSessionQr('FMSESSION1:' + 'x'.repeat(2000)),
      SessionQrErrorCode.MALFORMED,
    );
  });

  it.each([
    ['not-an-ip', {host: 'hub.local'}],
    ['octet out of range', {host: '192.168.1.999'}],
    ['too few octets', {host: '192.168.1'}],
    ['port zero', {port: 0}],
    ['port too high', {port: 70000}],
    ['non-integer port', {port: 80.5}],
    ['empty key', {key: ''}],
    ['empty doc', {doc: ''}],
  ])('rejects %s', (_label, override) => {
    const payload = 'FMSESSION1:' + JSON.stringify({...valid, ...override});
    expectCode(() => parseSessionQr(payload), SessionQrErrorCode.INVALID_FIELD);
  });

  it('rejects a payload with fields of the wrong type', () => {
    const payload =
      'FMSESSION1:' + JSON.stringify({...valid, port: '9090', key: 42});
    expectCode(() => parseSessionQr(payload), SessionQrErrorCode.INVALID_FIELD);
  });

  it('rejects an over-long key rather than truncating it', () => {
    expectCode(
      () => buildSessionQr({...valid, key: 'k'.repeat(200)}),
      SessionQrErrorCode.INVALID_FIELD,
    );
  });
});

describe('generateSessionKey', () => {
  it('honours the requested length', () => {
    expect(generateSessionKey()).toHaveLength(12);
    expect(generateSessionKey(20)).toHaveLength(20);
  });

  it('omits characters that misread when typed by hand', () => {
    const keys = Array.from({length: 50}, () => generateSessionKey(32)).join('');
    expect(keys).not.toMatch(/[O0I1L]/);
  });

  it('does not repeat across calls', () => {
    const keys = new Set(Array.from({length: 100}, () => generateSessionKey()));
    expect(keys.size).toBe(100);
  });

  it('produces keys a built session QR accepts', () => {
    const info = {...valid, key: generateSessionKey()};
    expect(parseSessionQr(buildSessionQr(info)).key).toBe(info.key);
  });
});
