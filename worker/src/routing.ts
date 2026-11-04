/**
 * 오상플레이 공용 서버 주소(api.ohsangplay.com)에서는 앱마다 경로 앞부분으로 나눈다.
 * 이 앱은 /yahchoo 아래를 받는다: https://api.ohsangplay.com/yahchoo/api/health → /api/health
 * 예전 workers.dev 주소(이미 설치된 TestFlight 빌드가 씀)는 앞부분 없이 그대로 들어온다.
 */
export const PATH_PREFIX = '/yahchoo';

export function stripPathPrefix(pathname: string): string {
  if (pathname === PATH_PREFIX) return '/';
  if (pathname.startsWith(`${PATH_PREFIX}/`)) return pathname.slice(PATH_PREFIX.length);
  return pathname;
}

/** 경로 앞부분을 뗀 요청. 바꿀 게 없으면 그대로. */
export function withoutPrefix(request: Request): Request {
  const url = new URL(request.url);
  const path = stripPathPrefix(url.pathname);
  if (path === url.pathname) return request;
  url.pathname = path;
  return new Request(url.toString(), request);
}
