import { describe, expect, it } from 'vitest';
import { originAllowed } from '../src/http';
import wranglerToml from '../wrangler.toml?raw';

// wrangler.toml에 실제로 들어 있는 허용 목록
const ALLOWED = /^ALLOWED_ORIGINS\s*=\s*"([^"]*)"/m.exec(wranglerToml)![1];

describe('허용 주소 (CORS·WebSocket)', () => {
  it('웹 사이트', () => {
    expect(originAllowed('https://yahchoo.ohsangplay.com', ALLOWED)).toBe(true);
    expect(originAllowed('https://yahchoo.github.io', ALLOWED)).toBe(true);
  });

  it('앱: Android(https://localhost), iOS(capacitor://localhost)', () => {
    expect(originAllowed('https://localhost', ALLOWED)).toBe(true);
    expect(originAllowed('capacitor://localhost', ALLOWED)).toBe(true);
  });

  it('로컬 개발: http://localhost·127.0.0.1은 포트가 붙어도 허용', () => {
    expect(originAllowed('http://localhost:5173', ALLOWED)).toBe(true);
    expect(originAllowed('http://127.0.0.1:8080', ALLOWED)).toBe(true);
  });

  it('비슷하지만 다른 주소는 거절', () => {
    expect(originAllowed('https://localhost:8443', ALLOWED)).toBe(false);
    expect(originAllowed('capacitor://localhost.evil.com', ALLOWED)).toBe(false);
    expect(originAllowed('https://localhost.evil.com', ALLOWED)).toBe(false);
    expect(originAllowed('capacitor://evil', ALLOWED)).toBe(false);
    expect(originAllowed('https://yahchoo.ohsangplay.com.evil.com', ALLOWED)).toBe(false);
    expect(originAllowed('null', ALLOWED)).toBe(false);
  });

  it('목록이 비어 있으면 모두 거절', () => {
    expect(originAllowed('https://localhost', '')).toBe(false);
    expect(originAllowed('https://localhost', undefined)).toBe(false);
  });
});
