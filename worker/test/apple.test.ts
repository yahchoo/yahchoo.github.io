import { describe, expect, it } from 'vitest';
import { AuthError } from '../src/auth';
import { appleClientSecret, openToken, sealToken, verifyAppleIdToken, verifyAppleNotification } from '../src/apple';

const APP = 'com.ohsang.play.yahchoo';
const NOW = Date.UTC(2026, 9, 29, 12);

function b64url(data: Uint8Array | ArrayBuffer | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

const rsa = (await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
)) as CryptoKeyPair;
const jwk = { ...((await crypto.subtle.exportKey('jwk', rsa.publicKey)) as JsonWebKey), kid: 'apple1' };
const keys = async () => [jwk];
async function sign(claims: Record<string, unknown>) {
  const h = b64url(JSON.stringify({ alg: 'RS256', kid: 'apple1' }));
  const p = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', rsa.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(sig)}`;
}
async function sha256Hex(t: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const good = { iss: 'https://appleid.apple.com', aud: APP, sub: '001234.abcd.1234', exp: NOW / 1000 + 600 };

describe('Apple identity token', () => {
  it('올바른 토큰, nonce는 그대로 또는 SHA-256', async () => {
    expect((await verifyAppleIdToken(await sign(good), [APP], undefined, NOW, keys)).sub).toBe(good.sub);
    expect((await verifyAppleIdToken(await sign({ ...good, nonce: 'n1' }), [APP], 'n1', NOW, keys)).sub).toBe(good.sub);
    expect((await verifyAppleIdToken(await sign({ ...good, nonce: await sha256Hex('n2') }), [APP], 'n2', NOW, keys)).sub).toBe(good.sub);
  });

  it('다른 앱, 다른 발급자, 만료, nonce 불일치는 거절', async () => {
    await expect(verifyAppleIdToken(await sign({ ...good, aud: 'com.other.app' }), [APP], undefined, NOW, keys)).rejects.toThrow(AuthError);
    await expect(verifyAppleIdToken(await sign({ ...good, iss: 'https://evil.example' }), [APP], undefined, NOW, keys)).rejects.toThrow(AuthError);
    await expect(verifyAppleIdToken(await sign({ ...good, exp: NOW / 1000 - 3600 }), [APP], undefined, NOW, keys)).rejects.toThrow('만료');
    await expect(verifyAppleIdToken(await sign({ ...good, nonce: 'n1' }), [APP], 'other', NOW, keys)).rejects.toThrow(AuthError);
    await expect(verifyAppleIdToken(await sign({ ...good, nonce: 'n1' }), [APP], undefined, NOW, keys)).rejects.toThrow(AuthError);
    await expect(verifyAppleIdToken(await sign(good), [], undefined, NOW, keys)).rejects.toThrow('준비');
  });

  it('서명을 바꾸면 거절', async () => {
    const [h, , s] = (await sign(good)).split('.');
    const forged = `${h}.${b64url(JSON.stringify({ ...good, sub: 'attacker' }))}.${s}`;
    await expect(verifyAppleIdToken(forged, [APP], undefined, NOW, keys)).rejects.toThrow(AuthError);
  });
});

describe('Apple 클라이언트 시크릿과 토큰 암호화', async () => {
  const ec = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array((await crypto.subtle.exportKey('pkcs8', ec.privateKey)) as ArrayBuffer);
  const p8 = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8)).replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`;
  const secrets = { teamId: 'TEAM123456', keyId: 'KEY1234567', p8 };

  it('ES256으로 서명되고 내용이 맞다', async () => {
    const jwt = await appleClientSecret(secrets, APP, NOW);
    const [h, p, s] = jwt.split('.');
    expect(JSON.parse(new TextDecoder().decode(fromB64url(h)))).toMatchObject({ alg: 'ES256', kid: 'KEY1234567' });
    expect(JSON.parse(new TextDecoder().decode(fromB64url(p)))).toMatchObject({ iss: 'TEAM123456', aud: 'https://appleid.apple.com', sub: APP, iat: NOW / 1000, exp: NOW / 1000 + 300 });
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, ec.publicKey, fromB64url(s), new TextEncoder().encode(`${h}.${p}`));
    expect(ok).toBe(true);
  });

  it('refresh token은 암호화해서 저장하고 같은 키로만 연다', async () => {
    const sealed = await sealToken(secrets, 'r.refresh-token');
    expect(sealed).not.toContain('refresh');
    expect(await openToken(secrets, sealed)).toBe('r.refresh-token');
    expect(await openToken({ ...secrets, p8: 'other' }, sealed)).toBeNull();
  });
});

describe('Apple 서버 알림', () => {
  it('events를 읽고, 다른 앱이면 거절', async () => {
    const payload = await sign({ iss: 'https://appleid.apple.com', aud: APP, events: JSON.stringify({ type: 'account-delete', sub: '001234.abcd.1234' }) });
    expect(await verifyAppleNotification(payload, [APP], keys)).toEqual({ type: 'account-delete', sub: '001234.abcd.1234' });
    const other = await sign({ iss: 'https://appleid.apple.com', aud: 'com.other', events: '{"type":"consent-revoked","sub":"x"}' });
    await expect(verifyAppleNotification(other, [APP], keys)).rejects.toThrow(AuthError);
  });
});
