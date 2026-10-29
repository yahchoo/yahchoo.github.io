export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // 아래에서 처리
  }
  throw new HttpError(400, '요청 형식이 올바르지 않아요');
}

/**
 * 요청한 주소(Origin)가 허용 목록(쉼표로 구분)에 있는지. 정확히 같은 문자열만 허용한다.
 * 예외로 http://localhost, http://127.0.0.1 항목은 포트가 붙은 주소(로컬 개발)도 허용한다.
 * 앱은 Android가 https://localhost, iOS가 capacitor://localhost로 요청한다.
 */
export function originAllowed(origin: string, allowedList: string | undefined): boolean {
  const allowed = (allowedList ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.some(
    (entry) =>
      origin === entry ||
      ((entry === 'http://localhost' || entry === 'http://127.0.0.1') && origin.startsWith(`${entry}:`)),
  );
}
