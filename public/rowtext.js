'use strict';
// The words on the 작업공간 list that need no page: a card's folder line, a shell row's name,
// a host button's spoken name and the first-visit hint (list.js).
// Pure: loaded as a plain script in the page (window.RowText), required by the tests.
(function (root) {
  const parts = (p) => String(p || '').split(/[\\/]/).filter(Boolean);
  const base = (p) => parts(p).pop() || '';

  // A card's folder line: nothing when the folder is named like the workspace (the label says
  // it), else its last two folders ("…\digitrack\dotori_rcs"), in the path's own separator.
  function shortPath(cwd, label) {
    const p = String(cwd || '').trim();
    if (!p) return '';
    const segs = parts(p);
    if (!segs.length || segs[segs.length - 1] === String(label || '').trim()) return '';
    if (segs.length <= 2) return p;
    const sep = p.includes('\\') && !p.includes('/') ? '\\' : '/';
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

  // The first-visit hint: the host swipe only when there is a host to swipe to.
  const hintText = (multi) => (multi ? '옆으로 밀어 기기 바꾸기 · 길게 눌러 메뉴' : '줄을 길게 누르면 메뉴가 나옵니다');
  // Seen this many times (one count per app start), or closed with ✕ ('x'), it stays away.
  const HINT_TIMES = 3;
  const hintDue = (stored) => stored !== 'x' && (Number(stored) || 0) < HINT_TIMES;
  const hintNext = (stored) => String(Math.min(HINT_TIMES, (Number(stored) || 0) + 1));

  const api = { shortPath, termName, hostAria, hintText, hintDue, hintNext, HINT_TIMES };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RowText = api;
})(typeof self !== 'undefined' ? self : this);
