// 같이 하기 응답 시간 재기: 1:1 방을 만들고 두 사람이 들어와 번갈아 굴리고 적으면서
// 보낸 뒤 결과(state)가 올 때까지 걸린 시간을 잰다. node 22 이상 (내장 WebSocket).
const API = process.argv[2] ?? 'https://api.ohsangplay.com/yahchoo';
const ORIGIN = 'https://yahchoo.ohsangplay.com';
const ROUNDS = Number(process.argv[3] ?? 6);
// 굴리기 전에 쉬는 시간(초) 목록. 방이 잠들었다 깨어나는 데 걸리는 시간을 보려고 쉬었다가 굴린다.
const GAPS = (process.argv[4] ?? '0').split(',').map(Number);
const wsBase = API.replace(/^http/, 'ws');

const res = await fetch(`${API}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ mode: '1v1' }) });
const { code } = await res.json();

function join(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}/api/rooms/${code}/ws?name=${encodeURIComponent(name)}`, { headers: { origin: ORIGIN } });
    const c = { ws, name, id: null, state: null, waiters: [] };
    ws.onmessage = (ev) => {
      if (ev.data === 'pong') return;
      const m = JSON.parse(ev.data);
      if (m.type === 'welcome') { c.id = m.playerId; resolve(c); }
      if (m.type === 'state') { c.state = m; c.waiters.splice(0).forEach((w) => w(m)); }
      if (m.type === 'error') console.log(name, '오류', m.message);
    };
    ws.onerror = reject;
  });
}
const next = (c) => new Promise((r) => c.waiters.push(r));
const a = await join('측정A');
const b = await join('측정B');
await new Promise((r) => setTimeout(r, 300));
const t0 = Date.now();
a.ws.send(JSON.stringify({ type: 'start' }));
await next(a);
const times = { start: Date.now() - t0, roll: [], score: [] };
for (let i = 0; i < ROUNDS; i++) {
  const g = a.state.game;
  const me = [a, b].find((c) => c.state.you === g.turn) ?? a;
  const gap = GAPS[i % GAPS.length];
  if (gap) await new Promise((r) => setTimeout(r, gap * 1000));
  let t = Date.now();
  me.ws.send(JSON.stringify({ type: 'roll' }));
  await next(me);
  times.roll.push(Date.now() - t);
  if (gap) times.gapped = [...(times.gapped ?? []), `${gap}초 쉰 뒤 ${Date.now() - t}ms`];
  const sheet = me.state.game.sheets.find((s) => s.seat === me.state.you).scores;
  const cat = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes', 'choice', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yacht'].find((k) => sheet[k] === undefined || sheet[k] === null);
  t = Date.now();
  me.ws.send(JSON.stringify({ type: 'score', category: cat }));
  const other = me === a ? b : a;
  await Promise.all([next(me), next(other)]);
  times.score.push(Date.now() - t);
}
const s = (arr) => `평균 ${Math.round(arr.reduce((x, y) => x + y, 0) / arr.length)}ms, 최대 ${Math.max(...arr)}ms [${arr.join(', ')}]`;
console.log(`방 ${code} 시작 ${times.start}ms`);
console.log(`굴리기 ${s(times.roll)}`);
console.log(`적기 ${s(times.score)}`);
if (times.gapped) console.log(`쉬었다 굴리기: ${times.gapped.join(', ')}`);
a.ws.close(); b.ws.close();
process.exit(0);
