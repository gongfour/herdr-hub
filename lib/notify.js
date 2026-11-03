'use strict';
// What goes into an agent notification, and the guard for answering from one. Pure.
//
// 답 필요: the parsed question and its options in short ("진행할까요? 1 Yes · 2 Always · 3 No"),
// plus up to two action buttons with the same picks as the quick answers. The payload carries
// the agent's stateSeq: an answer is only sent while the agent is still blocked on that prompt.
// 완료: the first line of the last reply.
// One notification per agent (tag host|pane), so a newer state replaces an older one.

const { choiceKeys, actionChoices, shortLabel, TYPE_OWN } = require('../public/choices');

const BODY_MAX = 180;
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const tagOf = (hostId, pane) => `${hostId}|${pane}`;

// Claude Code's generic permission question, in Korean.
function questionKo(q) {
  const s = String(q || '').trim();
  if (/^do you want to proceed\??$/i.test(s)) return '진행할까요?';
  return s;
}

// The line that says what is being asked about: the command or file in the dialog (the
// context), e.g. "Bash: npm test". Claude Code's dialog starts with a title ("Bash command")
// followed by the command itself.
function subjectOf(choices) {
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
    .filter((x) => !TYPE_OWN.test(x.label))
    .slice(0, 4)
    .map((x) => (choices.numbered ? `${x.n} ${shortLabel(x.label)}` : shortLabel(x.label)))
    .join(' · ');
}

// kind: 'blocked' | 'done'. host: { id, label, multi } (multi: more than one host in view).
// a: the agent as in the hub state. choices: parseChoices() of its screen, or null.
// lastReply: first line of its last reply, or ''.
function buildPayload(kind, host, a, { choices = null, lastReply = '' } = {}) {
  const label = a.name || a.title || a.agent;
  const where = host.multi ? `${host.label} · ${a.workspaceLabel}` : a.workspaceLabel;
  const payload = {
    kind,
    title: `${label}: ${kind === 'blocked' ? '답 필요' : '완료'}`,
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
    const ask = [questionKo(choices.question), optionsLine(choices)].filter(Boolean).join(' ');
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

// HERDR_HUB_PUSH_MUTE: folder or workspace names (prefixes, comma-separated) whose agents never
// notify, e.g. throwaway test workspaces "hub-inbox-".
const parseMute = (spec) => String(spec || '').split(',').map((s) => s.trim()).filter(Boolean);
function muted(a, prefixes) {
  if (!prefixes || !prefixes.length) return false;
  const folder = String(a.cwd || '').split(/[\\/]/).filter(Boolean).pop() || '';
  return prefixes.some((p) => folder.startsWith(p) || String(a.workspaceLabel || '').startsWith(p));
}

// An answer from a notification: only for the prompt it was shown for. agent: as in the state
// (fresh), choices: parsed from its screen just now. Returns { ok, keys, item } or
// { status, error }.
function checkAnswer({ agent, stateSeq, n, label = null, choices }) {
  if (!agent) return { status: 404, error: 'agent_not_found' };
  if (!Number.isInteger(n) || n < 1 || n > 9) return { status: 400, error: 'bad_choice' };
  if (!Number.isInteger(stateSeq)) return { status: 400, error: 'state_seq_required' };
  if (agent.status !== 'blocked') return { status: 409, error: 'not_blocked' };
  if (agent.stateSeq !== stateSeq) return { status: 409, error: 'stale' };
  if (!choices) return { status: 409, error: 'no_choices' };
  const item = choices.items.find((x) => x.n === n);
  if (!item) return { status: 409, error: 'no_choice' };
  if (label != null && item.label !== label) return { status: 409, error: 'stale' };
  if (TYPE_OWN.test(item.label)) return { status: 409, error: 'needs_text' };
  const keys = choiceKeys(choices, n);
  if (!keys) return { status: 409, error: 'no_keys' };
  return { ok: true, keys, item };
}

module.exports = { buildPayload, checkAnswer, muted, parseMute, tagOf, questionKo, subjectOf };
