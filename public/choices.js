'use strict';
// Reads the choice menu off a blocked agent's screen, e.g. Claude Code's
//   Do you want to proceed?
//   ❯ 1. Yes
//     2. Yes, and don't ask again for echo commands in …
//     3. No, and tell Claude what to do differently (esc)
// Pure: screen text in, { question, context, items, cursor, numbered } or null out.
// Loaded as a plain script in the page (window.parseChoices) and required by the tests.
(function (root) {
  const I18n = root.I18n || require('./i18n.js');
  const T = I18n.t;
  const CURSOR = '❯>›▶►➤→';
  const ITEM = new RegExp(`^(\\s*)(?:([${CURSOR}])\\s*)?([1-9])[.)]\\s+(\\S.*)$`);
  // A line made only of box-drawing / rule characters: the top or bottom of a dialog.
  const RULE = /^[\s─━═┄┅┈┉╌╍▔▁\-╭╮╰╯┌┐└┘╔╗╚╝├┤┬┴┼]+$/;
  // A dashed rule frames a part inside a dialog (the command of a Bash prompt), not its edge.
  const SOLID_RULE = /^(?=.*[─━═╭╮╰╯┌┐└┘╔╗╚╝])[\s─━═\-╭╮╰╯┌┐└┘╔╗╚╝├┤┬┴┼]+$/;
  const NEGATIVE = /^(no\b|아니|거부|취소|reject|deny|cancel|exit|quit|chat about this)|\b(tell claude what to do differently|reject|deny|cancel)\b|\(esc\)\s*$/i;
  // AskUserQuestion's parts (Claude Code 2.1.318, test/fixtures/ask): the tab bar over the
  // question ("←  ☐ 색  ☒ 크기  ✔ Submit  →", or "☐ 색" alone for one question), a multiSelect
  // option's box ("1. [✔] 사과"), the row under a multiSelect list that goes on ("Submit" or
  // "Next", reached with the arrows), and an option's preview drawn in a box to its right.
  const TAB_BAR = /^\s*(?:←\s+)?([☐☒✔]\s*\S.*?)(?:\s+→)?\s*$/;
  const CHECK = /^\[([ ✔✓xX])\]\s*/;
  const NEXT_ROW = /^\s*(?:[❯›▶►➤>]\s*)?(Submit|Next)\s*$/;
  const PREVIEW_CUT = /\s{3,}[┌│└├╭╰┃].*$/;
  // How many non-empty lines may follow the menu (hints like "Esc to cancel", the input box).
  const MAX_AFTER = 6;
  // Cursor glyphs for menus without numbers; not ">" which also starts quotes and old prompts.
  const MENU_CURSOR = /^\s*[❯›▶►➤]\s+\S/;
  const MENU_CURSOR_GLYPH = /^[❯›▶►➤]\s*/;
  // Whether a digit alone picks and confirms a numbered menu (checked on a real Claude Code prompt).
  const DIGIT_CONFIRMS = true;

  // Claude Code draws its panels (a slash command's menu: /model, /config, /resume …, and its
  // prompts) in place of the input box, under a rule of ▔ (2.1.322, test/fixtures/menu). The idle
  // input box is framed with ─ instead, so a ▔ rule with something under it and no empty input
  // line ("❯ ") below is a panel that waits for keys.
  const PANEL_RULE = /^\s*▔{8,}/;
  const EMPTY_INPUT = /^\s*[❯>]\s*$/;
  // A panel's own keys, offered beside its menu (the key pressed on the picked row instead of
  // Enter). Only the ones known to be harmless: /model's 「s to use this session only」.
  const ALT_KEYS = [[/\b([a-z]) to use this session only\b/i, T('이 세션만')]];

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
        // An option with its preview beside it: the box is not part of its name.
        const label = m[4].replace(PREVIEW_CUT, '');
        const preview = label !== m[4];
        const len = preview ? line.length - (m[4].length - label.length) : line.length;
        const item = { n, label, cursor: Boolean(m[2]), col: line.search(/[1-9][.)]/), rows: [{ text: label, len, ind: indent(line) }] };
        if (cur && n === cur.items.length + 1 && gap <= 1) {
          if (cur.ruled) item.afterRule = true;
          if (preview) cur.preview = true;
          cur.items.push(item);
        } else {
          close();
          if (n !== 1) return;
          cur = { start: i, items: [item], preview };
        }
        cur.end = i;
        gap = 0;
        return;
      }
      if (!cur) return;
      if (!line.trim()) {
        if (++gap > 1 || cur.ruled) close();
        return;
      }
      if (cur.ruled) return close(); // only a next option may follow that rule
      const last = cur.items[cur.items.length - 1];
      const boxed = CHECK.test(cur.items[0].label);
      // multiSelect: the row that goes on, under the options (the cursor may be on it).
      const nx = boxed && !cur.next && gap === 0 && line.match(NEXT_ROW);
      if (nx) {
        cur.next = { label: nx[1], cursor: /^\s*[❯›▶►➤>]/.test(line) };
        cur.end = i;
        return;
      }
      // One rule between the options and the last one (AskUserQuestion's "Chat about this").
      if (RULE.test(line) && gap === 0 && !/[╌┄┈]/.test(line)) {
        cur.ruled = true;
        return;
      }
      // A preview's own lines below the options.
      if (cur.preview && /^[┌│└├╭╰┃]/.test(line.trim())) return;
      // A wrapped option is indented past its number; anything else ends the list.
      if (gap === 0 && indent(line) > last.col && !RULE.test(line)) {
        last.label += ` ${line.trim()}`;
        last.rows.push({ text: line.trim(), len: line.length, ind: indent(line) });
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
    // A ✔ marks the current value (/theme: 「❯ ✔ Dark mode」 over 「    Light mode」): the names line up.
    const col = lines[at].search(/\S/) + lines[at].trim().match(/^\S\s*(?:✔\s+)?/)[0].length;
    const lined = (l) => indent(l) === col || (/^\s*✔\s+\S/.test(l) && indent(l) + l.trim().match(/^✔\s+/)[0].length === col);
    const sibling = (l) => l && l.trim() && lined(l) && !RULE.test(l) && !ITEM.test(l) && !MENU_CURSOR.test(l);
    let start = at;
    let end = at;
    while (start > 0 && sibling(lines[start - 1])) start--;
    while (end < lines.length - 1 && sibling(lines[end + 1])) end++;
    if (end === start) return null;
    // A settings row shows its value in a column of its own ("Also scan shell history     false").
    const named = (l) => l.trim().replace(MENU_CURSOR_GLYPH, '').replace(/^✔\s+(.*)$/, '$1 ✔').replace(/^(\S.*?)\s{2,}(\S.*)$/, '$1 · $2');
    const items = lines.slice(start, end + 1).map((l, k) => ({ n: k + 1, label: named(l), cursor: start + k === at }));
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

  // The panel under the last ▔ rule: { at (the rule's line), title (its first line), hint (its key
  // hints, the last line or two), body (its lines), main (body without title and hint) }, or null
  // when the input box is showing.
  function panelOf(lines) {
    let at = -1;
    for (let i = lines.length - 1; i >= 0 && at < 0; i--) if (PANEL_RULE.test(lines[i])) at = i;
    if (at < 0) return null;
    // body: lines[s, e), blank lines off both ends.
    let s = at + 1;
    let e = lines.length;
    while (e > s && !lines[e - 1].trim()) e--;
    while (s < e && !lines[s].trim()) s++;
    const body = lines.slice(s, e);
    if (!body.length || body.some((l) => EMPTY_INPUT.test(l))) return null;
    const title = body[0].trim();
    // Key hints ("Enter to set as default · s to use this session only · Esc to cancel"), wrapped
    // onto a second line when long (/resume, /artifacts).
    const tail = body.slice(-2).map((l) => l.trim());
    const isHint = (l) => /\b(?:to|for) \S/.test(l) && (/·/.test(l) || /^(?:Esc|Enter|↑|←|Space|Tab)\b/.test(l));
    const two = tail.length > 1 && isHint(`${tail[0]} ${tail[1]}`) && /·\s*\S/.test(tail[0]);
    const hint = isHint(tail[tail.length - 1]) ? (two ? tail.join(' ') : tail[tail.length - 1]) : '';
    // main: what the page shows under the title and over the hint, lines[from, to) (the page
    // finds them there in the colour read: answer.js panelAnsi).
    let from = s + 1;
    let to = e - (hint ? (two ? 2 : 1) : 0);
    while (from < to && !lines[from].trim()) from++;
    while (to > from && !lines[to - 1].trim()) to--;
    const main = lines.slice(from, to);
    return { at, title, hint, body, main, from, to };
  }
  function screenPanel(text) {
    return text ? panelOf(String(text).split(/\r?\n/).map(clean)) : null;
  }

  function parseChoices(text) {
    if (!text) return null;
    let lines = String(text).split(/\r?\n/).map(clean);
    // A panel's menu is in the panel: not a list in the conversation above it.
    const panel = panelOf(lines);
    if (panel) lines = lines.slice(panel.at + 1);
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
      if (l.trim() && !RULE.test(l)) para.push({ text: l.trim(), len: l.length });
      else if (para.length) paras.push(para), (para = []);
    }
    if (para.length) paras.push(para);
    // AskUserQuestion's tab bar: the questions asked together, ☒ when answered. Not context.
    let tabs = null;
    let submitTab = false;
    for (const p of paras) {
      const at = p.findIndex((x) => TAB_BAR.test(x.text) && x.text.split(/\s{2,}/).every((t) => /^(?:←|→|[☐☒✔]\s*\S.*)$/.test(t)));
      if (at < 0) continue;
      const toks = p[at].text.split(/\s{2,}/).filter((t) => /^[☐☒✔]/.test(t));
      submitTab = toks.some((t) => /^✔\s*Submit$/i.test(t));
      tabs = toks.filter((t) => !/^✔\s*Submit$/i.test(t)).map((t) => ({ label: t.replace(/^[☐☒✔]\s*/, ''), done: /^[☒✔]/.test(t) }));
      p.splice(at, 1);
      break;
    }
    for (let i = paras.length - 1; i >= 0; i--) if (!paras[i].length) paras.splice(i, 1);
    // The question: the last paragraph with a "?", cut after its first question mark;
    // else the paragraph right above the list. What comes before it is context (a command, a path).
    let qi = -1;
    const joined = (p) => p.map((x) => x.text).join(' ');
    for (let i = paras.length - 1; i >= 0 && qi < 0; i--) if (/[?？](\s|$)/.test(joined(paras[i]))) qi = i;
    let question = '';
    if (qi >= 0) question = joined(paras[qi]).replace(/\s+/g, ' ').match(/^.*?[?？](?=\s|$)/)[0];
    else if (paras.length) question = joined(paras[(qi = paras.length - 1)]).replace(/\s+/g, ' ');
    // All of it (at most the 20 lines above): the app folds a long one and says so (answer.js);
    // cutting its head would hide the start of the command being allowed.
    const blocks = qi > 0 ? paras.slice(0, qi) : [];
    const context = blocks.flat().map((x) => x.text);

    let multi = false;
    const items = list.items.map(({ n, label, cursor, rows, afterRule }) => {
      let { name, desc } = rows ? splitItem(rows, width) : { name: label, desc: '' };
      // A panel's menu sets its description in a column of its own (/model: 「Opus 5.5 ✔     For
      // complex work」): the name, then the description.
      const col = panel && !desc && name.match(/^(\S.*?)\s{2,}(\S.*)$/);
      if (col) [name, desc] = [col[1], col[2]];
      label = name.replace(/\s+/g, ' ').trim();
      const box = label.match(CHECK);
      const item = { n, label: box ? label.slice(box[0].length) : label, cursor };
      if (box) (multi = true), (item.checked = box[1] !== ' ');
      item.negative = NEGATIVE.test(item.label);
      if (afterRule) item.extra = true; // below the options: "Chat about this"
      if (desc.trim()) item.desc = desc.replace(/\s+/g, ' ').trim();
      return item;
    });
    const sel = items.find((x) => x.cursor);
    const ch = { question, context, items, cursor: sel ? sel.n : null, numbered: list.numbered, blocks, width };
    if (tabs) {
      // steps: more than this one screen to go through (several questions, or a multiSelect's Submit).
      ch.ask = { tabs, steps: tabs.length > 1 || submitTab, review: /^ready to submit your answers\?$/i.test(question) };
    }
    if (multi) ch.multi = true;
    // A preview beside the options: a digit only moves the cursor there; Enter picks.
    if (list.preview) ch.preview = true;
    if (list.next) ch.next = list.next;
    if (panel) {
      ch.panel = { title: panel.title, hint: panel.hint };
      for (const [re, label] of ALT_KEYS) {
        const m = panel.hint.match(re);
        if (m && ch.cursor && !multi) ch.alt = { key: m[1].toLowerCase(), label };
      }
    }
    return ch;
  }

  // Where the cursor sits among a multiSelect list's rows: option n at n, the Next row after the
  // options (before "Chat about this"). Null when no row shows it.
  function cursorRow(ch) {
    if (ch.cursor) return ch.cursor;
    const main = ch.items.filter((x) => !x.extra).length;
    return ch.next && ch.next.cursor ? main + 1 : null;
  }
  const walk = (from, to) => Array(Math.abs(to - from)).fill(to > from ? 'down' : 'up');

  // The keys that go on from a multiSelect list (its Submit/Next row): walk there, then Enter.
  function nextKeys(ch) {
    if (!ch || !ch.multi || !ch.next) return null;
    const main = ch.items.filter((x) => !x.extra).length;
    const from = cursorRow(ch);
    if (!from) return ['right']; // the tab bar's next tab is the same step
    const keys = [...walk(from, main + 1), 'enter'];
    return keys.length <= 8 ? keys : null;
  }

  // A prompt herdr may take for Claude's input box (lib/askhold.js): AskUserQuestion (its tab
  // bar) or the plan approval, at the bottom of the screen with no empty input line under it.
  // Not any numbered menu: a reply's own list sits right above the input box too.
  // Also any of Claude Code's select dialogs, which herdr reports as idle (or working): a menu
  // with its cursor, and under it the dialog's key hint ("←/→ to change · Enter to continue · Esc
  // to cancel"), the last line on the screen. A reply's own list has no such hint, and the empty
  // input line ("❯ ") under it is never a menu.
  // And any other panel of Claude Code's (a slash command's menu, PANEL_RULE), with a menu or not
  // (/status, /help): held as menu, which never notifies — someone just opened it.
  function heldPrompt(text) {
    const ch = parseChoices(text);
    const lines = String(text).split(/\r?\n/).map(clean);
    if (lines.slice(-12).some((l) => EMPTY_INPUT.test(l))) return null;
    if (ch && (ch.ask || /written up a plan/i.test(ch.question))) return ch;
    if (ch && ch.cursor && dialogHint(lines)) return { ...ch, dialog: true, menu: Boolean(ch.panel) };
    const panel = panelOf(lines);
    if (!panel) return null;
    const base = ch && ch.cursor ? ch : { question: panel.title, context: [], items: [], cursor: null, numbered: false, blocks: [], panel: { title: panel.title, hint: panel.hint } };
    return { ...base, dialog: true, menu: true };
  }
  const DIALOG_HINT = /\bEnter to (?:continue|confirm|select|submit|choose|apply|save)\b.*\bEsc to (?:cancel|exit|go back|close|skip)\b/i;
  function dialogHint(lines) {
    const last = lines.filter((l) => l.trim() && !RULE.test(l)).pop();
    return Boolean(last && DIALOG_HINT.test(last));
  }

  // A prompt's step, for telling one screen of a prompt from the next while herdr's state stays
  // the same (AskUserQuestion's questions one after another, a multiSelect's boxes ticked).
  function choicesSig(ch) {
    if (!ch) return '';
    return [ch.question, ...ch.items.map((x) => `${x.n}${x.checked ? '+' : ''}${x.label}`)].join('|').replace(/\s+/g, ' ');
  }

  // What a permission prompt asks, laid out for reading: the kind of request (「셸 명령」), what it
  // is for in a sentence (Claude Code's description of a Bash command), the command itself with
  // the terminal's wrapping undone, and the question in Korean when it is a stock one. Anything
  // not recognised stays as it came: no kind, no intent, the context as the body.
  const KINDS = {
    'bash command': T('셸 명령'), 'edit file': T('파일 고치기'), 'create file': T('파일 만들기'), 'write file': T('파일 쓰기'),
    'read file': T('파일 읽기'), fetch: T('웹 가져오기'), 'web search': T('웹 검색'), 'tool use': T('도구 사용'), 'mcp tool': T('MCP 도구'),
  };
  const QUESTIONS = [
    [/^do you want to proceed\?$/i, T('진행할까요?')],
    [/^do you want to make this edit to (.+)\?$/i, (m) => T('{file} — 이렇게 고칠까요?', { file: m[1] })],
    [/^do you want to create (.+)\?$/i, (m) => T('{file} — 만들까요?', { file: m[1] })],
    [/^do you want to allow (.+)\?$/i, (m) => T('{what} — 허락할까요?', { what: m[1] })],
    [/^claude has written up a plan and is ready to execute\. would you like to proceed\?$/i, T('계획대로 진행할까요?')],
    [/^ready to submit your answers\?$/i, T('이대로 답을 보낼까요?')],
  ];
  function koQuestion(q) {
    for (const [re, ko] of QUESTIONS) {
      const m = String(q || '').match(re);
      if (m) return typeof ko === 'function' ? ko(m) : ko;
    }
    return q || '';
  }
  // Lines the terminal wrapped, joined again (a line ended there when the next word would have fit).
  function unwrap(lines, width) {
    const out = [];
    lines.forEach((l, i) => {
      if (i && wrapped(lines[i - 1], l, width)) out[out.length - 1] += ` ${l.text}`;
      else out.push(l.text);
    });
    return out;
  }
  function promptParts(ch) {
    const blocks = (ch && ch.blocks) || [];
    const first = blocks[0] && blocks[0][0];
    const question = ch ? koQuestion(ch.question) : '';
    // AskUserQuestion and the plan approval have no kind line: they are known by their shape.
    if (ch && ch.ask) return { kind: T('질문'), intent: '', body: ch.context.join('\n'), question };
    if (ch && /written up a plan/i.test(ch.question)) return { kind: T('계획'), intent: '', body: ch.context.join('\n'), question };
    const kind = first ? KINDS[first.text.toLowerCase()] || null : null;
    if (!kind) return { kind: null, intent: '', body: ch ? ch.context.join('\n') : '', question };
    const head = blocks[0].slice(1); // what shares the kind's paragraph (2.1.3xx: the description)
    let rest = blocks.slice(1);
    let intent = head.map((x) => x.text).join(' ');
    // The older Bash layout: the command, then its description as the paragraph's last line.
    if (!intent && kind === T('셸 명령') && rest.length === 1 && rest[0].length >= 2) {
      intent = rest[0][rest[0].length - 1].text;
      rest = [rest[0].slice(0, -1)];
    }
    const body = rest.map((b) => unwrap(b, ch.width).join('\n')).join('\n\n');
    return { kind, intent, body, question };
  }
  // An option as shown: Claude Code's 「(esc)」 tail is a key hint, not part of the answer.
  const shownLabel = (label) => String(label || '').replace(/\s*\(esc\)\s*$/i, '');

  // The keys that pick item n. A digit picks and confirms a numbered Claude Code menu;
  // a menu without numbers is walked with the arrows from the cursor, then Enter.
  // alt: the panel's own key (choices.alt, 「이 세션만」) pressed on that row instead of Enter.
  function choiceKeys(choices, n, alt = false) {
    const item = choices && choices.items.find((x) => x.n === n);
    if (!item) return null;
    if (alt) {
      if (!choices.alt || !choices.cursor || choices.multi) return null;
      const keys = [...walk(choices.cursor, n), choices.alt.key];
      return keys.length <= 8 ? keys : null;
    }
    // multiSelect: a digit ticks a box; "Type something" is a text row, reached with the arrows
    // (a digit there would tick it with no words and leave the cursor away).
    if (choices.multi && TYPE_OWN.test(item.label) && !item.extra) {
      const from = cursorRow(choices);
      return from ? walk(from, n) : null; // [] when it is there already
    }
    if (choices.preview) return [String(n), 'enter'];
    if (choices.numbered) return DIGIT_CONFIRMS ? [String(n)] : [String(n), 'enter'];
    if (!choices.cursor) return null;
    const d = n - choices.cursor;
    const keys = [...Array(Math.abs(d)).fill(d > 0 ? 'down' : 'up'), 'enter'];
    return keys.length <= 8 ? keys : null; // the server takes at most 8 keys
  }

  // An option that asks for your own words (AskUserQuestion's "Type something.").
  // ExitPlanMode's "Tell Claude what to change" works the same way: picked, it takes the words.
  const TYPE_OWN = /^(type something|type your own|other\b|something else|tell claude what to change|직접 입력|기타)/i;

  // The option that words typed into the composer answer while the prompt waits, and how they go:
  // 'own' (AskUserQuestion's "Type something": pick it, then the words go into the question) or
  // 'prompt' (a permission prompt's "No, and tell Claude what to do differently": pick it, then
  // the words are the next message). Null when the prompt takes no words.
  const TELL_CLAUDE = /tell claude what to do|다르게 하라고/i;
  function typedChoice(ch) {
    if (!ch) return null;
    const own = ch.items.find((x) => TYPE_OWN.test(x.label) && choiceKeys(ch, x.n));
    // multiSelect: the words tick the row; Enter would untick it, so the cursor steps off instead.
    if (own) return { item: own, how: 'own', after: ch.multi ? ['up'] : ['enter'] };
    const tell = ch.items.find((x) => TELL_CLAUDE.test(x.label) && choiceKeys(ch, x.n));
    return tell ? { item: tell, how: 'prompt' } : null;
  }

  // The quick answers offered outside the detail view (the 답 필요 strip): up to three, a numbered
  // menu's first options or a Yes/No menu; never "Type something".
  function quickChoices(ch) {
    if (!ch) return [];
    // One tap can't answer these: boxes to tick, or more questions after this one (the review
    // screen that ends them can be).
    if (ch.multi || (ch.ask && ch.ask.steps && !ch.ask.review)) return [];
    // Not "Chat about this" either: it sets the question aside, not an answer to pick in a hurry.
    const items = ch.items.filter((x) => !x.extra && !TYPE_OWN.test(x.label) && choiceKeys(ch, x.n));
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

  // A prompt read while it was still being drawn has no options yet, or only its header
  // ("Bash command") where the question goes; such a read is worth repeating.
  function choicesSettled(ch) {
    return Boolean(ch && ch.items.length && /[?？]/.test(ch.question));
  }

  const api = { heldPrompt, screenPanel, nextKeys, choicesSig, parseChoices, choiceKeys, quickChoices, actionChoices, shortLabel, choicesSettled, typedChoice, TYPE_OWN, promptParts, koQuestion, shownLabel };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root, { heldPrompt, screenPanel, nextKeys, choicesSig, parseChoices, choiceKeys, quickChoices, actionChoices, shortLabel, choicesSettled, typedChoice, TYPE_OWN, promptParts, koQuestion, shownLabel });
})(typeof self !== 'undefined' ? self : this);
