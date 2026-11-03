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
        const item = { n, label: m[4], cursor: Boolean(m[2]), col: line.search(/[1-9][.)]/), rows: [{ text: m[4], len: line.length }] };
        if (cur && n === cur.items.length + 1 && gap <= 1) {
          cur.items.push(item);
        } else {
          close();
          if (n !== 1) return;
          cur = { start: i, items: [item] };
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
        last.rows.push({ text: line.trim(), len: line.length });
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

  // An option's lines: the name, then (AskUserQuestion) its description on lines of their own.
  // A line was wrapped when the next line's first word would not have fitted after it within
  // the screen's width (the longest text line); otherwise it ended there and what follows is
  // the description.
  const wrapped = (prev, next, width) => prev.len + 1 + (next.text.match(/^\S+/) || [''])[0].length > width;
  function splitItem(rows, width) {
    let i = 1;
    let name = rows[0].text;
    while (i < rows.length && wrapped(rows[i - 1], rows[i], width)) name += ` ${rows[i++].text}`;
    const desc = rows.slice(i).map((r) => r.text).join(' ');
    return { name, desc };
  }

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
    const width = Math.max(...lines.filter((l) => !RULE.test(l)).map((l) => l.length));
    const paras = [];
    let para = [];
    let tip = null; // the last line of a "Tip:" hint, whose wrapped rest is skipped too
    for (const l of lines.slice(top, list.start)) {
      // Claude Code's hints are not part of the question, nor is a hint's wrapped continuation.
      if (/^\s*Tip:/.test(l) || (tip && l.trim() && wrapped({ len: tip.length }, { text: l.trim() }, width))) {
        tip = l;
        continue;
      }
      tip = null;
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

    const items = list.items.map(({ n, label, cursor, rows }) => {
      const { name, desc } = rows ? splitItem(rows, width) : { name: label, desc: '' };
      label = name.replace(/\s+/g, ' ').trim();
      const item = { n, label, cursor, negative: NEGATIVE.test(label) };
      if (desc.trim()) item.desc = desc.replace(/\s+/g, ' ').trim();
      return item;
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

  // An option that asks for your own words (AskUserQuestion's "Type something.").
  const TYPE_OWN = /^(type something|type your own|other\b|something else|직접 입력|기타)/i;

  // The quick answers offered outside the detail view (the 답 필요 strip): up to three, a numbered
  // menu's first options or a Yes/No menu; never "Type something".
  function quickChoices(ch) {
    if (!ch) return [];
    const items = ch.items.filter((x) => !TYPE_OWN.test(x.label) && choiceKeys(ch, x.n));
    // A permission prompt's refusal comes last (1 Yes, 2-3 Yes and …, 4 No): keep it in reach.
    const neg = items.find((x) => x.negative);
    if (ch.numbered) return neg && items.indexOf(neg) >= 3 ? [...items.slice(0, 2), neg] : items.slice(0, 3);
    return items.length <= 3 && items.every((x) => /^(yes|no)\b/i.test(x.label)) ? items : [];
  }

  // A notification has room for two: the first quick answer and the refusal when there is one
  // (Yes · No), else the first two.
  function actionChoices(ch) {
    const q = quickChoices(ch);
    if (q.length <= 2) return q;
    const neg = q.find((x) => x.negative);
    return neg && neg !== q[0] ? [q[0], neg] : q.slice(0, 2);
  }

  // An option in a few words, for a notification line or button:
  // "Yes, and don't ask again for echo commands in …" -> "Always".
  function shortLabel(label) {
    const s = String(label || '').replace(/\s+/g, ' ').trim();
    if (/^yes,? and (don'?t ask again|always allow)/i.test(s)) return 'Always';
    if (/^yes,? and switch to auto mode/i.test(s)) return 'Auto mode';
    if (/^yes,? allow all/i.test(s)) return 'Allow all';
    if (/^no,? and tell /i.test(s)) return 'No';
    const head = s.replace(/\s*\([^)]*\)\s*$/, '').split(/[,.;:—–]\s/)[0].trim() || s;
    return head.length > 24 ? `${head.slice(0, 23).trimEnd()}…` : head;
  }

  const api = { parseChoices, choiceKeys, quickChoices, actionChoices, shortLabel, TYPE_OWN };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root, { parseChoices, choiceKeys, quickChoices, actionChoices, shortLabel });
})(typeof self !== 'undefined' ? self : this);
