'use strict';
// 명령 (the quick switcher's command mode: Ctrl+Shift+P, ⌘⇧P, F1, or > typed first in 빠른 이동):
// which commands there are and how a query finds them. The page (switcher.js) says which can run
// where it is and runs them; this file only names, matches and orders.
// Pure: loaded as a plain script in the page (window.Palette), required by the tests.
//
// A command: { id, name, hay, group, keys, sub } — name what the row says, hay what a query also
// finds it by (the action's short name and whole label: 「vs code」, 「사이드바」), keys the key hint shown at the end.
(function (root) {
  // > first: command mode, the rest the query. (Leading spaces after it are not part of the query.)
  function parseQuery(value) {
    const v = String(value || '');
    const t = v.replace(/^\s+/, '');
    if (t.startsWith('>')) return { commands: true, query: t.slice(1).trim() };
    return { commands: false, query: v };
  }

  // An action's command name: cmd, else its label up to the first 「:」 or 「 (」 (「대화창 닫기: …」).
  function commandName(a) {
    if (!a) return '';
    if (a.cmd) return a.cmd;
    const l = String(a.label || '');
    const cut = [l.indexOf(':'), l.indexOf(' (')].filter((i) => i > 0);
    return (cut.length ? l.slice(0, Math.min(...cut)) : l).trim();
  }

  // The keymap's actions as commands, in the table's order: not fixed, not noCommand, and only
  // those can(action) allows here. name(action) may rename one for where it is (끝내기 →
  // 「에이전트 끝내기」); hint(action) gives its keys.
  function actionCommands(actions, { can = () => true, name = () => '', hint = () => '', sub = () => '' } = {}) {
    const out = [];
    for (const [action, a] of Object.entries(actions || {})) {
      if (!a || a.fixed || a.noCommand || !can(action)) continue;
      const nm = name(action) || commandName(a);
      out.push({ id: `key:${action}`, action, name: nm, sub: sub(action) || '', group: a.group || '', keys: hint(action) || '', hay: `${nm} ${a.name || ''} ${a.label || ''}` });
    }
    return out;
  }

  const fold = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  // Each of q's characters in s, in order (「셸끝」 finds 「셸 끝내기」, 「nwa」 「new agent」).
  function subsequence(s, q) {
    let i = 0;
    for (const c of s) if (c === q[i] && ++i === q.length) return true;
    return q.length === 0;
  }
  // How well one query word fits a command, lower is better, or -1: it doesn't.
  // 0 the name starts with it, 1 a word of the name does, 2 the name has it, 3 its label has it,
  // 4 its characters are in the name in order.
  function wordScore(c, w) {
    const name = fold(c.name);
    if (name.startsWith(w)) return 0;
    if (name.split(/[\s·,/()]+/).some((p) => p.startsWith(w))) return 1;
    if (name.includes(w)) return 2;
    if (fold(`${c.hay} ${c.sub} ${c.keys}`).includes(w)) return 3;
    if (subsequence(name.replace(/\s/g, ''), w)) return 4;
    return -1;
  }

  // The commands a query finds, best first; the same fit keeps the given order. Nothing typed:
  // all of them as given.
  function filter(cmds, query) {
    const words = fold(query).split(' ').filter(Boolean);
    if (!words.length) return cmds.slice();
    const scored = [];
    cmds.forEach((c, i) => {
      let total = 0;
      for (const w of words) {
        const s = wordScore(c, w);
        if (s < 0) return;
        total += s;
      }
      scored.push({ c, total, i });
    });
    return scored.sort((p, q) => p.total - q.total || p.i - q.i).map((x) => x.c);
  }

  const api = { parseQuery, commandName, actionCommands, filter, subsequence };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Palette = api;
})(typeof self !== 'undefined' ? self : this);
