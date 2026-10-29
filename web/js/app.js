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
import { bestScore, claimSolo, clearSoloSaves, fetchRankings, hasSoloInProgress, myRankingIds, openSolo, savedInitials, submitRanking } from './solo.js';
import { RoomConnection, activeRoom, apiBase, createRoom } from './net.js';
import { ITEMS, ITEM_BY_ID, SLOTS, renderAvatar } from './avatar.js';
import {
  authToken, buyItem, currentUser, devLogin, isLocalDev, loginAvailable, logout, mountGoogleButton,
  onAccountChange, refreshMe, saveProfile, updatePoints,
} from './account.js';
import { GOOGLE_CLIENT_ID } from './config.js';
import { JEERS, NICKNAME_CHANGE_COST, scorePoints } from './points.js';
import { fillAds } from './ads.js';
import { IS_APP, SITE_URL, exitApp, nativeShare, onBackButton, vibrate } from './native.js';

const $ = (id) => document.getElementById(id);
const MODE_LABEL = { '1v1': '1:1', '1v1v1': '1:1:1', '2v2': '2:2' };
const TEAM_NAME = ['빨강 팀', '파랑 팀'];
const NICK_KEY = 'yacht.nick';

/* ---------------------------------------------------------------- 공통 */

function show(screen) {
  for (const id of ['home', 'online', 'lobby', 'game', 'ranking', 'closet']) $(id).hidden = id !== screen;
  $('flash').hidden = true;
  window.scrollTo(0, 0);
  document.body.scrollTop = 0; // 앱: body가 스크롤 영역 (style.css의 .app)
  requestAnimationFrame(() => fillAds(screen));
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
  for (const id of ['rules', 'confirm', 'login']) if (!$(id).hidden) closeOverlay(id);
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
  // 게임 화면에서는 트레이 아래, 다른 화면에서는 화면 위쪽에 띄운다.
  const inGame = !$('game').hidden;
  const box = inGame ? $('toast') : $('flash');
  $('toast').textContent = '';
  $('flash').hidden = true;
  box.textContent = text;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    box.textContent = '';
    if (!inGame) box.hidden = true;
  }, 3500);
}

let confirmAction = null;
function confirmExit(text, action, okText = '나가기') {
  $('confirm-text').textContent = text;
  $('confirm-ok').textContent = okText;
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
  const inProgress = hasSoloInProgress();
  soloBtn.textContent = inProgress ? '혼자 하기 이어서' : '혼자 하기';
  $('solo-new').hidden = !inProgress;
}

$('solo-new').addEventListener('click', () => {
  confirmExit('하던 게임을 버리고 처음부터 새로 할까요? 지금까지 적은 점수는 사라져요.', () => {
    clearSoloSaves();
    startSolo();
  }, '새로 하기');
});

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
    else if (to === 'ranking') showRanking();
    else if (to === 'closet') showCloset();
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
    if (room.view?.phase === 'playing' && !room.view.spectator) {
      confirmExit('게임 중에 나가면 기권이에요. 나갈까요?', leaveRoom);
    } else {
      leaveRoom();
    }
  }
});

$('game-restart').addEventListener('click', () => {
  if (ui.kind !== 'solo' || !solo) return;
  const restart = () => {
    closeOverlay('result');
    startSolo({ fresh: true });
  };
  const started = filledCount(solo.sheet) > 0 || solo.rollsLeft < ROLLS_PER_TURN;
  if (started && !solo.done) {
    confirmExit('지금 게임을 그만두고 처음부터 다시 할까요? 지금까지 적은 점수는 사라져요.', restart, '다시 하기');
  } else {
    restart();
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
  if (!ui.model?.canRoll || isRolling()) return;
  ui.armed = null;
  if (ui.kind === 'solo') {
    // 서버에서 굴리는 판은 결과를 기다리지 않고 바로 굴러가기 시작한다.
    if (solo.online) startRolling({ ...ui.model, rollsLeft: ui.model.rollsLeft - 1 }, { pending: true });
    soloAction(() => solo.roll());
  } else {
    startRolling({ ...ui.model, rollsLeft: ui.model.rollsLeft - 1 }, { pending: true });
    if (!room.conn?.send({ type: 'roll' })) stopRolling();
  }
}

function onHold(i) {
  if (!ui.model?.canHold || isRolling()) return;
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
  if (!m?.canScore || isRolling()) return;
  if (ui.armed !== cat) {
    ui.armed = cat;
    renderGame(m);
    return;
  }
  ui.armed = null;
  if (ui.kind === 'solo') {
    soloAction(async () => {
      const result = await solo.score(cat);
      if (result) soloResult = result;
    });
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
  $('game-restart').hidden = ui.kind !== 'solo';
  $('round-now').textContent = String(m.round);

  // 차례 표시
  const turn = $('turn-label');
  turn.replaceChildren();
  if (m.turn) {
    turn.append(m.turn.avatar ? miniAvatar(m.turn.avatar, 30) : pennant(m.turn.cls), el('span', '', m.turn.me ? '내 차례' : `${m.turn.name} 차례`));
  } else if (m.finished) {
    turn.append(el('span', '', '게임 끝'));
  }
  // 관전 인원: 누르면 누가 보고 있는지 목록이 뜬다.
  if (m.watching || m.watchers > 0) {
    const tag = el('button', 'tag watch', m.watching ? `관전 중 · ${m.watchers}명` : `관전 ${m.watchers}`);
    tag.type = 'button';
    tag.setAttribute('aria-label', `관전 ${m.watchers}명 보기`);
    tag.addEventListener('click', () => {
      renderWatcherList();
      openOverlay('watchers');
    });
    turn.append(tag);
  }

  // 주사위
  const rolled = ui.lastRollSeq !== null && m.rollSeq > ui.lastRollSeq;
  ui.lastRollSeq = m.rollSeq;
  if (rolled) {
    if (rollAnim.pending) settleRolling();
    else startRolling(m);
  }
  const rolling = isRolling();
  diceButtons.forEach((b, i) => {
    if (!rollAnim.dice.has(i)) paintDie(b, m.dice[i] ?? 0);
    b.classList.toggle('held', !!m.held[i] && m.rollsLeft < ROLLS_PER_TURN);
    b.disabled = !m.canHold || rolling;
    b.setAttribute('aria-pressed', String(!!m.held[i]));
  });

  // 안내 문구
  let hint = '';
  if (rolling) hint = '데구르르…';
  else if (m.finished) hint = '게임이 끝났어요';
  else if (!m.turn?.me) hint = m.waitingText ?? '';
  else if (ui.armed) hint = `한 번 더 누르면 ${CATEGORY_INFO[ui.armed].name}에 ${scoreFor(ui.armed, m.dice)}점을 적어요`;
  else if (m.rollsLeft === ROLLS_PER_TURN) hint = '주사위를 굴려서 시작해요';
  else if (m.rollsLeft > 0) hint = '남길 주사위를 눌러 고정하거나, 점수판에서 칸을 골라요';
  else hint = '점수판에서 적을 칸을 골라요';
  const hintBox = $('tray-hint');
  hintBox.replaceChildren();
  if (!rolling && !m.finished && m.turn && !m.turn.me && m.turn.avatar) {
    hintBox.classList.add('with-av');
    hintBox.append(miniAvatar(m.turn.avatar, 44), el('span', '', hint));
  } else {
    hintBox.classList.remove('with-av');
    hintBox.textContent = hint;
  }

  // 굴리기 버튼
  const btn = $('roll-btn');
  const label = $('roll-label');
  btn.disabled = rolling || !(m.canRoll || m.finished);
  if (m.finished) label.textContent = '결과 보기';
  else if (m.watching) label.textContent = '관전 중';
  else if (!m.turn?.me) label.textContent = '기다리는 중';
  else if (m.rollsLeft === ROLLS_PER_TURN) label.textContent = '굴리기';
  else if (m.rollsLeft > 0) label.textContent = '다시 굴리기';
  else label.textContent = '칸을 골라 적어요';
  $('roll-pips').hidden = m.finished || !m.turn?.me;
  // 관전 중에는 굴리기 대신 응원 버튼
  const cheering = !!m.cheers && !m.finished;
  btn.hidden = cheering;
  renderCheerRow(cheering ? m.cheers : null);
  $('roll-pips').querySelectorAll('i').forEach((pip, i) => {
    pip.classList.toggle('used', i < ROLLS_PER_TURN - m.rollsLeft);
  });

  renderSheet(m, rolling);
  updateTimer();
}

/* 굴리는 애니메이션: 고정 안 한 주사위가 굴러 들어오면서 눈이 바뀌다가 하나씩 멈춘다. */
const rollAnim = { dice: new Set(), timers: [], until: 0, pending: false, waiting: new Map(), endAt: 0, guard: null };
/** 결과를 기다리며 눈을 돌리는 시간의 최대치. 이 안에 결과가 안 오면 지금 눈으로 멈춘다. */
const PENDING_MAX_MS = 4000;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function isRolling() {
  return rollAnim.dice.size > 0;
}

function stopRolling() {
  clearTimeout(rollAnim.guard);
  rollAnim.guard = null;
  for (const t of rollAnim.timers) clearTimeout(t);
  for (const t of rollAnim.waiting.values()) clearInterval(t);
  rollAnim.timers = [];
  rollAnim.waiting.clear();
  rollAnim.dice.clear();
  rollAnim.pending = false;
  for (const b of diceButtons) b.classList.remove('rolling', 'waiting');
  $('tray').classList.remove('landing');
}

/**
 * 굴리기 애니메이션. 고정 안 한 주사위가 굴러 들어오면서 눈이 바뀌다가 하나씩 멈춘다.
 * pending이면 결과(눈)를 아직 모르는 상태로 먼저 굴리기 시작한다. 결과가 오면 settleRolling()이 멈춘다.
 */
function startRolling(m, { pending = false } = {}) {
  stopRolling();
  const moving = diceButtons.map((_, i) => i).filter((i) => !(m.held[i] && m.rollsLeft < ROLLS_PER_TURN - 1));
  // 시간 초과로 대신 굴리고 바로 다음 차례로 넘어간 경우는 보여줄 주사위가 없다.
  if (moving.length === 0 || m.rollsLeft === ROLLS_PER_TURN) return;
  if (reducedMotion.matches) {
    if (!pending && isYacht(m.dice)) celebrateYacht(m.turn);
    return;
  }
  rollAnim.pending = pending;
  if (pending) {
    // 안전장치: 요청이 서버에 닿지 못했거나(연결 끊김 등) 결과가 오지 않으면 눈이 계속 돌지 않게 멈춘다.
    rollAnim.guard = setTimeout(() => {
      if (rollAnim.pending) settleRolling();
    }, PENDING_MAX_MS);
  }

  const tray = $('tray');
  void tray.offsetWidth;
  tray.classList.add('landing');

  let longest = 0;
  moving.forEach((i, order) => {
    const b = diceButtons[i];
    rollAnim.dice.add(i);
    const ms = 620 + order * 90 + Math.floor(Math.random() * 80);
    longest = Math.max(longest, ms);
    const dir = Math.random() < 0.5 ? -1 : 1;
    b.style.setProperty('--roll-ms', `${ms}ms`);
    b.style.setProperty('--from-x', `${-(40 + Math.random() * 50)}px`);
    b.style.setProperty('--spin', `${dir * (360 + Math.floor(Math.random() * 360))}deg`);
    b.classList.remove('rolling', 'waiting');
    void b.offsetWidth; // 애니메이션 다시 시작
    b.classList.add('rolling');
    b.disabled = true;

    // 눈이 처음엔 빠르게, 점점 느리게 바뀌다가 진짜 눈에서 멈춘다.
    let elapsed = 0;
    let gap = 45;
    let face = 1 + Math.floor(Math.random() * 6);
    while (elapsed + gap < ms * 0.78) {
      elapsed += gap;
      face = (face + 1 + Math.floor(Math.random() * 5)) % 6 || 6;
      const f = face;
      rollAnim.timers.push(setTimeout(() => paintDie(b, f), elapsed));
      gap = Math.min(gap * 1.22, 160);
    }
    rollAnim.timers.push(setTimeout(() => {
      if (rollAnim.pending) {
        // 결과가 아직 안 왔으면 제자리에서 흔들리며 눈이 계속 바뀐다.
        b.classList.add('waiting');
        let f = Number(b.dataset.face) || 1;
        rollAnim.waiting.set(i, setInterval(() => {
          f = (f + 1 + Math.floor(Math.random() * 5)) % 6 || 6;
          paintDie(b, f);
        }, 110));
        return;
      }
      landDie(i);
    }, Math.round(ms * 0.8)));
    rollAnim.timers.push(setTimeout(() => b.classList.remove('rolling'), ms + 20));
  });
  rollAnim.endAt = performance.now() + longest;
}

/** 주사위 하나를 진짜 눈으로 멈춘다. 마지막 주사위면 화면을 다시 그리고, 야추면 축하한다. */
function landDie(i) {
  const b = diceButtons[i];
  clearInterval(rollAnim.waiting.get(i));
  rollAnim.waiting.delete(i);
  b.classList.remove('waiting');
  rollAnim.dice.delete(i);
  paintDie(b, ui.model?.dice[i] ?? 0);
  if (isRolling()) return;
  $('tray').classList.remove('landing');
  if (!ui.model) return;
  renderGame(ui.model);
  if (isYacht(ui.model.dice)) {
    const who = ui.model.turn;
    // 굴러 들어오는 움직임이 끝난 뒤에 축하한다.
    rollAnim.timers.push(setTimeout(() => celebrateYacht(who), Math.max(0, rollAnim.endAt - performance.now()) + 60));
  }
}

/** 먼저 굴리기 시작한 주사위의 결과가 왔다. 흔들리며 기다리던 주사위는 하나씩 멈추고, 아직 굴러가는 주사위는 원래 시간에 멈춘다. */
function settleRolling() {
  rollAnim.pending = false;
  clearTimeout(rollAnim.guard);
  rollAnim.guard = null;
  [...rollAnim.waiting.keys()].forEach((i, n) => {
    clearInterval(rollAnim.waiting.get(i));
    rollAnim.waiting.set(i, undefined);
    rollAnim.timers.push(setTimeout(() => landDie(i), 70 + n * 90));
  });
}

function isYacht(dice) {
  return dice.length === 5 && dice[0] > 0 && dice.every((d) => d === dice[0]);
}

/*
 * 관전자 응원·야유.
 * 응원(무료): 그 팀(사람) 점수판 위로 깃발 팡파레.
 * 야유(로그인, 포인트 차감): 뿅망치로 때리기, 바나나 껍질 던지기.
 * 서버가 방 안 모두에게 보내서 참가자 화면에도 똑같이 보인다.
 */
const WATCH_ACTIONS = [
  { id: 'cheer', name: '응원', cost: 0 },
  ...Object.entries(JEERS).map(([id, j]) => ({ id, name: j.short, cost: j.cost })),
];
let cheerKey = '';
function renderCheerRow(cheers) {
  const row = $('cheer-row');
  row.hidden = !cheers;
  const me = currentUser();
  const action = ui.watchAction ?? 'cheer';
  const key = cheers ? `${action}|${me ? me.points : '-'}|${cheers.map((c) => `${c.target}:${c.name}`).join('|')}` : '';
  if (key === cheerKey) return;
  cheerKey = key;
  row.replaceChildren();
  if (!cheers) return;

  const tabs = el('div', 'act-tabs');
  tabs.setAttribute('role', 'radiogroup');
  tabs.setAttribute('aria-label', '관전 액션');
  for (const a of WATCH_ACTIONS) {
    const t = el('button', `act-tab act-${a.id}`);
    t.type = 'button';
    t.setAttribute('role', 'radio');
    t.setAttribute('aria-checked', String(a.id === action));
    t.append(actionIcon(a.id), el('span', '', a.name));
    if (a.cost) t.append(el('small', '', `${a.cost}P`));
    t.addEventListener('click', () => {
      ui.watchAction = a.id;
      renderCheerRow(cheers);
    });
    tabs.append(t);
  }

  const targets = el('div', 'act-targets');
  targets.style.setProperty('--n', String(cheers.length));
  const jeer = action !== 'cheer';
  for (const c of cheers) {
    const b = el('button', `btn btn-cheer ${c.cls}${jeer ? ' jeer' : ''}`);
    b.type = 'button';
    const verb = action === 'cheer' ? '응원' : JEERS[action].short;
    b.append(pennant(c.cls), el('span', '', `${c.name} ${verb}`));
    b.addEventListener('click', () => {
      if (b.classList.contains('cooling')) return;
      if (jeer && !currentUser()) {
        openLogin();
        return;
      }
      const msg = jeer ? { type: 'jeer', action, target: c.target } : { type: 'cheer', target: c.target };
      if (!room.conn?.send(msg)) return;
      b.classList.add('cooling');
      setTimeout(() => b.classList.remove('cooling'), jeer ? 1500 : 800);
    });
    targets.append(b);
  }

  const note = el('p', 'act-note');
  if (!jeer) note.textContent = '응원은 무료예요';
  else if (!me) note.textContent = '로그인하면 포인트로 야유할 수 있어요';
  else note.textContent = `한 번에 ${JEERS[action].cost}P · 내 포인트 ${me.points.toLocaleString()}P`;
  row.append(tabs, targets, note);
}

function actionIcon(id) {
  const box = el('span', 'act-icon');
  box.setAttribute('aria-hidden', 'true');
  box.innerHTML = id === 'hammer' ? HAMMER_SVG : id === 'banana' ? BANANA_SVG : '';
  if (id === 'cheer') box.append(pennant('gold'));
  return box;
}

const HAMMER_SVG = '<svg viewBox="0 0 80 80"><rect x="35" y="30" width="10" height="46" rx="5" fill="#f5c518" stroke="#13234a" stroke-width="3"/><rect x="8" y="6" width="64" height="30" rx="11" fill="#d83a2e" stroke="#13234a" stroke-width="3"/><rect x="8" y="6" width="14" height="30" rx="7" fill="#f5c518" stroke="#13234a" stroke-width="3"/><rect x="58" y="6" width="14" height="30" rx="7" fill="#f5c518" stroke="#13234a" stroke-width="3"/></svg>';
const BANANA_SVG = '<svg viewBox="0 0 120 84"><ellipse cx="60" cy="66" rx="44" ry="9" fill="#13234a" opacity=".18"/><g stroke="#13234a" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"><path d="M56 48 C44 43 26 43 9 52 C6 55 8 60 12 60 C26 60 42 60 56 62 Z" fill="#f7d02c"/><path d="M54 52 C42 50 28 51 16 56 C30 55 42 55 54 57 Z" fill="#fff4c2" stroke="none"/><path d="M62 48 C76 41 94 39 111 46 C114 49 112 54 108 54 C94 56 78 59 64 62 Z" fill="#f7d02c"/><path d="M64 52 C76 48 92 47 104 50 C90 51 78 53 64 57 Z" fill="#fff4c2" stroke="none"/><path d="M55 57 C51 66 46 72 38 77 C35 80 39 83 43 82 C55 77 61 70 65 59 Z" fill="#f2c214"/><path d="M58 60 C55 66 52 71 46 76 C53 73 58 68 61 61 Z" fill="#fff4c2" stroke="none"/><path d="M52 56 C50 44 52 30 58 20 C60 18 64 18 65 21 C68 32 68 46 66 58 C62 61 56 61 52 56 Z" fill="#f7d02c"/><path d="M58 24 C56 34 56 46 57 55" fill="none" stroke="#e0a800" stroke-width="2"/><path d="M59 20 L61 9 C62 6 66 7 66 10 L65 21" fill="#7a5a12"/><circle cx="11" cy="56.5" r="2.4" fill="#6b4e10" stroke="none"/><circle cx="109.5" cy="50.5" r="2.4" fill="#6b4e10" stroke="none"/><circle cx="42" cy="79.5" r="2.4" fill="#6b4e10" stroke="none"/><circle cx="30" cy="51" r="1.6" fill="#a37c17" stroke="none"/><circle cx="88" cy="47" r="1.6" fill="#a37c17" stroke="none"/><circle cx="61" cy="36" r="1.5" fill="#a37c17" stroke="none"/></g></svg>';

/** 응원·야유 대상(팀 또는 사람)의 점수판 머리 위치와 이름. */
function watchTarget(msg) {
  const view = room.view;
  if (!view || $('game').hidden) return null;
  const team = typeof msg.team === 'number' ? msg.team : null;
  const seat = typeof msg.seat === 'number' ? msg.seat : null;
  const sel = team !== null ? `#sheet th[data-team="${team}"]` : `#sheet th[data-seat="${seat}"]`;
  const ths = [...document.querySelectorAll(sel)];
  if (!ths.length) return null;
  const rects = ths.map((th) => th.getBoundingClientRect());
  const left = Math.min(...rects.map((r) => r.left));
  const right = Math.max(...rects.map((r) => r.right));
  const top = Math.min(...rects.map((r) => r.top));
  return {
    x: (left + right) / 2,
    // 점수판 머리가 화면 밖이면 화면 안쪽에서 보여 준다.
    y: Math.min(Math.max(top + 18, 70), innerHeight - 80),
    width: right - left,
    cls: team !== null ? `t${team}` : playerCls(view, seat),
    name: team !== null ? TEAM_NAME[team] : view.players[seat]?.name ?? '',
    mine: team !== null ? view.players[view.you]?.team === team : seat === view.you,
  };
}

function showCheer(msg) {
  const t = watchTarget(msg);
  if (!t) return;
  const box = el('div', `cheer-burst ${t.cls}`);
  box.setAttribute('aria-hidden', 'true');
  box.style.left = `${t.x}px`;
  box.style.top = `${t.y}px`;
  box.append(el('span', 'shout', `${t.name} 화이팅!`));
  if (!reducedMotion.matches) {
    const spread = Math.max(80, t.width / 2 + 40);
    for (let i = 0; i < 26; i++) {
      const piece = el('i', `pen ${i % 3 === 2 ? 'gold' : t.cls}`);
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
      const dist = 70 + Math.random() * spread;
      piece.style.setProperty('--dx', `${Math.round(Math.cos(angle) * dist)}px`);
      piece.style.setProperty('--dy', `${Math.round(Math.sin(angle) * dist)}px`);
      piece.style.setProperty('--turn', `${(Math.random() < 0.5 ? -1 : 1) * (180 + Math.floor(Math.random() * 360))}deg`);
      piece.style.setProperty('--delay', `${Math.floor(Math.random() * 120)}ms`);
      box.append(piece);
    }
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 1700);
}

function showJeer(msg) {
  const t = watchTarget(msg);
  const j = JEERS[msg.action];
  if (!t || !j) return;
  // 누가 던졌는지는 알 수 없다 (서버도 보내지 않는다).
  toast(`관전석에서 ${t.mine && room.view?.mode !== '2v2' ? '나' : t.name}에게 ${j.verb}`);
  if (t.mine) vibrate(msg.action === 'hammer' ? [30, 40, 60] : 80);

  const box = el('div', `jeer-fx jeer-${msg.action} ${t.cls}`);
  box.setAttribute('aria-hidden', 'true');
  box.style.left = `${t.x}px`;
  box.style.top = `${t.y}px`;
  const word = el('span', 'shout', '뿅!');
  document.body.append(box);
  setTimeout(() => box.remove(), msg.action === 'banana' ? 2600 : 1900);

  if (reducedMotion.matches) {
    if (msg.action === 'hammer') box.append(word);
    else {
      const peel = el('span', 'peel');
      peel.innerHTML = BANANA_SVG;
      box.append(peel);
    }
    return;
  }
  if (msg.action === 'hammer') {
    const ham = el('span', 'hammer');
    ham.innerHTML = HAMMER_SVG;
    box.append(ham);
    // 내려친 순간 글자와 별, 점수판 흔들림
    setTimeout(() => {
      box.append(word);
      for (let i = 0; i < 6; i++) {
        const star = el('i', 'star');
        const a = (Math.PI * 2 * i) / 6;
        star.style.setProperty('--dx', `${Math.round(Math.cos(a) * 46)}px`);
        star.style.setProperty('--dy', `${Math.round(Math.sin(a) * 30)}px`);
        box.append(star);
      }
      const sheet = $('sheet');
      sheet.classList.remove('bonk');
      void sheet.offsetWidth;
      sheet.classList.add('bonk');
      setTimeout(() => sheet.classList.remove('bonk'), 450);
    }, 330);
  } else {
    // 바나나 껍질: 화면 아래에서 빙글빙글 던져져 대상 위에 철퍼덕 떨어지고, 잠시 놓여 있다가 사라진다
    const peel = el('span', 'peel');
    peel.innerHTML = BANANA_SVG;
    box.append(peel);
    const sx = innerWidth / 2 - t.x + (Math.random() - 0.5) * 160;
    const sy = innerHeight - t.y + 60;
    const mx = sx * 0.45;
    const my = Math.min(sy * 0.3, 0) - 150;
    const spin = (Math.random() < 0.5 ? -1 : 1) * 720; // 두 바퀴 돌고 바로 선 채로 떨어진다
    const tilt = Math.round((Math.random() - 0.5) * 24);
    peel.animate(
      [
        { transform: `translate(${sx}px, ${sy}px) rotate(0deg) scale(.7)` },
        { transform: `translate(${mx}px, ${my}px) rotate(${spin * 0.6}deg) scale(1)`, offset: 0.5 },
        { transform: `translate(0, 0) rotate(${spin + tilt}deg) scale(1.05, .82)`, offset: 0.78 },
        { transform: `translate(2px, -3px) rotate(${spin + tilt}deg) scale(.97, 1.04)`, offset: 0.88 },
        { transform: `translate(4px, 0) rotate(${spin + tilt}deg) scale(1)` },
      ],
      { duration: 820, easing: 'cubic-bezier(.3,.55,.45,1)', fill: 'forwards' },
    );
  }
}

/* 야추 축하: 주사위가 차례로 튀어 오르고, 트레이에 "야추!"가 찍히고, 신호기 깃발이 흩날린다. */
let yachtTimer = null;
function celebrateYacht(who) {
  const tray = $('tray');
  tray.querySelector('.yacht-stamp')?.remove();
  clearTimeout(yachtTimer);
  diceButtons.forEach((b, i) => b.style.setProperty('--hop-delay', `${i * 70}ms`));
  tray.classList.remove('yacht');
  void tray.offsetWidth;
  tray.classList.add('yacht');

  const stamp = el('div', 'yacht-stamp');
  stamp.setAttribute('role', 'status');
  if (who && !who.me) stamp.append(el('small', '', who.name));
  stamp.append(el('span', '', '야추!'));
  tray.append(stamp);

  if (!reducedMotion.matches) {
    const box = el('div', 'confetti');
    box.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 40; i++) {
      const piece = el('i', `pen c${i % 4}`);
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.setProperty('--fall-delay', `${Math.floor(Math.random() * 350)}ms`);
      piece.style.setProperty('--fall-ms', `${1400 + Math.floor(Math.random() * 900)}ms`);
      piece.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 180)}px`);
      piece.style.setProperty('--turn', `${(Math.random() < 0.5 ? -1 : 1) * (240 + Math.floor(Math.random() * 480))}deg`);
      box.append(piece);
    }
    document.body.append(box);
    setTimeout(() => box.remove(), 2800);
    if (who?.me) vibrate([40, 60, 90]);
  }

  yachtTimer = setTimeout(() => {
    stamp.remove();
    tray.classList.remove('yacht');
  }, 2100);
}

function tdClass(c) {
  return [c.now ? 'now' : '', c.teamStart ? 'team-start' : ''].join(' ').trim();
}

function renderSheet(m, rolling = false) {
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
    if (c.seat !== undefined) th.dataset.seat = String(c.seat);
    if (c.team !== undefined && c.team !== null) th.dataset.team = String(c.team);
    const ph = el('div', 'ph');
    // 상태 줄은 비어 있어도 자리를 차지해서 머리글 높이를 맞춘다.
    if (c.avatar) {
      // 아바타 아래에 자리 색 띠를 둘러 누구 열인지 구분한다.
      const av = miniAvatar(c.avatar, 40);
      av.classList.add('ring', c.cls);
      ph.append(av);
    } else {
      ph.append(pennant(c.cls));
    }
    ph.append(el('span', 'nm', c.name), el('span', 'st', c.status || '\u00a0'));
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
        td.classList.add('filled'); // 기록한 칸은 배경색으로 구분
        const cell = el('div', 'cell', String(value));
        if (c.just === cat) cell.classList.add('just');
        td.append(cell);
      } else if (m.previewCol === i && m.canScore && !rolling) {
        const s = scoreFor(cat, m.dice);
        // 아직 적지 않은 '적을 수 있는 점수'는 점선 테두리 안에 보여 준다.
        const b = el('button', `cell preview${s === 0 ? ' zero' : ''}${ui.armed === cat ? ' armed' : ''}`);
        b.append(el('span', 'pv', String(s)));
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
  stopRolling();
  ui.kind = null;
  ui.model = null;
  ui.armed = null;
  ui.lastRollSeq = null;
  closeOverlay('result');
}

/* ---------------------------------------------------------------- 혼자 하기 */

let solo = null;
let soloResult = null;

let soloBusy = false;
let soloOpening = 0;

/** 혼자 하기 시작. 하던 게임이 있으면 이어서 한다. fresh면 처음부터. */
async function startSolo({ fresh = false } = {}) {
  leaveGameState();
  ui.kind = 'solo';
  solo = null;
  soloResult = null;
  soloBusy = true;
  show('game');
  $('sheet').replaceChildren();
  diceButtons.forEach((b) => { paintDie(b, 0); b.disabled = true; b.classList.remove('held'); });
  $('round-now').textContent = '1';
  $('roll-label').textContent = '준비하는 중';
  $('roll-btn').disabled = true;
  $('tray-hint').textContent = '';
  $('turn-label').replaceChildren();
  $('game-restart').hidden = false;

  const ticket = ++soloOpening;
  const { game, offlineReason } = await openSolo({ fresh });
  if (ticket !== soloOpening || ui.kind !== 'solo') return; // 그 사이 다른 화면으로 감
  solo = game;
  soloBusy = false;
  renderSolo();
  if (offlineReason) toast(offlineReason);
  $('roll-btn').focus();
}

/** 굴리기·적기처럼 서버를 거치는 동작. 기다리는 동안 다른 입력을 막는다. */
/** 굴리기·적기. 화면은 바로 바꾸고, 서버 응답이 오면 그 결과로 다시 그린다. */
async function soloAction(fn) {
  if (!solo || soloBusy) return;
  const game = solo;
  const done = fn();
  renderSolo();
  try {
    await done;
  } catch (err) {
    if (solo !== game) return;
    stopRolling();
    toast(err.message ?? '잠시 후 다시 시도해 주세요');
  }
  if (ui.kind !== 'solo' || solo !== game) return;
  renderSolo();
  // 요청이 끝났는데도 기다리는 중이면(굴리기 요청이 실제로 가지 않은 경우 등) 지금 눈으로 멈춘다.
  if (rollAnim.pending) settleRolling();
  if (soloResult && solo.done) {
    if (solo.reward) updatePoints(solo.reward.balance);
    else if (currentUser() && solo.claimable) await claimFinishedSolo();
    showResult(true);
  }
}

/** 로그인하지 않고(또는 도중에 로그인해서) 끝낸 판의 포인트를 받는다. */
async function claimFinishedSolo() {
  if (!solo?.claimable || solo.reward) return;
  try {
    solo.reward = await claimSolo(solo.gameId);
    solo.claimable = false;
    solo.linked = true;
    solo.rankable = false;
    updatePoints(solo.reward.balance);
  } catch (err) {
    toast(err.message);
  }
}

function renderSolo() {
  if (!solo) return;
  const ready = !solo.done && !soloBusy && !solo.rolling;
  const best = bestScore();
  const m = {
    round: solo.round,
    turn: solo.done ? null : { name: '나', cls: 'c0', me: true, avatar: currentUser()?.avatar },
    deadline: null,
    dice: solo.dice,
    held: solo.held,
    rollsLeft: solo.rollsLeft,
    rollSeq: solo.rollSeq,
    canRoll: ready && solo.rollsLeft > 0,
    canHold: ready && solo.rollsLeft > 0 && solo.rollsLeft < ROLLS_PER_TURN,
    canScore: ready && solo.rollsLeft < ROLLS_PER_TURN,
    finished: solo.done,
    previewCol: 0,
    teams: null,
    columns: [{
      name: currentUser()?.nickname ?? '나',
      cls: 'c0',
      avatar: currentUser()?.avatar,
      status: solo.online ? (best === null ? '' : `최고 ${best}`) : '오프라인',
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

/* ---------------------------------------------------------------- 랭킹 등록 (결과 화면) */

/** 결과 화면: 받은 포인트와 랭킹, 또는 로그인하고 받기 */
function renderSoloReward(box) {
  if (!solo?.online) return;
  const r = solo.reward;
  if (r) {
    const wrap = el('div', 'reward');
    wrap.append(el('span', 'points-chip', `+${r.points.toLocaleString()} 포인트`));
    const parts = [];
    if (r.week) parts.push(`이번 주 ${r.week.rank}위`);
    if (r.all) parts.push(`전체 ${r.all.rank}위`);
    const best = r.all?.best;
    wrap.append(el('small', '', `${parts.join(', ')}${best && best > solo.total ? ` · 내 최고 기록 ${best}점` : ''} · 보유 ${r.balance.toLocaleString()}P`));
    const go = el('button', 'btn btn-secondary wide', '아바타 꾸미러 가기');
    go.type = 'button';
    go.addEventListener('click', () => {
      closeOverlay('result');
      showCloset();
    });
    wrap.append(go);
    box.append(wrap);
    return;
  }
  if (solo.claimable && loginAvailable() && !currentUser()) {
    const wrap = el('div', 'reward');
    wrap.append(el('span', 'points-chip', `+${scorePoints(solo.total).toLocaleString()} 포인트`));
    wrap.append(el('small', '', '로그인하면 이 판 포인트를 받고, 닉네임과 아바타로 랭킹에 올라가요'));
    const b = el('button', 'btn btn-primary wide', '로그인하고 포인트 받기');
    b.type = 'button';
    b.addEventListener('click', () => openLogin({
      after: async () => {
        await claimFinishedSolo();
        showResult(true);
      },
    }));
    wrap.append(b);
    box.append(wrap);
  }
}

function renderRankForm(box) {
  if (!solo?.online || solo.linked) return;
  if (solo.registered) {
    const e = solo.registered;
    const done = el('div', 'rank-done');
    done.append(el('strong', '', e.initials));
    done.append(el('span', '', `${e.rankWeek ? `이번 주 ${e.rankWeek}위, ` : ''}전체 ${e.rankAll}위로 등록했어요`));
    const b = el('button', 'btn btn-secondary wide', '랭킹 보기');
    b.type = 'button';
    b.addEventListener('click', () => showRanking('week', e.id));
    box.append(done, b);
    return;
  }
  if (!solo.rankable) return;

  const form = el('form', 'rank-form');
  form.noValidate = true;
  const label = el('label', '', '랭킹에 이니셜 남기기');
  label.htmlFor = 'initials';
  const row = el('div', 'row');
  const input = el('input');
  Object.assign(input, { id: 'initials', maxLength: 3, size: 3, value: savedInitials(), placeholder: 'ABC', autocomplete: 'off', spellcheck: false });
  input.setAttribute('autocapitalize', 'characters');
  input.setAttribute('aria-describedby', 'initials-help');
  const submit = el('button', 'btn btn-primary', '등록');
  submit.type = 'submit';
  row.append(input, submit);
  const err = el('p', 'err');
  err.setAttribute('role', 'alert');
  const help = el('small', '', '영문 3글자. 끝낸 뒤 24시간 안에 등록할 수 있어요.');
  help.id = 'initials-help';
  form.append(label, row, err, help);
  box.append(form);

  input.addEventListener('input', () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
    err.textContent = '';
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const initials = input.value;
    if (!/^[A-Z]{3}$/.test(initials)) {
      err.textContent = '영문 3글자를 입력해 주세요';
      input.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = '등록 중';
    try {
      solo.registered = await submitRanking(solo.gameId, initials);
      solo.rankable = false;
      showResult(false);
    } catch (e) {
      err.textContent = e.message;
      submit.disabled = false;
      submit.textContent = '등록';
    }
  });
}

/* ---------------------------------------------------------------- 랭킹 화면 */

let rankingPeriod = 'week';
let rankingFocus = null;
let rankingTicket = 0;

function showRanking(period = rankingPeriod, focusId = null) {
  leaveGameState();
  setUrlRoom(null);
  rankingFocus = focusId;
  show('ranking');
  loadRanking(period);
}

for (const tab of document.querySelectorAll('#ranking [role="tab"]')) {
  tab.addEventListener('click', () => loadRanking(tab.dataset.period));
}

const shortDate = (ms) => new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' }).format(ms);
const dayName = (ms) => new Intl.DateTimeFormat('ko-KR', { weekday: 'short', timeZone: 'Asia/Seoul' }).format(ms);

async function loadRanking(period) {
  rankingPeriod = period;
  for (const tab of document.querySelectorAll('#ranking [role="tab"]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.period === period));
  }
  const list = $('rank-list');
  const empty = $('rank-empty');
  const range = $('rank-range');
  list.replaceChildren();
  empty.hidden = false;
  empty.textContent = '불러오는 중…';
  range.textContent = period === 'all' ? '지금까지의 최고 점수 순위예요' : '';

  const ticket = ++rankingTicket;
  let data;
  try {
    data = await fetchRankings(period);
  } catch (err) {
    if (ticket !== rankingTicket) return;
    empty.textContent = `랭킹을 불러오지 못했어요. ${err.message}`;
    return;
  }
  if (ticket !== rankingTicket) return;

  if (period === 'week') {
    const end = data.weekEnd - 1;
    range.textContent = `${shortDate(data.weekStart)}(${dayName(data.weekStart)}) ~ ${shortDate(end)}(${dayName(end)})\n매주 월요일 0시에 새로 시작해요`;
  }
  if (!data.entries.length) {
    empty.textContent = period === 'week' ? '이번 주 기록이 아직 없어요. 첫 번째 기록을 남겨 보세요.' : '아직 등록된 기록이 없어요.';
    return;
  }
  empty.hidden = true;
  const mine = new Set(myRankingIds());
  for (const e of data.entries) {
    const li = el('li');
    const isMine = e.mine || mine.has(e.id);
    if (isMine) li.classList.add('mine');
    if (e.id === rankingFocus) li.classList.add('focus');
    const rk = el('span', 'rk');
    if (e.rank <= 3) rk.append(el('span', `medal m${e.rank}`, String(e.rank)));
    else rk.textContent = String(e.rank);
    let who;
    if (e.nickname) {
      who = el('span', 'who');
      who.append(miniAvatar(e.avatar), el('span', 'nick', e.nickname));
    } else {
      who = el('span', 'ini', e.initials);
    }
    if (isMine) who.append(el('span', 'tag me', '나'));
    li.append(rk, who, el('span', 'dt', shortDate(e.playedAt)), el('span', 'sc', String(e.score)));
    list.append(li);
  }
  list.querySelector('li.focus')?.scrollIntoView({ block: 'center' });
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
  $('nick').value = nickname() || currentUser()?.nickname || '';
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
  $('sit-down').hidden = true;
  $('go-watch').hidden = true;
  show('lobby');

  room.conn = new RoomConnection({
    getToken: authToken,
    code,
    name,
    onState: onRoomState,
    onCheer: showCheer,
    onJeer: showJeer,
    onBalance: (points) => {
      updatePoints(points);
      cheerKey = '';
      if (ui.model) renderGame(ui.model);
    },
    onError: (message, fatal) => {
      if (fatal) {
        room.conn = null;
        showOnline(code);
        $('online-error').textContent = message;
        setUrlRoom(null);
      } else if (!$('game').hidden) {
        if (rollAnim.pending) {
          stopRolling();
          if (ui.model) renderGame(ui.model);
        }
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
        // 보낸 굴리기가 서버에 닿지 못했을 수 있으니 기다리던 주사위는 멈춘다. 다시 연결되면 서버 상태로 맞춰진다.
        if (rollAnim.pending) settleRolling();
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
$('go-watch').addEventListener('click', () => {
  if (!room.conn || room.view?.phase !== 'lobby' || room.view.spectator) return;
  ui.watchRequested = true;
  $('go-watch').disabled = true;
  room.conn.spectate();
});
$('sit-down').addEventListener('click', () => {
  if (!room.conn) return;
  ui.sitRequested = true;
  $('sit-down').disabled = true;
  room.conn.sit();
});
/* 친구 초대: 휴대폰·PC의 기본 공유 창(카카오톡, 메시지, SNS 등)을 먼저 쓰고, 없으면 자체 공유 창을 띄운다. */
function inviteLink() {
  // 앱 안 주소(https://localhost)는 친구가 열 수 없으니 웹 사이트 주소로
  const url = new URL(IS_APP ? SITE_URL : location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', room.code);
  return url.toString();
}

$('copy-invite').addEventListener('click', async () => {
  const link = inviteLink();
  const mode = MODE_LABEL[room.view?.mode] ?? '';
  const text = `오늘도 야추 ${mode} 한 판 같이 해요! 방 코드 ${room.code}`;
  const data = { title: '오늘도 야추', text, url: link };
  if (await nativeShare(data)) return; // 앱: 기본 공유 창
  if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
    try {
      await navigator.share(data);
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return; // 공유 창을 닫음
      // 그 외 실패(앱 안 브라우저 제한 등)는 링크 복사로
    }
  }
  copyInvite(`${text}\n${link}`);
});

/** 기본 공유 창이 없는 곳: 초대 문구와 링크를 복사한다. 붙여 넣으면 링크 미리보기가 붙는다. */
async function copyInvite(message) {
  const label = $('invite-label');
  let copied = false;
  try {
    await navigator.clipboard.writeText(message);
    copied = true;
  } catch {
    // 클립보드 API를 못 쓰는 앱 안 브라우저 등은 예전 방식으로
    const area = el('textarea');
    area.value = message;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.append(area);
    area.select();
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    area.remove();
  }
  if (!copied) {
    // 그래도 안 되면 직접 복사할 수 있게 보여 준다.
    window.prompt('아래 링크를 복사해서 친구에게 보내 주세요', message.split('\n').pop());
    return;
  }
  label.textContent = '초대 링크를 복사했어요';
  clearTimeout(copyInvite.timer);
  copyInvite.timer = setTimeout(() => {
    label.textContent = '친구 초대하기';
  }, 2500);
}

function playerCls(view, seat) {
  const p = view.players[seat];
  return view.mode === '2v2' ? `t${p?.team ?? 0}` : `c${seat}`;
}

function onRoomState(view) {
  const prev = room.view;
  room.view = view;
  if (view.you < 0 && !view.spectator) return;
  if (!$('watchers').hidden) renderWatcherList();

  // 관전으로 들어왔거나 자리에 앉았을 때 알려 준다.
  if (ui.sitRequested && view.spectator) {
    toast('그 사이에 자리가 찼어요. 계속 관전할게요');
  } else if (view.spectator && ui.watchRequested) {
    toast('관전으로 빠졌어요. 빈 자리에 앉기로 다시 참가할 수 있어요');
  } else if (view.spectator && !prev?.spectator) {
    toast(view.phase === 'lobby' ? '방이 꽉 차서 관전으로 들어왔어요' : '게임이 이미 시작해서 관전으로 들어왔어요');
  } else if (!view.spectator && prev?.spectator) {
    toast('자리에 앉았어요');
  }
  ui.sitRequested = false;
  ui.watchRequested = false;

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
      seat,
      team: p.team,
      name: p.name,
      cls: playerCls(view, seat),
      avatar: p.avatar,
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
    turn: finished ? null : { name: nameOf(g.turn), cls: playerCls(view, g.turn), me: myTurn, avatar: view.players[g.turn]?.avatar },
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
    watching: !!view.spectator,
    watchers: view.watchers ?? 0,
    // 관전자 응원 버튼: 2:2는 팀, 그 외는 남아 있는 사람
    cheers: view.spectator
      ? view.mode === '2v2'
        ? [0, 1].map((team) => ({ target: team, name: TEAM_NAME[team], cls: `t${team}` }))
        : g.order.filter((seat) => !view.players[seat]?.left).map((seat) => ({ target: seat, name: nameOf(seat), cls: playerCls(view, seat) }))
      : null,
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
  const watching = !!view.spectator;
  const isHost = !watching && view.host === view.you;

  const seatEl = (seat) => {
    const p = view.players[seat];
    const row = el('div', 'seat');
    row.append(pennant(playerCls(view, seat)));
    if (p.avatar) row.append(miniAvatar(p.avatar));
    row.append(el('span', 'name', p.name));
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
      if (!watching && !mine && members.length < 2) {
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
  if (missing > 0) note = `${missing}명 더 들어오면 시작할 수 있어요. '친구 초대하기'로 초대해 주세요.`;
  else if (!balanced) note = '팀마다 두 명씩 맞춰 주세요';
  else if (isHost) note = '모두 모였어요. 시작해 볼까요?';
  else note = '모두 모였어요. 방장이 시작하면 게임이 시작돼요.';
  if (watching) note = missing > 0 ? `관전 중이에요. 빈 자리가 ${missing}개 있어서 앉을 수 있어요.` : '관전 중이에요. 게임이 시작되면 점수판을 같이 볼 수 있어요.';
  $('lobby-note').textContent = note;
  renderLobbyWatchers(view);

  const start = $('start-game');
  start.hidden = !isHost;
  start.disabled = missing > 0 || !balanced;
  const sit = $('sit-down');
  sit.hidden = !(watching && view.open);
  sit.disabled = false;
  const goWatch = $('go-watch');
  goWatch.hidden = watching;
  goWatch.disabled = false;
}

/* ---------------------------------------------------------------- 관전자 목록 */

function watcherChip(w) {
  const chip = el('span', `watcher${w.me ? ' me' : ''}`);
  if (w.avatar) chip.append(miniAvatar(w.avatar, 22));
  else chip.append(el('span', 'watcher-eye', ''));
  chip.append(el('span', 'nm', w.name));
  if (w.me) chip.append(el('span', 'tag me', '나'));
  return chip;
}

/** 대기실: 자리 목록 아래에 관전자 이름을 바로 보여 준다. */
function renderLobbyWatchers(view) {
  const box = $('lobby-watchers');
  const list = view.watcherList ?? [];
  box.hidden = list.length === 0;
  box.replaceChildren();
  if (!list.length) return;
  box.append(el('h3', '', `관전 ${list.length}명`));
  const chips = el('div', 'watcher-chips');
  for (const w of list) chips.append(watcherChip(w));
  box.append(chips);
}

/** 게임 중: '관전 N'을 누르면 뜨는 목록. 열려 있는 동안 들어오고 나가는 것도 바로 반영된다. */
function renderWatcherList() {
  const list = room.view?.watcherList ?? [];
  $('watchers-title').textContent = `관전 ${list.length}명`;
  const ul = $('watcher-list');
  ul.replaceChildren();
  if (!list.length) {
    ul.append(el('li', 'empty', '지금은 관전하는 사람이 없어요'));
    return;
  }
  for (const w of list) {
    const li = el('li');
    li.append(watcherChip(w));
    ul.append(li);
  }
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
  const extra = $('result-extra');
  extra.replaceChildren();

  if (ui.kind === 'solo') {
    const total = solo.total;
    const best = bestScore();
    title.textContent = '끝!';
    sub.replaceChildren(
      el('div', 'big-score', `${total}`),
      el('div', '', soloResult?.newBest ? '새 최고 기록이에요' : `최고 기록 ${best ?? total}점`),
    );
    $('result-note').textContent = solo.online ? '' : '오프라인으로 한 판이라 랭킹에 올릴 수 없어요';
    renderSoloReward(extra);
    renderRankForm(extra);
    actionBtn('점수판 보기', 'btn-ghost', viewSheet);
    actionBtn('한 판 더', 'btn-primary', () => {
      closeOverlay('result');
      startSolo({ fresh: true });
    });
    if (open) {
      openOverlay('result');
      $('initials')?.focus();
    }
    return;
  }

  const view = room.view;
  if (!view?.game?.standings) return;
  const { players, teams } = view.game.standings;
  const me = view.you;
  const nameOf = (seat) => view.players[seat]?.name ?? '';
  const forfeit = view.game.endReason === 'forfeit';

  const row = (rank, cls, name, note, total, first, avatar) => {
    const li = el('li', first ? 'first' : '');
    const nm = el('span', 'nm', name);
    if (note) nm.append(el('small', '', note));
    li.append(el('span', 'rk', `${rank}`), avatar ? miniAvatar(avatar) : pennant(cls), nm, el('span', 'sc', String(total)));
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
      row(p.rank, playerCls(view, p.seat), nameOf(p.seat), note, p.total, p.rank === 1 && top.length === 1, view.players[p.seat]?.avatar);
    }
  }

  const myReward = view.spectator ? undefined : view.game.rewards?.[me];
  if (myReward !== undefined) {
    const wrap = el('div', 'reward');
    wrap.append(el('span', 'points-chip', `+${myReward.toLocaleString()} 포인트`));
    const myTotal = players.find((p) => p.seat === me)?.total ?? 0;
    const base = scorePoints(myTotal);
    const bonus = myReward - base;
    const myRank = teams ? teams.find((t) => t.seats.includes(me))?.rank : players.find((p) => p.seat === me)?.rank;
    const bonusName = myRank === 1 ? '승리 보너스' : view.mode === '1v1v1' && myRank === 2 ? '2등 보너스' : '참가 보너스';
    wrap.append(el('small', '', bonus > 0 ? `점수 ${myTotal}점 ${base}P · ${bonusName} ${bonus}P` : `점수 ${myTotal}점 ${base}P`));
    extra.append(wrap);
    refreshMe();
  } else if (!view.spectator && view.game.rewards && !currentUser() && loginAvailable()) {
    const wrap = el('div', 'reward');
    wrap.append(el('small', '', '로그인하면 다음 판부터 포인트를 받아 아바타를 꾸밀 수 있어요'));
    extra.append(wrap);
  }

  actionBtn('점수판 보기', 'btn-ghost', viewSheet);
  if (view.spectator) {
    actionBtn('나가기', 'btn-secondary', leaveRoom);
    $('result-note').textContent = '관전 중이에요. 방장이 다시 하기를 누르면 대기실에서 빈 자리에 앉을 수 있어요';
  } else if (view.host === me) {
    actionBtn('다시 하기', 'btn-primary', () => room.conn?.send({ type: 'rematch' }));
    $('result-note').textContent = '';
  } else {
    actionBtn('나가기', 'btn-secondary', leaveRoom);
    $('result-note').textContent = '방장이 다시 하기를 누르면 같은 방에서 한 판 더 해요';
  }
  if (open) openOverlay('result');
}

/* ---------------------------------------------------------------- 계정: 상단 버튼, 로그인, 닉네임 */

function miniAvatar(avatar, size = 34) {
  const box = el('span', 'mini-av');
  box.style.width = box.style.height = `${size}px`;
  box.innerHTML = renderAvatar(avatar, { size, round: true });
  return box;
}

/** 홈: 로그인했으면 내 아바타 카드 */
function renderHomeCard() {
  const box = $('home-card');
  const me = currentUser();
  box.replaceChildren();
  box.hidden = !me || !loginAvailable();
  if (box.hidden) return;
  const card = el('button', 'home-card');
  card.type = 'button';
  card.addEventListener('click', showCloset);
  const art = el('span', 'home-card-av');
  art.innerHTML = renderAvatar(me.avatar, { size: 76, title: `${me.nickname}의 아바타` });
  const info = el('span', 'home-card-info');
  info.append(el('strong', '', me.nickname), el('span', 'points-chip', `${me.points.toLocaleString()}P`));
  card.append(art, info, el('span', 'home-card-go', '꾸미기'));
  box.append(card);
}

function renderAccountBar() {
  const bar = $('account-bar');
  bar.replaceChildren();
  if (!loginAvailable()) return;
  const me = currentUser();
  const b = el('button', 'account-btn');
  b.type = 'button';
  if (me) {
    const av = el('span', 'av');
    av.innerHTML = renderAvatar(me.avatar, { size: 32, round: true });
    b.append(av, el('span', 'nm', me.nickname), el('span', 'points-chip', `${me.points.toLocaleString()}P`));
    b.setAttribute('aria-label', `내 아바타: ${me.nickname}, ${me.points}포인트`);
    b.addEventListener('click', showCloset);
  } else {
    b.classList.add('login');
    b.textContent = '로그인하고 아바타 꾸미기';
    b.addEventListener('click', () => openLogin({ after: showCloset }));
  }
  bar.append(b);
}

let loginAfter = null;

/** 로그인 창. 로그인하면(처음이면 닉네임을 정한 뒤) after()를 부른다. */
function openLogin({ after = null } = {}) {
  loginAfter = after;
  $('login-error').textContent = '';
  const samples = [
    { animal: 'cat', hat: 'captain', bg: 'sea' },
    { animal: 'woman', outfit: 'sailor', bg: 'navy' },
    { animal: 'parrot', hat: 'crown', face: 'sunglasses', bg: 'gold' },
  ];
  $('login-avatars').replaceChildren(...samples.map((a) => miniAvatar(a, 56)));
  $('dev-login').hidden = !(isLocalDev() && !GOOGLE_CLIENT_ID);
  openOverlay('login');
  mountGoogleButton($('google-btn'), {
    onDone: loginDone,
    onError: (message) => {
      $('login-error').textContent = message;
    },
  });
}

$('dev-login').addEventListener('click', async () => {
  try {
    await devLogin('local');
    loginDone();
  } catch (err) {
    $('login-error').textContent = `${err.message} (worker/.dev.vars에 DEV_LOGIN=1이 있어야 해요)`;
  }
});

function loginDone() {
  closeOverlay('login');
  const after = loginAfter;
  loginAfter = null;
  const me = currentUser();
  toast(`${me?.nickname ?? ''}님, 반가워요`);
  if (me && !me.nicknameSet) openNickname({ after });
  else after?.();
}

let nicknameAfter = null;

function openNickname({ after = null } = {}) {
  const me = currentUser();
  if (!me) return;
  nicknameAfter = after;
  const first = !me.nicknameSet;
  nicknameDraft = { ...me.avatar };
  $('nickname-title').textContent = first ? '캐릭터와 닉네임을 정해 주세요' : '닉네임 바꾸기';
  $('nickname-lead').textContent = first
    ? '처음 쓸 캐릭터를 골라요. 다른 캐릭터는 포인트를 모아서 열 수 있어요. 닉네임은 이번에는 무료로 정할 수 있어요.'
    : `닉네임을 바꾸면 ${NICKNAME_CHANGE_COST}포인트가 들어요. 지금 ${me.points.toLocaleString()}포인트가 있어요.`;
  $('nickname-avatar').hidden = first;
  $('pick-char').hidden = !first;
  $('nickname-save').textContent = first ? '이대로 시작하기' : `${NICKNAME_CHANGE_COST}P로 바꾸기`;
  if (first) renderCharPicker();
  else $('nickname-avatar').innerHTML = renderAvatar(me.avatar, { size: 96, round: true });
  $('nickname-input').value = me.nickname;
  $('nickname-error').textContent = '';
  openOverlay('nickname');
  $('nickname-input').focus();
  $('nickname-input').select();
}

let nicknameDraft = null;

/** 처음 로그인할 때 고르는 기본 캐릭터 (무료 캐릭터) */
function renderCharPicker() {
  const box = $('pick-char');
  box.replaceChildren();
  for (const it of ITEMS.filter((i) => i.slot === 'animal' && i.price === 0)) {
    const b = el('button', 'pick');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(nicknameDraft.animal === it.id));
    b.setAttribute('aria-label', it.name);
    const art = el('span', 'pick-art');
    art.innerHTML = renderAvatar({ ...nicknameDraft, animal: it.id }, { size: 64, round: true });
    b.append(art, el('span', 'pick-name', it.name));
    b.addEventListener('click', () => {
      nicknameDraft = { ...nicknameDraft, animal: it.id };
      renderCharPicker();
      box.querySelector('[aria-checked="true"]')?.focus();
    });
    box.append(b);
  }
}

$('nickname-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const name = $('nickname-input').value.replace(/\s+/g, ' ').trim();
  if (!name) {
    $('nickname-error').textContent = '닉네임을 입력해 주세요';
    return;
  }
  const btn = $('nickname-save');
  const me0 = currentUser();
  if (me0?.nicknameSet && name === me0.nickname) {
    // 그대로면 포인트 없이 닫는다
    closeOverlay('nickname');
    return;
  }
  if (me0?.nicknameSet && me0.points < NICKNAME_CHANGE_COST) {
    $('nickname-error').textContent = `포인트가 부족해요. ${NICKNAME_CHANGE_COST - me0.points}포인트 더 모아야 해요`;
    return;
  }
  btn.disabled = true;
  try {
    const me = currentUser();
    const changes = { nickname: name };
    if (me && !me.nicknameSet && nicknameDraft && nicknameDraft.animal !== me.avatar.animal) changes.avatar = nicknameDraft;
    await saveProfile(changes);
    closeOverlay('nickname');
    const after = nicknameAfter;
    nicknameAfter = null;
    after?.();
  } catch (err) {
    $('nickname-error').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});
// 닉네임 창은 바깥을 눌러 닫으면 지금 닉네임을 그대로 쓴다.
$('nickname').addEventListener('click', (ev) => {
  if (ev.target !== $('nickname')) return;
  const me = currentUser();
  closeOverlay('nickname');
  if (me && !me.nicknameSet) {
    const changes = { nickname: me.nickname };
    if (nicknameDraft && nicknameDraft.animal !== me.avatar.animal) changes.avatar = nicknameDraft;
    saveProfile(changes).catch(() => {});
  }
  const after = nicknameAfter;
  nicknameAfter = null;
  after?.();
});

/* ---------------------------------------------------------------- 내 아바타 (꾸미기·상점) */

const closet = { slot: 'animal', draft: null };

function lockIcon() {
  const box = el('span', 'lock');
  box.setAttribute('aria-hidden', 'true');
  box.innerHTML = '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.4" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="15.2" r="1.7" fill="#fff"/><path d="M12 15.6v2.4" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>';
  return box;
}

function owns(me, id) {
  return id === null || ITEM_BY_ID[id]?.price === 0 || me.owned.includes(id);
}

function sameAvatar(a, b) {
  return SLOTS.every((s) => (a[s.id] ?? null) === (b[s.id] ?? null));
}

function showCloset() {
  const me = currentUser();
  if (!me) {
    if (loginAvailable()) openLogin({ after: showCloset });
    return;
  }
  leaveGameState();
  setUrlRoom(null);
  closet.draft = { ...me.avatar };
  show('closet');
  renderCloset();
  refreshMe();
}

function renderCloset() {
  const me = currentUser();
  if (!me || $('closet').hidden) return;
  const draft = closet.draft;
  $('closet-points').textContent = `${me.points.toLocaleString()}P`;
  $('closet-preview').innerHTML = renderAvatar(draft, { size: 168, title: `${me.nickname}의 아바타` });
  $('closet-nickname').textContent = me.nickname;

  const tabs = $('slot-tabs');
  tabs.replaceChildren();
  for (const s of SLOTS) {
    const b = el('button', '', s.name);
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(s.id === closet.slot));
    b.addEventListener('click', () => {
      closet.slot = s.id;
      renderCloset();
    });
    tabs.append(b);
  }

  const grid = $('item-grid');
  grid.replaceChildren();
  const slot = SLOTS.find((s) => s.id === closet.slot);
  const options = [...(slot.optional ? [null] : []), ...ITEMS.filter((it) => it.slot === closet.slot).map((it) => it.id)];
  for (const id of options) {
    const item = id ? ITEM_BY_ID[id] : null;
    const have = owns(me, id);
    const card = el('button', 'item');
    card.type = 'button';
    card.setAttribute('role', 'listitem');
    card.setAttribute('aria-pressed', String((draft[closet.slot] ?? null) === id));
    if ((me.avatar[closet.slot] ?? null) === id) card.classList.add('worn');
    if (!have) card.classList.add('locked');
    if (!have && item.price > me.points) card.classList.add('short');
    if (id) {
      const art = el('span', 'item-art');
      art.innerHTML = renderAvatar({ ...draft, [closet.slot]: id }, { size: 72 });
      if (!have) art.append(lockIcon());
      card.append(art);
    } else {
      card.append(el('span', 'none-mark', '없음'));
    }
    card.append(el('span', 'item-name', item ? item.name : '안 쓰기'));
    card.append(el('span', 'item-state', have ? (item?.price === 0 || !item ? '기본' : '가지고 있음') : `${item.price.toLocaleString()}P`));
    card.setAttribute('aria-label', `${item ? item.name : '안 쓰기'}, ${have ? '가지고 있음' : `잠김, ${item.price}포인트로 열기`}`);
    card.addEventListener('click', () => {
      closet.draft = { ...closet.draft, [closet.slot]: id };
      renderCloset();
    });
    grid.append(card);
  }
  renderClosetBar();
}

/** 아래 막대: 고른 아이템 사기 또는 저장 */
function renderClosetBar() {
  const me = currentUser();
  const bar = $('closet-bar');
  const draft = closet.draft;
  const changed = !sameAvatar(draft, me.avatar);
  const unowned = SLOTS.map((s) => draft[s.id]).filter((id) => !owns(me, id));
  const action = $('closet-action');
  bar.hidden = !changed;
  if (!changed) return;
  action.disabled = false;
  if (unowned.length) {
    // 아직 없는 아이템이 있으면 먼저 산다 (지금 보고 있는 칸의 아이템 우선)
    const id = unowned.includes(draft[closet.slot]) ? draft[closet.slot] : unowned[0];
    const item = ITEM_BY_ID[id];
    action.dataset.buy = id;
    action.textContent = `${item.name} ${item.slot === 'animal' ? '열기' : '사기'} · ${item.price.toLocaleString()}P`;
    if (item.price > me.points) {
      action.disabled = true;
      $('closet-bar-text').textContent = `포인트가 ${(item.price - me.points).toLocaleString()} 모자라요. 게임을 끝내면 포인트를 받아요.`;
    } else {
      $('closet-bar-text').textContent = `사면 ${(me.points - item.price).toLocaleString()}P가 남아요`;
    }
  } else {
    delete action.dataset.buy;
    action.textContent = '이대로 입기';
    $('closet-bar-text').textContent = '바꾼 모습을 저장하면 랭킹과 같이 하기에서도 보여요';
  }
}

$('closet-action').addEventListener('click', async () => {
  const action = $('closet-action');
  action.disabled = true;
  try {
    if (action.dataset.buy) {
      const item = ITEM_BY_ID[action.dataset.buy];
      await buyItem(item.id);
      toast(`${item.name}을(를) 샀어요`);
    } else {
      await saveProfile({ avatar: closet.draft });
      toast('저장했어요');
    }
  } catch (err) {
    toast(err.message);
  }
  renderCloset();
});

$('closet-reset').addEventListener('click', () => {
  closet.draft = { ...currentUser().avatar };
  renderCloset();
});

$('closet-rename').addEventListener('click', () => openNickname({ after: renderCloset }));

$('logout').addEventListener('click', () => {
  confirmExit('로그아웃할까요? 포인트와 아바타는 계정에 그대로 남아 있어요.', async () => {
    await logout();
    showHome();
  }, '로그아웃');
});

onAccountChange(() => {
  renderAccountBar();
  renderHomeCard();
  if (ui.kind === 'solo' && solo && !$('game').hidden) renderSolo();
  // 방에 있으면 로그인(또는 바뀐 아바타)을 알린다
  const token = authToken();
  if (token && room.conn) room.conn.send({ type: 'auth', token });
  if (!$('closet').hidden) {
    if (currentUser()) renderCloset();
    else showHome();
  }
});

/* ---------------------------------------------------------------- 앱: 안드로이드 뒤로가기 */
// 열린 팝업이 있으면 닫고, 없으면 화면마다 이전 화면으로. 처음 화면에서는 앱을 끝낼지 묻는다.

onBackButton(() => {
  const open = [...document.querySelectorAll('.overlay')].filter((o) => !o.hidden).pop();
  if (open) {
    if (!open.id) return; // 광고 안내 등 직접 답해야 하는 창
    closeOverlay(open.id);
    if (open.id === 'result') $('game-exit').click(); // 게임 결과 → 게임에서 나가기
    return;
  }
  if (!$('game').hidden) $('game-exit').click();
  else if (!$('lobby').hidden) leaveRoom();
  else if (!$('home').hidden) confirmExit('오늘도 야추를 끝낼까요?', exitApp, '끝내기');
  else showHome();
});

/* ---------------------------------------------------------------- 시작 */

function boot() {
  paintHomeDice();
  renderAccountBar();
  renderHomeCard();
  refreshMe();
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
