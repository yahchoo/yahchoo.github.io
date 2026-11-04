import { describe, expect, it } from 'vitest';
import { stripPathPrefix, withoutPrefix } from '../src/routing';

describe('공용 서버 주소의 /yahchoo 경로', () => {
  it('앞부분을 뗀다', () => {
    expect(stripPathPrefix('/yahchoo/api/health')).toBe('/api/health');
    expect(stripPathPrefix('/yahchoo/api/rooms/ABCD/ws')).toBe('/api/rooms/ABCD/ws');
    expect(stripPathPrefix('/yahchoo')).toBe('/');
  });
  it('예전 주소(앞부분 없음)와 비슷한 이름은 그대로 둔다', () => {
    expect(stripPathPrefix('/api/health')).toBe('/api/health');
    expect(stripPathPrefix('/yahchoox/api')).toBe('/yahchoox/api');
  });
  it('쿼리와 메서드를 유지한다', async () => {
    const req = withoutPrefix(new Request('https://api.ohsangplay.com/yahchoo/api/rankings?period=week', { method: 'POST', body: '{"a":1}' }));
    expect(new URL(req.url).pathname).toBe('/api/rankings');
    expect(new URL(req.url).search).toBe('?period=week');
    expect(req.method).toBe('POST');
    expect(await req.text()).toBe('{"a":1}');
  });
});
