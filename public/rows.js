'use strict';
// Row actions in the lists: long-press or right-click a row for its menu. A sideways swipe
// belongs to the page (tabswipe.js: 작업공간 ↔ 설정), so rows no longer slide open; the
// slide code below stays only to shut a row that is somehow open.

// ---- row actions: long-press or right-click for a menu

// The first move decides the axis: vertical scrolls the list, horizontal is the page swipe
// (and cancels the long press).
const SWIPE_EDGE = 20; // px from the left screen edge
const SWIPE_SLOP = 8; // px before the axis is decided
const LONG_MS = 500;
const swipe = { open: null, g: null, mute: 0, pending: false };

function slideTo(el, x, animate) {
  const front = el.querySelector(':scope > .sw-front');
  el.classList.toggle('drag', !animate);
  el.classList.add('live');
  front.style.transform = x ? `translateX(${x}px)` : '';
  if (x || !animate) return;
  // Hide the buttons once the row has slid shut (at once without a transition).
  const hide = () => el !== swipe.open && !front.style.transform && el.classList.remove('live');
  if (reduced()) return hide();
  front.addEventListener('transitionend', hide, { once: true });
  setTimeout(hide, 400);
}
const actsWidth = (el) => el.querySelector(':scope > .sw-acts').offsetWidth;
function openRow(el) {
  if (swipe.open && swipe.open !== el) closeRow();
  swipe.open = el;
  slideTo(el, -actsWidth(el), true);
}
function closeRow() {
  const el = swipe.open;
  swipe.open = null;
  if (el) slideTo(el, 0, true);
}

function bindList(main) {
  main.addEventListener('touchstart', rowTouchStart, { passive: true });
  main.addEventListener('touchmove', rowTouchMove, { passive: false });
  main.addEventListener('touchend', rowTouchEnd);
  main.addEventListener('touchcancel', rowTouchEnd);
  main.addEventListener(
    'scroll',
    () => {
      listScroll = main.scrollTop;
      if (!(swipe.g && swipe.g.axis === 'x')) closeRow();
    },
    { passive: true }
  );
  main.addEventListener('click', rowClick, true);
  // Right-click (and a long press where the browser makes one of it) opens the same menu.
  main.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('[data-kind]');
    if (!row) return;
    e.preventDefault();
    if ((swipe.g && swipe.g.long) || Date.now() < swipe.mute) return;
    closeRow();
    rowMenu(row);
  });
}

// A press outside the list (header, host filter) closes an open row too.
document.addEventListener('pointerdown', (e) => {
  if (swipe.open && !e.target.closest('main.home')) closeRow();
});

function rowTouchStart(e) {
  clearTimeout(swipe.g && swipe.g.timer);
  if (e.touches.length !== 1) return void (swipe.g = null);
  const t = e.touches[0];
  const onActs = e.target.closest('.sw-acts');
  const sw = onActs ? null : e.target.closest('.sw');
  const row = onActs ? null : e.target.closest('[data-kind]');
  const g = { x: t.clientX, y: t.clientY, t0: Date.now(), sw, row, axis: null, base: 0, dx: 0, eat: false, long: false, timer: null, lastX: t.clientX, lastT: Date.now(), v: 0 };
  if (swipe.open && !(onActs && swipe.open.contains(onActs))) {
    // While a row is open, a tap only closes it; dragging the open row itself moves it.
    g.eat = true;
    if (sw === swipe.open) g.base = -actsWidth(sw);
    else closeRow();
  }
  g.edge = t.clientX < SWIPE_EDGE;
  if (row) g.timer = setTimeout(() => {
    g.long = true;
    closeRow();
    rowMenu(row);
  }, LONG_MS);
  swipe.g = g;
}

function rowTouchMove(e) {
  const g = swipe.g;
  if (!g || e.touches.length !== 1) return;
  const t = e.touches[0];
  const dx = t.clientX - g.x;
  const dy = t.clientY - g.y;
  if (!g.axis) {
    if (Math.hypot(dx, dy) < SWIPE_SLOP) return;
    clearTimeout(g.timer);
    g.axis = Math.abs(dx) > Math.abs(dy) ? 'none' : 'y'; // sideways: tabswipe.js
    if (g.axis === 'x' && swipe.open && swipe.open !== g.sw) closeRow();
    if (g.axis === 'y' && swipe.open) closeRow();
  }
  if (g.axis === 'y') return;
  if (e.cancelable) e.preventDefault(); // sideways: never the page
  if (g.axis !== 'x') return;
  const w = actsWidth(g.sw);
  let x = Math.min(0, g.base + dx);
  if (x < -w) x = -w + (x + w) / 3; // past the buttons: resist, and never run one
  g.dx = x;
  const now = Date.now();
  if (now > g.lastT) g.v = (t.clientX - g.lastX) / (now - g.lastT);
  g.lastX = t.clientX;
  g.lastT = now;
  slideTo(g.sw, x, false);
}

function rowTouchEnd(e) {
  const g = swipe.g;
  swipe.g = null;
  if (!g) return;
  clearTimeout(g.timer);
  const eatClick = () => {
    swipe.mute = Date.now() + 450;
    if (e.cancelable) e.preventDefault();
  };
  if (g.axis === 'x') {
    const w = actsWidth(g.sw);
    const open = g.v < -0.3 ? true : g.v > 0.3 ? false : g.dx < -w / 2;
    if (open) openRow(g.sw);
    else {
      if (swipe.open === g.sw) swipe.open = null;
      slideTo(g.sw, 0, true);
    }
    eatClick();
  } else if (g.long || g.axis === 'none') eatClick();
  else if (g.eat && !g.axis) {
    closeRow();
    eatClick();
  }
  if (swipe.pending) {
    swipe.pending = false;
    if (listShown()) render();
  }
}

function rowClick(e) {
  if (Date.now() < swipe.mute) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const quick = e.target.closest('[data-quick]');
  if (quick) {
    e.preventDefault();
    if (!quick.disabled) quickAnswer(quick);
    return;
  }
  const more = e.target.closest('.ws-more');
  if (more) {
    // The card's ⋯ opens the same menu as a long press, not another page.
    e.preventDefault();
    closeRow();
    rowMenu(more.closest('[data-kind]'));
    return;
  }
  const act = e.target.closest('.sw-act');
  if (act) {
    e.preventDefault();
    const row = act.closest('.sw');
    closeRow();
    rowAction(row, act.dataset.act);
  } else if (swipe.open) {
    // A mouse click elsewhere: close only.
    e.preventDefault();
    e.stopPropagation();
    closeRow();
  }
}

function rowTarget(el) {
  const { kind, id } = el.dataset;
  const host = el.dataset.host || localId();
  if (kind === 'ws') return wsFor(host, id);
  return (kind === 'agent' ? state.agents : state.terminals || []).find((x) => same(x, host, id));
}
const rowLabel = (kind, x) => (kind === 'ws' ? x.label : kind === 'agent' ? x.name || x.title : termTitle(x));

async function rowMenu(el) {
  const kind = el.dataset.kind;
  const x = rowTarget(el);
  if (!x) return;
  const items =
    kind === 'ws'
      ? [['open', '워크스페이스 보기'], ['agent', '에이전트 시작'], ['tab', '새 탭'], ['rename', '이름 바꾸기'], ['close', '워크스페이스 닫기', true]]
      : [
          ['open', kind === 'agent' ? '대화 열기' : '셸 열기'],
          kind === 'agent' && x.status === 'working' ? ['stop', '멈추기'] : null,
          ['rename', '이름 바꾸기'],
          ['ws', '워크스페이스 보기'],
          ['close', kind === 'agent' ? '패널 닫기(에이전트 종료)' : '패널 닫기', true],
        ];
  const k = await menu(rowLabel(kind, x), items, { sub: kind === 'ws' ? '워크스페이스' : kind === 'agent' ? '에이전트' : '셸' });
  if (k) rowAction(el, k);
}

// The same calls the agent, shell and workspace menus make.
async function rowAction(el, k) {
  const kind = el.dataset.kind;
  const x = rowTarget(el);
  if (!x) return toast('이미 닫혔습니다');
  if (kind === 'ws') {
    if (k === 'open') location.hash = link(x.host, `/ws/${encodeURIComponent(x.workspace_id)}`);
    if (k === 'agent') location.hash = link(x.host, `/start/ws/${encodeURIComponent(x.workspace_id)}`);
    if (k === 'tab') newTab(x);
    if (k === 'rename') renameWorkspace(x);
    if (k === 'close') closeWorkspace(x);
    return;
  }
  if (k === 'open') location.hash = link(x.host, `/${kind === 'agent' ? 'agent' : 'term'}/${encodeURIComponent(x.pane)}`);
  if (k === 'ws') location.hash = link(x.host, `/ws/${encodeURIComponent(x.workspace)}`);
  if (k === 'stop' && (await sheet({ title: '작업 멈추기', text: `‘${rowLabel(kind, x)}’ 의 작업을 멈출까요? 대화는 남습니다.`, ok: '멈추기', danger: true }))) {
    if (await sendKeys(['esc'], x.host || localId(), x.pane)) toast('멈추라고 보냈습니다');
  }
  if (k === 'rename') renamePane(x, kind === 'agent');
  if (k === 'close') closePane(x.host, x.pane, rowLabel(kind, x), kind === 'agent');
}
