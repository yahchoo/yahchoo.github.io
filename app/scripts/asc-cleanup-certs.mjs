// GitHub Mac 빌드가 남긴 개발용 인증서를 정리한다.
// 빌드할 때마다 Xcode가 API 키로 'Apple Development: Created via API' 인증서를 새로 만드는데,
// 빌드가 끝나면 그 개인 키는 사라져서 다시 쓸 수 없다. 쌓이면 인증서 개수 제한에 걸려 빌드가 실패하므로 빌드 전에 지운다.
// (직접 만든 개발 인증서나 배포 인증서는 건드리지 않는다)
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { ASC_KEY_ID: kid, ASC_ISSUER_ID: iss } = process.env;
const key = fs.readFileSync(path.join(os.homedir(), 'private_keys', `AuthKey_${kid}.p8`), 'utf8');
const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64({ alg: 'ES256', kid, typ: 'JWT' })}.${b64({ iss, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' })}`;
const sig = crypto.sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
const auth = { authorization: `Bearer ${unsigned}.${sig}` };
const API = 'https://api.appstoreconnect.apple.com/v1';

const res = await fetch(`${API}/certificates?filter[certificateType]=DEVELOPMENT,IOS_DEVELOPMENT&limit=200`, { headers: auth });
if (!res.ok) {
  console.log(`::warning title=인증서 정리::목록을 못 받았어요 (${res.status}). 그대로 빌드를 계속해요`);
  process.exit(0);
}
const { data } = await res.json();
const stale = data.filter((c) => /Created via API/i.test(`${c.attributes.name} ${c.attributes.displayName}`));
let removed = 0;
for (const c of stale) {
  const r = await fetch(`${API}/certificates/${c.id}`, { method: 'DELETE', headers: auth });
  if (r.ok || r.status === 204) removed += 1;
  else console.log(`인증서 ${c.id} 삭제 실패 ${r.status}`);
}
console.log(`::notice title=인증서 정리::개발 인증서 ${data.length}개 중 빌드용(Created via API) ${removed}개를 정리했어요`);
