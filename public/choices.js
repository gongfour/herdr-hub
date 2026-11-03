'use strict';
// Reads the choice menu off a blocked agent's screen, e.g. Claude Code's
//   Do you want to proceed?
//   ❯ 1. Yes
//     2. Yes, and don't ask again for echo commands in …
//     3. No, and tell Claude what to do differently (esc)
// Pure: screen text in, { question, context, items, cursor, numbered } or null out.
// Loaded as a plain script in the page (window.parseChoices) and required by the tests.
(function (root) {
  const CURSOR = '❯>›▶►➤→';
  const ITEM = new RegExp(`^(\\s*)(?:([${CURSOR}])\\s*)?([1-9])[.)]\\s+(\\S.*)$`);
  // A line made only of box-drawing / rule characters: the top or bottom of a dialog.
  const RULE = /^[\s─━═┄┅┈┉╌╍▔▁\-╭╮╰╯┌┐└┘╔╗╚╝├┤┬┴┼]+$/;
  // A dashed rule frames a part inside a dialog (the command of a Bash prompt), not its edge.
  const SOLID_RULE = /^(?=.*[─━═╭╮╰╯┌┐└┘╔╗╚╝])[\s─━═\-╭╮╰╯┌┐└┘╔╗╚╝├┤┬┴┼]+$/;
  const NEGATIVE = /^(no\b|아니|거부|취소|reject|deny|cancel|exit|quit)|\b(tell claude what to do differently|reject|deny|cancel)\b|\(esc\)\s*$/i;
  // How many non-empty lines may follow the menu (hints like "Esc to cancel", the input box).
  const MAX_AFTER = 6;
  // Cursor glyphs for menus without numbers; not ">" which also starts quotes and old prompts.
  const MENU_CURSOR = /^\s*[❯›▶►➤]\s+\S/;
  const MENU_CURSOR_GLYPH = /^[❯›▶►➤]\s*/;
  // Whether a digit alone picks and confirms a numbered menu (checked on a real Claude Code prompt).
  const DIGIT_CONFIRMS = true;

  // Strip a dialog's side borders, keeping the indentation inside them.
  function clean(line) {
    const s = String(line).replace(/\s+$/, '');
    const m = s.match(/^\s*[│┃║]/);
    return (m ? s.slice(m[0].length) : s).replace(/\s*[│┃║]\s*$/, '');
  }
  const indent = (s) => s.match(/^\s*/)[0].length;

  // Every run of items numbered 1, 2, 3 … with their wrapped continuation lines.
  function lists(lines) {
    const out = [];
    let cur = null;
    let gap = 0; // blank lines since the last item line
    const close = () => {
      if (cur && cur.items.length >= 2) out.push(cur);
      cur = null;
    };
    lines.forEach((line, i) => {
      const m = line.match(ITEM);
      if (m) {
        const n = Number(m[3]);
        if (cur && n === cur.items.length + 1 && gap <= 1) {
          cur.items.push({ n, label: m[4], cursor: Boolean(m[2]), col: line.search(/[1-9][.)]/) });
        } else {
          close();
          if (n !== 1) return;
          cur = { start: i, items: [{ n, label: m[4], cursor: Boolean(m[2]), col: line.search(/[1-9][.)]/) }] };
        }
        cur.end = i;
        gap = 0;
        return;
      }
      if (!cur) return;
      if (!line.trim()) {
        if (++gap > 1) close();
        return;
      }
      const last = cur.items[cur.items.length - 1];
      // A wrapped option is indented past its number; anything else ends the list.
      if (gap === 0 && indent(line) > last.col && !RULE.test(line)) {
        last.label += ` ${line.trim()}`;
        cur.end = i;
      } else close();
    });
    close();
    return out;
  }

  // A menu without numbers (Claude Code's folder trust prompt): one line carries the cursor and
  // its siblings start at the same column. Chosen with arrow keys, so the cursor must be known.
  function cursorMenu(lines) {
    let at = -1;
    for (let i = lines.length - 1; i >= 0 && at < 0; i--) if (MENU_CURSOR.test(lines[i]) && !ITEM.test(lines[i])) at = i;
    if (at < 0) return null;
    const col = lines[at].search(/\S/) + lines[at].trim().match(/^\S\s*/)[0].length;
    const sibling = (l) => l && l.trim() && indent(l) === col && !RULE.test(l) && !ITEM.test(l) && !MENU_CURSOR.test(l);
    let start = at;
    let end = at;
    while (start > 0 && sibling(lines[start - 1])) start--;
    while (end < lines.length - 1 && sibling(lines[end + 1])) end++;
    if (end === start) return null;
    const items = lines.slice(start, end + 1).map((l, k) => ({ n: k + 1, label: l.trim().replace(MENU_CURSOR_GLYPH, ''), cursor: start + k === at }));
    return { start, end, items, numbered: false };
  }

  const nonEmptyAfter = (lines, end) => lines.slice(end + 1).filter((l) => l.trim() && !RULE.test(l)).length;

  function parseChoices(text) {
    if (!text) return null;
    const lines = String(text).split(/\r?\n/).map(clean);
    const numbered = lists(lines).pop();
    const candidates = [numbered && { ...numbered, numbered: true }, cursorMenu(lines)]
      .filter((x) => x && nonEmptyAfter(lines, x.end) <= MAX_AFTER)
      .sort((x, y) => y.end - x.end);
    const list = candidates[0];
    if (!list) return null;

    // The dialog above the list: back to the nearest solid rule (or 20 lines), in paragraphs;
    // a dashed rule separates paragraphs.
    let top = list.start;
    while (top > 0 && list.start - top < 20 && !SOLID_RULE.test(lines[top - 1])) top--;
    const paras = [];
    let para = [];
    for (const l of lines.slice(top, list.start)) {
      if (/^\s*Tip:/.test(l)) continue; // Claude Code's hints are not part of the question
      if (l.trim() && !RULE.test(l)) para.push(l.trim());
      else if (para.length) paras.push(para), (para = []);
    }
    if (para.length) paras.push(para);
    // The question: the last paragraph with a "?", cut after its first question mark;
    // else the paragraph right above the list. What comes before it is context (a command, a path).
    let qi = -1;
    for (let i = paras.length - 1; i >= 0 && qi < 0; i--) if (/[?？](\s|$)/.test(paras[i].join(' '))) qi = i;
    let question = '';
    if (qi >= 0) question = paras[qi].join(' ').replace(/\s+/g, ' ').match(/^.*?[?？](?=\s|$)/)[0];
    else if (paras.length) question = paras[(qi = paras.length - 1)].join(' ').replace(/\s+/g, ' ');
    const context = qi > 0 ? paras.slice(0, qi).flat().slice(-6) : [];

    const items = list.items.map(({ n, label, cursor }) => {
      label = label.replace(/\s+/g, ' ').trim();
      return { n, label, cursor, negative: NEGATIVE.test(label) };
    });
    const sel = items.find((x) => x.cursor);
    return { question, context, items, cursor: sel ? sel.n : null, numbered: list.numbered };
  }

  // The keys that pick item n. A digit picks and confirms a numbered Claude Code menu;
  // a menu without numbers is walked with the arrows from the cursor, then Enter.
  function choiceKeys(choices, n) {
    if (!choices || !choices.items.some((x) => x.n === n)) return null;
    if (choices.numbered) return DIGIT_CONFIRMS ? [String(n)] : [String(n), 'enter'];
    if (!choices.cursor) return null;
    const d = n - choices.cursor;
    const keys = [...Array(Math.abs(d)).fill(d > 0 ? 'down' : 'up'), 'enter'];
    return keys.length <= 8 ? keys : null; // the server takes at most 8 keys
  }

  if (typeof module === 'object' && module.exports) module.exports = { parseChoices, choiceKeys };
  else Object.assign(root, { parseChoices, choiceKeys });
})(typeof self !== 'undefined' ? self : this);
