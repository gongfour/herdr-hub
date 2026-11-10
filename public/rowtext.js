'use strict';
// The words on the 작업공간 list that need no page: a row's folder, a shell row's name,
// a host button's spoken name and the first-visit hint (list.js).
// Pure: loaded as a plain script in the page (window.RowText), required by the tests.
(function (root) {
  const parts = (p) => String(p || '').split(/[\\/]/).filter(Boolean);
  const base = (p) => parts(p).pop() || '';

  // A folder in short: nothing when the folder is named like the workspace (the label says
  // it), else its last two folders ("…\acme\robots_rcs"), in the path's own separator.
  function shortPath(cwd, label) {
    const p = String(cwd || '').trim();
    if (!p) return '';
    const segs = parts(p);
    if (!segs.length || segs[segs.length - 1] === String(label || '').trim()) return '';
    if (segs.length <= 2) return p;
    const sep = p.includes('\\') && !p.includes('/') ? '\\' : '/';
    return `…${sep}${segs.slice(-2).join(sep)}`;
  }

  // A pane row's folder (an agent's or a shell's, where it is now): its last folder alone
  // ("herdr-hub"; the row's tooltip has the whole path), nothing when that folder is named like its
  // workspace or like the row itself (the row says it already). The root is itself ("/", "D:").
  function rowDir(cwd, wsLabel, name) {
    const p = String(cwd || '').trim();
    if (!p) return '';
    const last = base(p) || p;
    if (last === String(name || '').trim() || last === String(wsLabel || '').trim()) return '';
    return last;
  }

  // An agent's name on its small line: nothing when there is no title (the name is the title then)
  // or the title begins with the name ("hub-cwd: 새 대화 시작 폴더", name hub-cwd).
  function metaName(name, title) {
    const n = String(name || '').trim();
    const t = String(title || '').trim();
    if (!n || !t) return '';
    if (t.toLowerCase().startsWith(n.toLowerCase()) && !/[\p{L}\p{N}_-]/u.test(t.charAt(n.length))) return '';
    return n;
  }

  // A folder for a sentence (Ctrl+N's toast): under home as ~/…, and a deep one as its last two
  // folders ("…/herdr-hub/public"), in the path's own separator.
  function homePath(cwd, home) {
    let p = String(cwd || '').trim();
    if (!p) return '';
    const h = String(home || '').replace(/[\\/]+$/, '');
    const win = p.includes('\\') && !p.includes('/');
    const sep = win ? '\\' : '/';
    const eq = (a, b) => (win ? a.toLowerCase() === b.toLowerCase() : a === b);
    if (h && (eq(p, h) || (eq(p.slice(0, h.length), h) && /[\\/]/.test(p[h.length])))) p = '~' + p.slice(h.length);
    const segs = parts(p);
    if (segs.length <= 3) return p;
    return `…${sep}${segs.slice(-2).join(sep)}`;
  }

  // A shell row's name: its label, else its title (a path becomes the program's name), else
  // the folder it is in, else the pane id. herdr's own "셸" (no title) says nothing the row's
  // 셸 tag doesn't.
  function termName(t) {
    const label = String((t && t.label) || '').trim();
    if (label) return label;
    const title = String((t && t.title) || '').trim();
    if (title && title !== '셸') return /[\\/]/.test(title) ? base(title) || title : title;
    return base(t && t.cwd) || String((t && t.pane) || '셸');
  }

  // A host button's name as read aloud: the dot's colour and the ! say this in pictures.
  function hostAria(h, mismatch) {
    return [h.label, h.online ? '' : '오프라인', mismatch ? 'API 버전 다름, 배포 필요' : ''].filter(Boolean).join(', ');
  }

  // A host's dot (list.js hostDot): 'up' (online, herdr answering), 'herdr' (online, herdr not),
  // 'connecting' (a peer added a moment ago, or one the hub has not reached yet since it started:
  // nothing heard, its error still 'connecting') or 'off'.
  function hostState(h) {
    if (!h) return 'off';
    if (h.connecting || (!h.online && h.error === 'connecting' && !h.staleAt)) return 'connecting';
    if (!h.online) return 'off';
    return h.herdr === 'up' ? 'up' : 'herdr';
  }

  // An offline peer's ghost (lib/peers.js staleView) is "as of" when it was last heard:
  // 「오후 10:47 기준」 today, 「어제 오후 10:47 기준」, else 「11월 4일 오후 10:47 기준」.
  function asOf(at, now = Date.now()) {
    if (!at) return '';
    const d = new Date(at);
    const t = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const n = new Date(now);
    const days = Math.round((day(n) - day(d)) / 86400000);
    const when = days <= 0 ? '' : days === 1 ? '어제 ' : `${d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} `;
    return `${when}${t} 기준`;
  }
  // A slash command's menu someone opened (/model …) is held blocked by the host so it can be
  // answered here (a.menu, lib/askhold.js), but nobody is waited for: it is no 답 필요 in counts,
  // badges, the switcher or Alt+Shift+↓, and shows as 「메뉴 열림」, grey like idle. The agent view
  // still treats it as blocked (its box, the guard on sending).
  const needsAnswer = (a) => Boolean(a) && a.status === 'blocked' && !a.menu;
  const shownStatus = (a) => (a && a.status === 'blocked' && a.menu ? 'menu' : a && a.status);

  // A ghost agent's small line: the status it last had, said as past (「마지막: 작업 중」).
  const LAST = { blocked: '답 필요', done: '완료', working: '작업 중', idle: '쉬는 중' };
  const lastStatus = (a) => (a && a.menu && a.lastStatus === 'blocked' ? '마지막: 메뉴 열림' : LAST[a && a.lastStatus] ? `마지막: ${LAST[a.lastStatus]}` : '마지막 모습');

  // The first-visit hint: the host swipe only when there is a host to swipe to.
  const hintText = (multi) => (multi ? '옆으로 밀어 호스트 바꾸기 · 길게 눌러 메뉴' : '줄을 길게 누르면 메뉴가 나옵니다');
  // Seen this many times (one count per app start), or closed with ✕ ('x'), it stays away.
  const HINT_TIMES = 3;
  const hintDue = (stored) => stored !== 'x' && (Number(stored) || 0) < HINT_TIMES;
  const hintNext = (stored) => String(Math.min(HINT_TIMES, (Number(stored) || 0) + 1));

  const api = { needsAnswer, shownStatus, shortPath, rowDir, metaName, homePath, termName, hostAria, hostState, asOf, lastStatus, hintText, hintDue, hintNext, HINT_TIMES };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RowText = api;
})(typeof self !== 'undefined' ? self : this);
