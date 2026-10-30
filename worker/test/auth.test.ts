import { describe, expect, it } from 'vitest';
import { AuthError, hashToken, newSessionToken, verifyGoogleIdToken } from '../src/auth';

const CLIENT = 'test-client.apps.googleusercontent.com';
const NOW = Date.UTC(2026, 9, 26, 12);

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const pair = (await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
)) as CryptoKeyPair;
const jwk = { ...((await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey), kid: 'k1' };
const keys = async () => [jwk];

async function sign(claims: Record<string, unknown>, kid = 'k1') {
  const h = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const p = b64url(JSON.stringify(claims));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${h}.${p}`)));
  return `${h}.${p}.${b64url(sig)}`;
}

const good = { iss: 'https://accounts.google.com', aud: CLIENT, sub: '1234567890', exp: NOW / 1000 + 600, iat: NOW / 1000 };

describe('구글 ID 토큰 검증', () => {
  it('올바른 토큰', async () => {
    const c = await verifyGoogleIdToken(await sign(good), CLIENT, NOW, keys);
    expect(c.sub).toBe('1234567890');
  });

  it('앱용 클라이언트 ID도 목록에 있으면 통과', async () => {
    const ios = 'ios-client.apps.googleusercontent.com';
    const c = await verifyGoogleIdToken(await sign({ ...good, aud: ios }), [CLIENT, ios], NOW, keys);
    expect(c.sub).toBe('1234567890');
    await expect(verifyGoogleIdToken(await sign({ ...good, aud: ios }), [CLIENT], NOW, keys)).rejects.toThrow(AuthError);
  });

  it('다른 사이트(aud), 만료, 다른 발급자는 거절', async () => {
    await expect(verifyGoogleIdToken(await sign({ ...good, aud: 'other' }), CLIENT, NOW, keys)).rejects.toThrow(AuthError);
    await expect(verifyGoogleIdToken(await sign({ ...good, exp: NOW / 1000 - 3600 }), CLIENT, NOW, keys)).rejects.toThrow('만료');
    await expect(verifyGoogleIdToken(await sign({ ...good, iss: 'evil.com' }), CLIENT, NOW, keys)).rejects.toThrow(AuthError);
  });

  it('서명을 바꾸거나 모르는 키면 거절', async () => {
    const t = await sign(good);
    const [h, , s] = t.split('.');
    const forged = `${h}.${b64url(JSON.stringify({ ...good, sub: 'attacker' }))}.${s}`;
    await expect(verifyGoogleIdToken(forged, CLIENT, NOW, keys)).rejects.toThrow(AuthError);
    await expect(verifyGoogleIdToken(await sign(good, 'unknown'), CLIENT, NOW, keys)).rejects.toThrow(AuthError);
    await expect(verifyGoogleIdToken('nope', CLIENT, NOW, keys)).rejects.toThrow(AuthError);
  });
});

describe('로그인 토큰', () => {
  it('무작위이고 해시는 64자리', async () => {
    const a = newSessionToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(newSessionToken());
    expect(await hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

import { kstDayStart } from '../src/account';

describe('광고 2배 하루 제한의 기준 시각', () => {
  it('한국 시간 자정으로 끊는다', () => {
    // 2026-10-30 23:59 KST = 14:59 UTC → 그날 0시 KST = 2026-10-29 15:00 UTC
    expect(kstDayStart(Date.UTC(2026, 9, 30, 14, 59))).toBe(Date.UTC(2026, 9, 29, 15, 0));
    // 2026-10-31 00:00 KST = 15:00 UTC → 새 날
    expect(kstDayStart(Date.UTC(2026, 9, 30, 15, 0))).toBe(Date.UTC(2026, 9, 30, 15, 0));
  });
});
