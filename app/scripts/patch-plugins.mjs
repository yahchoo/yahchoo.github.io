// Capacitor 8과 맞추기: @capacitor-community/apple-sign-in(7.x)의 Swift 패키지가 capacitor-swift-pm 7.x만 허용해서
// 8.x를 쓰는 다른 플러그인(AdMob 등)과 버전이 충돌한다. 플러그인 코드는 8에서도 그대로 돌아가니 범위만 8로 올린다.
import fs from 'node:fs';
const file = new URL('../node_modules/@capacitor-community/apple-sign-in/Package.swift', import.meta.url);
if (fs.existsSync(file)) {
  const src = fs.readFileSync(file, 'utf8');
  const out = src.replace(/(capacitor-swift-pm\.git",\s*from:\s*")7\.0\.0(")/, '$18.0.0$2');
  if (out !== src) {
    fs.writeFileSync(file, out);
    console.log('patched apple-sign-in Package.swift → capacitor-swift-pm 8');
  }
}
