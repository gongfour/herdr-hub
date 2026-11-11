'use strict';
// What goes into an agent notification, and the guard for answering from one. Pure.
//
// 답 필요: the parsed question and its options in short ("진행할까요? 1 Yes · 2 Always · 3 No"),
// plus up to two action buttons with the same picks as the quick answers. The payload carries
// the agent's stateSeq: an answer is only sent while the agent is still blocked on that prompt.
// 완료: the first line of the last reply.
// One notification per agent (tag host|pane), so a newer state replaces an older one.

const { choiceKeys, actionChoices, shortLabel, TYPE_OWN } = require('../public/choices');
// Each device's own language (lib/push.js keeps it with the subscription): the page's words.
const { tIn } = require('../public/i18n');

const BODY_MAX = 180;
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const tagOf = (hostId, pane) => `${hostId}|${pane}`;

// Claude Code's generic permission question, in Korean (in English it is already said).
function questionKo(q, lang = 'ko') {
  const s = String(q || '').trim();
  if (lang === 'ko' && /^do you want to proceed\??$/i.test(s)) return tIn(lang, '진행할까요?');
  return s;
}

// The line that says what is being asked about: the command or file in the dialog (the
// context), e.g. "Bash: npm test". Claude Code's dialog starts with a title ("Bash command")
// followed by the command itself.
function subjectOf(choices) {
  // AskUserQuestion: its questions' headers, from the tab bar over it.
  if (choices.ask && choices.ask.tabs.length) return choices.ask.tabs.map((t) => t.label).join(' · ');
  const ctx = (choices.context || []).map((l) => l.replace(/^[☐☒✔✓□■]\s*/, '').trim()).filter(Boolean);
  if (!ctx.length) return '';
  const title = /^(.+?)\s+(command|edit|file|tool)$/i.exec(ctx[0]);
  if (!title || ctx.length < 2) return ctx[0];
  // The command and its description come in either order (2.1.316 puts the description first):
  // prefer the line that doesn't read as a sentence.
  const rest = ctx.slice(1);
  const pick = rest.find((l) => !/^[A-Z][a-z]+\s/.test(l)) || rest[0];
  return `${title[1]}: ${pick}`;
}

function optionsLine(choices) {
  return choices.items
    .filter((x) => !TYPE_OWN.test(x.label) && !x.extra)
    .slice(0, 4)
    .map((x) => (choices.numbered ? `${x.n} ${shortLabel(x.label)}` : shortLabel(x.label)))
    .join(' · ');
}

// kind: 'blocked' | 'done'. host: { id, label, multi } (multi: more than one host in view).
// a: the agent as in the hub state. choices: parseChoices() of its screen, or null.
// lastReply: first line of its last reply, or ''. lang: the device's ('ko' | 'en').
function buildPayload(kind, host, a, { choices = null, lastReply = '', lang = 'ko' } = {}) {
  const label = a.name || a.title || a.agent;
  const where = host.multi ? `${host.label} · ${a.workspaceLabel}` : a.workspaceLabel;
  const payload = {
    kind,
    title: `${label}: ${kind === 'blocked' ? tIn(lang, '답 필요') : tIn(lang, '완료')}`,
    lang, // the service worker's own words after an answer (sw.js)
    body: `${a.agent} · ${where}`,
    url: `/#/h/${host.id}/agent/${encodeURIComponent(a.pane)}`,
    tag: tagOf(host.id, a.pane),
    renotify: kind === 'blocked',
    host: host.id,
    pane: a.pane,
    stateSeq: a.stateSeq,
  };
  if (kind === 'blocked' && choices && choices.items && choices.items.length) {
    const subject = subjectOf(choices);
    const ask = [questionKo(choices.question, lang), optionsLine(choices)].filter(Boolean).join(' ');
    payload.body = clip([subject, ask].filter(Boolean).join('\n'), BODY_MAX);
    const acts = actionChoices(choices);
    if (acts.length) {
      payload.actions = acts.map((x) => ({ action: `answer:${x.n}`, title: shortLabel(x.label) }));
      payload.answers = Object.fromEntries(acts.map((x) => [x.n, x.label]));
    }
  } else if (kind === 'done' && lastReply) {
    payload.body = clip(`${lastReply}\n${where}`, BODY_MAX);
  }
  return payload;
}

// What a status change from b to a ({ status, completion }) is worth a notification for:
// 'blocked', 'done' or null. herdr 0.9.3 has no completion_seq; there working -> done is the
// finish. A question answered No (blocked -> done/idle) ends the turn without a reply: herdr
// counts that as a completion, but it is the user's own doing and not reported (lib/times.js).
// A turn that ends while its subagents still run (a.subagents, lib/subagents.js) is not finished
// either: the agent takes their reports up when they stop, and that turn's end is the 완료.
function transitionKind(b, a) {
  if (!b || !a) return null;
  // A menu someone opened (a.menu, lib/askhold.js) is no question for them.
  if (a.status === 'blocked' && b.status !== 'blocked') return a.menu ? null : 'blocked';
  if (b.status === 'blocked') return null;
  if (Array.isArray(a.subagents) && a.subagents.length) return null;
  const finished = a.completion != null && b.completion != null ? a.completion > b.completion && a.status !== 'working' : a.status === 'done' && b.status === 'working';
  return finished ? 'done' : null;
}

// HERDR_HUB_PUSH_MUTE: folder or workspace names (prefixes, comma-separated) whose agents never
// notify, e.g. throwaway test workspaces "hub-inbox-".
const parseMute = (spec) => String(spec || '').split(',').map((s) => s.trim()).filter(Boolean);
function muted(a, prefixes) {
  if (!prefixes || !prefixes.length) return false;
  const folder = String(a.cwd || '').split(/[\\/]/).filter(Boolean).pop() || '';
  return prefixes.some((p) => folder.startsWith(p) || String(a.workspaceLabel || '').startsWith(p));
}

// The option's name as the page read it against the one read here now (the same parser over
// the same 30 lines), spacing aside.
const squash = (s) => String(s).replace(/\s+/g, ' ').trim();
const sameLabel = (a, b) => squash(a) === squash(b);

// An answer (a notification button, or a choice button in the app): only for the prompt it was
// shown for. agent: as in the state (fresh), choices: parsed from its screen just now.
// allowOwn: the app may pick "Type something" (it then sends the words itself); a notification
// can't. alt: the menu's own key on that row instead of Enter (choices.alt, /model's 「이 세션만」).
// Returns { ok, keys, item } or { status, error }.
function checkAnswer({ agent, stateSeq, n, label = null, choices, allowOwn = false, alt = false }) {
  if (!agent) return { status: 404, error: 'agent_not_found' };
  if (!Number.isInteger(n) || n < 1 || n > 9) return { status: 400, error: 'bad_choice' };
  if (!Number.isInteger(stateSeq)) return { status: 400, error: 'state_seq_required' };
  if (agent.status !== 'blocked') return { status: 409, error: 'not_blocked' };
  if (agent.stateSeq !== stateSeq) return { status: 409, error: 'stale' };
  if (!choices) return { status: 409, error: 'no_choices' };
  const item = choices.items.find((x) => x.n === n);
  if (!item) return { status: 409, error: 'no_choice' };
  if (label != null && !sameLabel(item.label, label)) return { status: 409, error: 'stale' };
  if (TYPE_OWN.test(item.label) && !allowOwn) return { status: 409, error: 'needs_text' };
  const keys = choiceKeys(choices, n, alt);
  if (!keys) return { status: 409, error: 'no_keys' };
  return { ok: true, keys, item };
}

module.exports = { buildPayload, checkAnswer, transitionKind, muted, parseMute, tagOf, questionKo, subjectOf };
