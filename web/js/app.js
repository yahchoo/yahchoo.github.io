import {
  CATEGORIES,
  CATEGORY_INFO,
  ROLLS_PER_TURN,
  UPPER,
  UPPER_BONUS,
  UPPER_BONUS_THRESHOLD,
  bonusFor,
  filledCount,
  scoreFor,
  totalFor,
  upperSubtotal,
} from './rules.js';
import { makeDie, paintDie } from './dice.js';
import { SoloGame, bestScore } from './solo.js';
import { RoomConnection, activeRoom, apiBase, createRoom } from './net.js';

const $ = (id) => document.getElementById(id);
const MODE_LABEL = { '1v1': '1:1', '1v1v1': '1:1:1', '2v2': '2:2' };
const TEAM_NAME = ['빨강 팀', '파랑 팀'];
const NICK_KEY = 'yacht.nick';

/* ---------------------------------------------------------------- 공통 */

function show(screen) {
  for (const id of ['home', 'online', 'lobby', 'game']) $(id).hidden = id !== screen;
  window.scrollTo(0, 0);
}

function openOverlay(id) {
  $(id).hidden = false;
  $(id).querySelector('button')?.focus();
}

function closeOverlay(id) {
  $(id).hidden = true;
}

for (const overlay of document.querySelectorAll('.overlay')) {
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay && overlay.id !== 'result') closeOverlay(overlay.id);
    if (ev.target.closest('[data-close]')) closeOverlay(overlay.id);
  });
}
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  for (const id of ['rules', 'confirm']) if (!$(id).hidden) closeOverlay(id);
});

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function pennant(cls) {
  return el('i', `pen ${cls}`);
}

let toastTimer = null;
function toast(text) {
  $('toast').textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $('toast').textContent = '';
  }, 3500);
}

let confirmAction = null;
function confirmExit(text, action) {
  $('confirm-text').textContent = text;
  confirmAction = action;
  openOverlay('confirm');
}
$('confirm-ok').addEventListener('click', () => {
  closeOverlay('confirm');
  confirmAction?.();
});

function nickname() {
  try {
    return localStorage.getItem(NICK_KEY) ?? '';
  } catch {
    return '';
  }
}

function setUrlRoom(code) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  history.replaceState(null, '', url);
}

/* ---------------------------------------------------------------- 규칙 표 */

(() => {
  const table = $('rules-table');
  for (const cat of CATEGORIES) {
    const tr = el('tr');
    tr.append(el('th', '', CATEGORY_INFO[cat].name), el('td', '', CATEGORY_INFO[cat].hint));
    table.append(tr);
  }
})();
for (const btn of document.querySelectorAll('[data-open="rules"]')) {
  btn.addEventListener('click', () => openOverlay('rules'));
}

/* ---------------------------------------------------------------- 홈 */

function showHome() {
  leaveGameState();
  setUrlRoom(null);
  show('home');
  const best = bestScore();
  $('home-best').textContent = best === null ? '' : `혼자 하기 최고 기록 ${best}점`;
  const soloBtn = document.querySelector('[data-go="solo"]');
  soloBtn.textContent = hasSoloInProgress() ? '혼자 하기 이어서' : '혼자 하기';
}

function hasSoloInProgress() {
  try {
    return !!localStorage.getItem('yacht.solo.current');
  } catch {
    return false;
  }
}

let homeDiceDone = false;
function paintHomeDice() {
  const box = $('home-dice');
  box.replaceChildren();
  [6, 6, 6, 6, 6].forEach((face, i) => {
    const die = makeDie(face);
    if (!homeDiceDone) {
      die.classList.add('rolling');
      die.style.animationDelay = `${120 + i * 70}ms`;
      die.style.animationDuration = '.7s';
    }
    box.append(die);
  });
  homeDiceDone = true;
}

for (const btn of document.querySelectorAll('[data-go]')) {
  btn.addEventListener('click', () => {
    const to = btn.dataset.go;
    if (to === 'home') showHome();
    else if (to === 'solo') startSolo();
    else if (to === 'online') showOnline();
  });
}

/* ---------------------------------------------------------------- 게임 화면 (공용) */

const ui = {
  /** 'solo' | 'online' | null */
  kind: null,
  armed: null,
  lastRollSeq: null,
  lastMatch: null,
  lastScoredKey: null,
  lastTurnKey: null,
  resultShownFor: null,
  model: null,
};

const diceButtons = [];
for (let i = 0; i < 5; i++) {
  const b = makeDie(0, 'button');
  b.type = 'button';
  b.addEventListener('click', () => onHold(i));
  b.addEventListener('animationend', () => b.classList.remove('rolling'));
  diceButtons.push(b);
}
$('dice').append(...diceButtons);

$('roll-btn').addEventListener('click', () => {
  const m = ui.model;
  if (!m) return;
  if (m.finished) {
    showResult(true);
    return;
  }
  onRoll();
});

$('game-exit').addEventListener('click', () => {
  if (ui.kind === 'solo') {
    if (solo && filledCount(solo.sheet) > 0 && !solo.done) {
      confirmExit('처음 화면으로 갈까요? 하던 게임은 저장돼서 나중에 이어서 할 수 있어요.', showHome);
    } else {
      showHome();
    }
  } else if (ui.kind === 'online') {
    if (room.view?.phase === 'playing') {
      confirmExit('게임 중에 나가면 기권이에요. 나갈까요?', leaveRoom);
    } else {
      leaveRoom();
    }
  }
});

document.addEventListener('keydown', (ev) => {
  if ($('game').hidden || ev.target.closest('input') || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if (document.querySelector('.overlay:not([hidden])')) return;
  if (ev.key === ' ' || ev.key === 'r' || ev.key === 'R') {
    if (ev.key === ' ' && ev.target.closest('button')) return;
    ev.preventDefault();
    if (ui.model?.canRoll) onRoll();
  } else if (/^[1-5]$/.test(ev.key)) {
    onHold(Number(ev.key) - 1);
  }
});

function onRoll() {
  if (!ui.model?.canRoll) return;
  ui.armed = null;
  if (ui.kind === 'solo') {
    solo.roll();
    renderSolo();
  } else {
    room.conn?.send({ type: 'roll' });
  }
}

function onHold(i) {
  if (!ui.model?.canHold) return;
  ui.armed = null;
  if (ui.kind === 'solo') {
    solo.toggleHold(i);
    renderSolo();
  } else {
    // 바로 보여주고, 서버 상태가 오면 그걸로 맞춘다.
    const held = !ui.model.held[i];
    ui.model.held[i] = held;
    diceButtons[i].classList.toggle('held', held);
    room.conn?.send({ type: 'hold', index: i, held });
  }
}

function onPick(cat) {
  const m = ui.model;
  if (!m?.canScore) return;
  if (ui.armed !== cat) {
    ui.armed = cat;
    renderGame(m);
    return;
  }
  ui.armed = null;
  if (ui.kind === 'solo') {
    const result = solo.score(cat);
    renderSolo();
    if (result) {
      soloResult = result;
      showResult(true);
    }
  } else {
    room.conn?.send({ type: 'score', category: cat });
  }
}

/**
 * 게임 화면 그리기.
 * model: { round, turn: {name, cls, me} | null, deadline, now(), dice, held, rollsLeft, rollSeq,
 *          canRoll, canHold, canScore, finished, columns: [...], previewCol, teams, waitingText }
 */
function renderGame(m) {
  ui.model = m;
  $('round-now').textContent = String(m.round);

  // 차례 표시
  const turn = $('turn-label');
  turn.replaceChildren();
  if (m.turn) {
    turn.append(pennant(m.turn.cls), el('span', '', m.turn.me ? '내 차례' : `${m.turn.name} 차례`));
  } else if (m.finished) {
    turn.append(el('span', '', '게임 끝'));
  }

  // 주사위
  const rolled = ui.lastRollSeq !== null && m.rollSeq > ui.lastRollSeq;
  diceButtons.forEach((b, i) => {
    paintDie(b, m.dice[i] ?? 0);
    b.classList.toggle('held', !!m.held[i] && m.rollsLeft < ROLLS_PER_TURN);
    b.disabled = !m.canHold;
    b.setAttribute('aria-pressed', String(!!m.held[i]));
    if (rolled && !m.held[i]) {
      b.classList.remove('rolling');
      void b.offsetWidth; // 애니메이션 다시 시작
      b.classList.add('rolling');
    }
  });
  ui.lastRollSeq = m.rollSeq;

  // 안내 문구
  let hint = '';
  if (m.finished) hint = '게임이 끝났어요';
  else if (!m.turn?.me) hint = m.waitingText ?? '';
  else if (ui.armed) hint = `한 번 더 누르면 ${CATEGORY_INFO[ui.armed].name}에 ${scoreFor(ui.armed, m.dice)}점을 적어요`;
  else if (m.rollsLeft === ROLLS_PER_TURN) hint = '주사위를 굴려서 시작해요';
  else if (m.rollsLeft > 0) hint = '남길 주사위를 눌러 고정하거나, 점수판에서 칸을 골라요';
  else hint = '점수판에서 적을 칸을 골라요';
  $('tray-hint').textContent = hint;

  // 굴리기 버튼
  const btn = $('roll-btn');
  const label = $('roll-label');
  btn.disabled = !(m.canRoll || m.finished);
  if (m.finished) label.textContent = '결과 보기';
  else if (!m.turn?.me) label.textContent = '기다리는 중';
  else if (m.rollsLeft === ROLLS_PER_TURN) label.textContent = '굴리기';
  else if (m.rollsLeft > 0) label.textContent = '다시 굴리기';
  else label.textContent = '칸을 골라 적어요';
  $('roll-pips').hidden = m.finished || !m.turn?.me;
  $('roll-pips').querySelectorAll('i').forEach((pip, i) => {
    pip.classList.toggle('used', i < ROLLS_PER_TURN - m.rollsLeft);
  });

  renderSheet(m);
  updateTimer();
}

function tdClass(c) {
  return [c.now ? 'now' : '', c.teamStart ? 'team-start' : ''].join(' ').trim();
}

function renderSheet(m) {
  const table = $('sheet');
  const focused = document.activeElement?.closest?.('#sheet button')?.dataset.cat;
  table.replaceChildren();
  const cols = m.columns;
  table.style.setProperty('--col-w', `${Math.max(14, Math.floor(60 / cols.length))}%`);

  const thead = el('thead');
  const hr = el('tr');
  hr.append(el('th', '', ''));
  for (const c of cols) {
    const th = el('th', [c.now ? 'now' : '', c.teamStart ? 'team-start' : ''].join(' ').trim());
    const ph = el('div', 'ph');
    // 상태 줄은 비어 있어도 자리를 차지해서 머리글 높이를 맞춘다.
    ph.append(pennant(c.cls), el('span', 'nm', c.name), el('span', 'st', c.status || '\u00a0'));
    th.append(ph);
    hr.append(th);
  }
  thead.append(hr);
  table.append(thead);

  const tbody = el('tbody');
  const addCatRow = (cat) => {
    const tr = el('tr');
    const th = el('th', 'cat');
    th.scope = 'row';
    th.append(el('span', 'cat-name', CATEGORY_INFO[cat].name), el('span', 'cat-hint', CATEGORY_INFO[cat].hint));
    tr.append(th);
    cols.forEach((c, i) => {
      const td = el('td', tdClass(c));
      const value = c.scores[cat];
      if (value !== undefined) {
        const cell = el('div', 'cell', String(value));
        if (c.just === cat) cell.classList.add('just');
        td.append(cell);
      } else if (m.previewCol === i && m.canScore) {
        const s = scoreFor(cat, m.dice);
        const b = el('button', `cell preview${s === 0 ? ' zero' : ''}${ui.armed === cat ? ' armed' : ''}`, String(s));
        b.type = 'button';
        b.dataset.cat = cat;
        b.setAttribute('aria-label', `${CATEGORY_INFO[cat].name}에 ${s}점 적기`);
        b.addEventListener('click', () => onPick(cat));
        td.append(b);
      } else {
        td.append(el('div', 'cell', ''));
      }
      tr.append(td);
    });
    tbody.append(tr);
  };

  const addSubRow = (label, values, cls = 'sub') => {
    const tr = el('tr', cls);
    const th = el('th', 'cat', label);
    th.scope = 'row';
    tr.append(th);
    cols.forEach((c, i) => {
      const td = el('td', tdClass(c));
      const v = values(c, i);
      const cell = el('div', 'cell', v.text);
      if (v.cls) cell.classList.add(v.cls);
      td.append(cell);
      tr.append(td);
    });
    tbody.append(tr);
  };

  for (const cat of UPPER) addCatRow(cat);
  addSubRow('상단 합계', (c) => ({ text: `${c.upper} / ${UPPER_BONUS_THRESHOLD}` }));
  addSubRow('보너스', (c) => {
    if (c.bonus) return { text: `+${UPPER_BONUS}`, cls: 'bonus-got' };
    const upperDone = UPPER.every((cat) => c.scores[cat] !== undefined);
    return { text: upperDone ? '0' : '' };
  }, 'sub divider');
  for (const cat of CATEGORIES.filter((c) => !UPPER.includes(c))) addCatRow(cat);
  addSubRow('총점', (c) => ({ text: String(c.total) }), 'total');

  if (m.teams) {
    const tr = el('tr', 'total team-total');
    const th = el('th', 'cat', '팀 합계');
    th.scope = 'row';
    tr.append(th);
    for (const t of m.teams) {
      const td = el('td', t.team === 1 ? 'team-start' : '');
      td.colSpan = t.span;
      td.append(el('div', 'cell', String(t.total)));
      tr.append(td);
    }
    tbody.append(tr);
  }

  table.append(tbody);
  if (focused) table.querySelector(`button[data-cat="${focused}"]`)?.focus();
}

function updateTimer() {
  const m = ui.model;
  const box = $('timer');
  if (!m || !m.deadline || m.finished) {
    box.hidden = true;
    return;
  }
  const total = m.turnMs;
  const left = Math.max(0, m.deadline - m.now());
  box.hidden = false;
  box.classList.toggle('low', left <= 10_000);
  $('timer-fill').style.transform = `scaleX(${Math.min(1, left / total)})`;
  $('timer-text').textContent = `${Math.ceil(left / 1000)}초`;
}
setInterval(updateTimer, 250);

/** 게임 상태를 비우고 연결을 닫는다. */
function leaveGameState() {
  ui.kind = null;
  ui.model = null;
  ui.armed = null;
  ui.lastRollSeq = null;
  closeOverlay('result');
}

/* ---------------------------------------------------------------- 혼자 하기 */

let solo = null;
let soloResult = null;

function startSolo() {
  leaveGameState();
  ui.kind = 'solo';
  solo = new SoloGame();
  soloResult = null;
  show('game');
  renderSolo();
  $('roll-btn').focus();
}

function renderSolo() {
  const m = {
    round: solo.round,
    turn: solo.done ? null : { name: '나', cls: 'c0', me: true },
    deadline: null,
    dice: solo.dice,
    held: solo.held,
    rollsLeft: solo.rollsLeft,
    rollSeq: solo.rollSeq,
    canRoll: !solo.done && solo.rollsLeft > 0,
    canHold: !solo.done && solo.rollsLeft > 0 && solo.rollsLeft < ROLLS_PER_TURN,
    canScore: !solo.done && solo.rollsLeft < ROLLS_PER_TURN,
    finished: solo.done,
    previewCol: 0,
    teams: null,
    columns: [{
      name: '나',
      cls: 'c0',
      status: bestScore() === null ? '' : `최고 ${bestScore()}`,
      scores: solo.sheet,
      upper: upperSubtotal(solo.sheet),
      bonus: bonusFor(solo.sheet),
      total: totalFor(solo.sheet),
      now: !solo.done,
      just: solo.lastScored?.category,
    }],
  };
  renderGame(m);
  solo.lastScored = null;
}

/* ---------------------------------------------------------------- 같이 하기: 방 만들기 / 들어가기 */

let selectedMode = '1v1';
for (const btn of document.querySelectorAll('.mode')) {
  btn.addEventListener('click', () => {
    selectedMode = btn.dataset.mode;
    for (const b of document.querySelectorAll('.mode')) b.setAttribute('aria-checked', String(b === btn));
  });
}

function showOnline(prefillCode = '') {
  leaveGameState();
  show('online');
  $('nick').value = nickname();
  $('room-code').value = prefillCode;
  $('online-error').textContent = apiBase() ? '' : '같이 하기 서버가 아직 연결되지 않았어요. 혼자 하기는 바로 할 수 있어요.';
  if (!$('nick').value) $('nick').focus();
  else if (prefillCode) $('join-room').focus();
}

function readNick() {
  const name = $('nick').value.replace(/\s+/g, ' ').trim();
  if (!name) {
    $('online-error').textContent = '닉네임을 입력해 주세요';
    $('nick').focus();
    return null;
  }
  try {
    localStorage.setItem(NICK_KEY, name);
  } catch {
    // 무시
  }
  return name;
}

$('create-room').addEventListener('click', async () => {
  const name = readNick();
  if (!name) return;
  const btn = $('create-room');
  btn.disabled = true;
  $('online-error').textContent = '';
  try {
    const code = await createRoom(selectedMode);
    enterRoom(code, name);
  } catch (err) {
    $('online-error').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

function joinFromInput() {
  const name = readNick();
  if (!name) return;
  const code = $('room-code').value.trim().toUpperCase();
  if (code.length !== 4) {
    $('online-error').textContent = '방 코드 4글자를 입력해 주세요';
    $('room-code').focus();
    return;
  }
  enterRoom(code, name);
}
$('join-room').addEventListener('click', joinFromInput);
$('room-code').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') joinFromInput();
});
$('room-code').addEventListener('input', () => {
  $('room-code').value = $('room-code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

/* ---------------------------------------------------------------- 같이 하기: 방 */

const room = { conn: null, view: null, code: null };

function enterRoom(code, name) {
  room.conn?.close();
  leaveGameState();
  ui.kind = 'online';
  room.code = code;
  room.view = null;
  ui.lastMatch = null;
  ui.lastScoredKey = null;
  ui.lastTurnKey = null;
  ui.resultShownFor = null;
  setUrlRoom(code);
  $('lobby-code').textContent = code;
  $('lobby-title').textContent = '대기실';
  $('lobby-seats').replaceChildren();
  $('lobby-note').textContent = '방에 들어가는 중…';
  $('start-game').hidden = true;
  show('lobby');

  room.conn = new RoomConnection({
    code,
    name,
    onState: onRoomState,
    onError: (message, fatal) => {
      if (fatal) {
        room.conn = null;
        showOnline(code);
        $('online-error').textContent = message;
        setUrlRoom(null);
      } else if (!$('game').hidden) {
        toast(message);
      } else {
        $('lobby-note').textContent = message;
      }
    },
    onStatus: (status) => {
      const banner = $('conn-banner');
      if (status === 'reconnecting') {
        banner.textContent = '연결이 끊겨서 다시 연결하는 중이에요';
        banner.hidden = false;
      } else {
        banner.hidden = true;
      }
    },
  });
  room.conn.connect();
}

function leaveRoom() {
  room.conn?.leave();
  room.conn = null;
  room.view = null;
  $('conn-banner').hidden = true;
  showOnline();
  setUrlRoom(null);
}

$('lobby-leave').addEventListener('click', leaveRoom);
$('start-game').addEventListener('click', () => room.conn?.send({ type: 'start' }));
$('copy-invite').addEventListener('click', async () => {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', room.code);
  const link = url.toString();
  const btn = $('copy-invite');
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ title: '야추 같이 해요', text: `방 코드 ${room.code}`, url: link });
      return;
    }
    await navigator.clipboard.writeText(link);
    btn.textContent = '복사했어요';
  } catch {
    btn.textContent = link;
  }
  setTimeout(() => {
    btn.textContent = '초대 링크 복사';
  }, 2500);
});

function playerCls(view, seat) {
  const p = view.players[seat];
  return view.mode === '2v2' ? `t${p?.team ?? 0}` : `c${seat}`;
}

function onRoomState(view) {
  const prev = room.view;
  room.view = view;
  if (view.you < 0) return;

  if (view.phase === 'lobby') {
    closeOverlay('result');
    renderLobby(view);
    show('lobby');
    return;
  }

  if ($('game').hidden) {
    show('game');
    ui.lastRollSeq = null;
  }
  if (ui.lastMatch !== view.match) {
    ui.lastMatch = view.match;
    ui.lastRollSeq = null;
    ui.armed = null;
    closeOverlay('result');
  }

  const g = view.game;
  const nameOf = (seat) => view.players[seat]?.name ?? '';

  // 다른 사람이 적은 점수, 시간 초과 알림
  let justScored = null;
  if (g.lastScored) {
    const key = `${view.match}:${g.lastScored.seat}:${g.lastScored.category}`;
    if (key !== ui.lastScoredKey) {
      const first = ui.lastScoredKey === null && prev === null;
      if (!first) justScored = g.lastScored;
      ui.lastScoredKey = key;
      const { seat, category, score, auto } = g.lastScored;
      const what = `${CATEGORY_INFO[category].name} ${score}점`;
      if (!first) {
        if (seat === view.you && auto) toast(`시간이 지나 ${what}을 대신 적었어요`);
        else if (seat !== view.you) toast(`${nameOf(seat)}: ${what}${auto ? ' (시간 초과)' : ''}`);
      }
    }
  }

  // 차례가 바뀌면 고른 칸을 풀어 둔다
  const turnSheetNow = g.sheets.find((s) => s.seat === g.turn);
  const turnKey = `${view.match}:${g.turn}:${turnSheetNow ? filledCount(turnSheetNow.scores) : ''}`;
  if (turnKey !== ui.lastTurnKey) {
    ui.lastTurnKey = turnKey;
    ui.armed = null;
  }
  if (ui.armed && g.rollSeq !== ui.model?.rollSeq) ui.armed = null;

  const finished = view.phase === 'finished';
  const myTurn = !finished && g.turn === view.you;

  // 열 순서: 2:2는 팀끼리 묶고, 그 외는 차례 순서
  let order = [...g.order];
  if (view.mode === '2v2') {
    order.sort((a, b) => (view.players[a].team - view.players[b].team) || (g.order.indexOf(a) - g.order.indexOf(b)));
  }
  const sheetOf = (seat) => g.sheets.find((s) => s.seat === seat);

  const columns = order.map((seat, i) => {
    const p = view.players[seat];
    const s = sheetOf(seat);
    let status = '';
    if (p.left) status = '기권';
    else if (!p.connected) status = '연결 끊김';
    else if (seat === view.you) status = '나';
    return {
      name: p.name,
      cls: playerCls(view, seat),
      status,
      scores: s.scores,
      upper: s.upper,
      bonus: s.bonus,
      total: s.total,
      now: !finished && seat === g.turn,
      just: justScored && justScored.seat === seat ? justScored.category : null,
      teamStart: view.mode === '2v2' && i > 0 && p.team !== view.players[order[i - 1]].team,
    };
  });

  let teams = null;
  if (view.mode === '2v2') {
    teams = [0, 1].map((team) => ({
      team,
      span: order.filter((seat) => view.players[seat].team === team).length,
      total: order.filter((seat) => view.players[seat].team === team).reduce((a, seat) => a + sheetOf(seat).total, 0),
    }));
  }

  const turnSheet = sheetOf(g.turn);
  const m = {
    round: finished ? 12 : Math.min(12, (turnSheet ? filledCount(turnSheet.scores) : 0) + 1),
    turn: finished ? null : { name: nameOf(g.turn), cls: playerCls(view, g.turn), me: myTurn },
    deadline: finished ? null : g.turnDeadline,
    turnMs: view.players[g.turn]?.connected === false ? 10_000 : 60_000,
    now: () => room.conn?.now() ?? Date.now(),
    dice: g.dice,
    held: g.held,
    rollsLeft: g.rollsLeft,
    rollSeq: g.rollSeq,
    canRoll: myTurn && g.rollsLeft > 0,
    canHold: myTurn && g.rollsLeft > 0 && g.rollsLeft < ROLLS_PER_TURN,
    canScore: myTurn && g.rollsLeft < ROLLS_PER_TURN,
    finished,
    previewCol: myTurn ? order.indexOf(view.you) : null,
    teams,
    columns,
    waitingText: finished ? '' : `${nameOf(g.turn)}님이 굴리는 중이에요`,
  };
  renderGame(m);

  if (finished && ui.resultShownFor !== view.match) {
    ui.resultShownFor = view.match;
    showResult(true);
  } else if (finished && !$('result').hidden) {
    showResult(true); // 방장이 바뀌는 등 내용이 바뀌었을 수 있다
  }
}

function renderLobby(view) {
  $('lobby-title').textContent = `${MODE_LABEL[view.mode]} 대기실`;
  $('lobby-code').textContent = view.code;
  const box = $('lobby-seats');
  box.replaceChildren();
  const isHost = view.host === view.you;

  const seatEl = (seat) => {
    const p = view.players[seat];
    const row = el('div', 'seat');
    row.append(pennant(playerCls(view, seat)), el('span', 'name', p.name));
    if (seat === view.you) row.append(el('span', 'tag me', '나'));
    if (seat === view.host) row.append(el('span', 'tag', '방장'));
    if (!p.connected) row.append(el('span', 'tag', '연결 끊김'));
    return row;
  };
  const emptyEl = () => {
    const row = el('div', 'seat empty');
    row.append(pennant(''), el('span', 'name', '빈 자리'));
    return row;
  };

  if (view.mode === '2v2') {
    box.className = 'seats teams';
    for (const team of [0, 1]) {
      const col = el('div', 'team-col');
      const h = el('h3');
      h.append(pennant(`t${team}`), el('span', '', TEAM_NAME[team]));
      col.append(h);
      const members = view.players.filter((p) => p.team === team);
      for (const p of members) col.append(seatEl(p.seat));
      for (let i = members.length; i < 2; i++) col.append(emptyEl());
      const mine = view.players[view.you]?.team === team;
      if (!mine && members.length < 2) {
        const b = el('button', 'btn btn-ghost', '이 팀으로');
        b.type = 'button';
        b.addEventListener('click', () => room.conn?.send({ type: 'team', team }));
        col.append(b);
      }
      box.append(col);
    }
  } else {
    box.className = 'seats';
    for (const p of view.players) box.append(seatEl(p.seat));
    for (let i = view.players.length; i < view.seats; i++) box.append(emptyEl());
  }

  const missing = view.seats - view.players.length;
  const balanced = view.mode !== '2v2' || [0, 1].every((t) => view.players.filter((p) => p.team === t).length === 2);
  let note;
  if (missing > 0) note = `${missing}명 더 들어오면 시작할 수 있어요. 방 코드나 초대 링크를 보내 주세요.`;
  else if (!balanced) note = '팀마다 두 명씩 맞춰 주세요';
  else if (isHost) note = '모두 모였어요. 시작해 볼까요?';
  else note = '모두 모였어요. 방장이 시작하면 게임이 시작돼요.';
  $('lobby-note').textContent = note;

  const start = $('start-game');
  start.hidden = !isHost;
  start.disabled = missing > 0 || !balanced;
}

/* ---------------------------------------------------------------- 결과 */

function showResult(open) {
  const title = $('result-title');
  const sub = $('result-sub');
  const list = $('standings');
  const actions = $('result-actions');
  list.replaceChildren();
  actions.replaceChildren();
  const actionBtn = (text, cls, fn) => {
    const b = el('button', `btn ${cls}`, text);
    b.type = 'button';
    b.addEventListener('click', fn);
    actions.append(b);
    return b;
  };
  const viewSheet = () => closeOverlay('result');

  if (ui.kind === 'solo') {
    const total = solo.total;
    const best = bestScore();
    title.textContent = '끝!';
    sub.replaceChildren(
      el('div', 'big-score', `${total}`),
      el('div', '', soloResult?.newBest ? '새 최고 기록이에요' : `최고 기록 ${best ?? total}점`),
    );
    $('result-note').textContent = '';
    actionBtn('점수판 보기', 'btn-ghost', viewSheet);
    actionBtn('한 판 더', 'btn-primary', () => {
      closeOverlay('result');
      solo.reset();
      soloResult = null;
      ui.lastRollSeq = null;
      renderSolo();
    });
    if (open) openOverlay('result');
    return;
  }

  const view = room.view;
  if (!view?.game?.standings) return;
  const { players, teams } = view.game.standings;
  const me = view.you;
  const nameOf = (seat) => view.players[seat]?.name ?? '';
  const forfeit = view.game.endReason === 'forfeit';

  const row = (rank, cls, name, note, total, first) => {
    const li = el('li', first ? 'first' : '');
    const nm = el('span', 'nm', name);
    if (note) nm.append(el('small', '', note));
    li.append(el('span', 'rk', `${rank}`), pennant(cls), nm, el('span', 'sc', String(total)));
    list.append(li);
  };

  if (teams) {
    const myTeam = view.players[me]?.team;
    const top = teams.filter((t) => t.rank === 1);
    if (top.length > 1) title.textContent = '무승부';
    else if (top[0].team === myTeam) title.textContent = '우리 팀 승리!';
    else title.textContent = `${TEAM_NAME[top[0].team]} 승리`;
    sub.textContent = forfeit ? '한 사람이 나가서 그 팀의 기권패로 끝났어요' : '두 사람 점수를 더한 팀 총점이에요';
    for (const t of teams) {
      const names = t.seats.map(nameOf).join(', ');
      row(t.rank, `t${t.team}`, TEAM_NAME[t.team], `${names}${t.left ? ' · 기권' : ''}`, t.total, t.rank === 1 && top.length === 1);
    }
  } else {
    const top = players.filter((p) => p.rank === 1);
    if (top.length > 1) title.textContent = top.some((p) => p.seat === me) ? '공동 1등!' : '공동 1등';
    else if (top[0].seat === me) title.textContent = '이겼어요!';
    else title.textContent = `${nameOf(top[0].seat)} 승리`;
    sub.textContent = forfeit ? '상대가 나가서 끝났어요' : '';
    for (const p of players) {
      const note = [p.seat === me ? '나' : '', p.left ? '기권' : ''].filter(Boolean).join(' · ');
      row(p.rank, playerCls(view, p.seat), nameOf(p.seat), note, p.total, p.rank === 1 && top.length === 1);
    }
  }

  actionBtn('점수판 보기', 'btn-ghost', viewSheet);
  if (view.host === me) {
    actionBtn('다시 하기', 'btn-primary', () => room.conn?.send({ type: 'rematch' }));
    $('result-note').textContent = '';
  } else {
    actionBtn('나가기', 'btn-secondary', leaveRoom);
    $('result-note').textContent = '방장이 다시 하기를 누르면 같은 방에서 한 판 더 해요';
  }
  if (open) openOverlay('result');
}

/* ---------------------------------------------------------------- 시작 */

function boot() {
  paintHomeDice();
  const params = new URLSearchParams(location.search);
  const linked = (params.get('room') ?? '').toUpperCase();
  const active = activeRoom();
  if (active && (!linked || linked === active)) {
    enterRoom(active, nickname());
  } else if (/^[A-Z0-9]{4}$/.test(linked)) {
    showOnline(linked);
  } else {
    showHome();
  }
}

boot();
