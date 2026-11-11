'use strict';
// Agents on this host: the screen, the composer's "/" and "@" lists, the transcript, a prompt,
// keys, 지금 보내기, 대기 중 취소, an answer to its prompt, rename. And POST /api/answer, a notification's
// button: answered here, or passed to the peer the agent is on.
const commands = require('../commands');
const transcript = require('../transcript');
const fsq = require('../fsq');
const CQ = require('../claudequeue');
const notifyLib = require('../notify');
const { parseChoices, choicesSig, heldPrompt } = require('../../public/choices');
const { route, NEXT } = require('../router');
const { send, readJson } = require('../http');
const { AGENT_NAME, validKeys, badText, cleanLines } = require('../validate');

const ANSWER_HOLD_MS = 5000;
// 대기 중 취소: how long to wait for Claude Code to log and show what ↑ pulled back (steps × tries;
// the step from the hub's env, HERDR_HUB_UNQUEUE_STEP_MS, inside the routes below).
const CQ_TRIES = 12;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Keys sent with { read } (a slash command's menu moved by key, public/answer.js menuSend): the
// screen is read again every READ_STEP_MS until it differs from the one before the keys, at most
// READ_TRIES times, and goes back with the answer: one round trip shows where the cursor went.
const READ_STEP_MS = 40;
const READ_TRIES = 6;
// What an answer request gets back (here, or through the hub from a notification button).
const answerBody = (r) => (r.ok ? { ok: true, n: r.item.n, label: r.item.label } : { error: r.error });

module.exports = (hub) => {
  const CQ_STEP_MS = Number((hub.env || {}).HERDR_HUB_UNQUEUE_STEP_MS) || 150;
  const { herdr } = hub;

  // The guard runs on fresh state: herdr is asked again, and the screen read now. A second answer
  // to the same prompt soon after (a double tap, or the app and a notification both) is refused:
  // the first one's keys may not have moved the agent on yet. "The same prompt" is the same screen
  // of it (choicesSig): AskUserQuestion takes its questions one after another, and a multiSelect
  // its boxes, all while herdr's state stays the same; each new screen takes its own answer.
  const answered = new Map(); // pane -> { seq, sig, at }
  async function answerLocal(pane, body, { allowOwn = false } = {}) {
    await hub.refresh();
    const agent = hub.findAgent(pane);
    let stateSeq = Number.isInteger(body.stateSeq) ? body.stateSeq : null;
    // Drawn just before herdr misread the prompt's last screen as idle (lib/askhold.js): the same prompt.
    const ah = hub.askHeld.get(pane);
    if (agent && ah && ah.from != null && agent.stateSeq === ah.seq && stateSeq === ah.from) stateSeq = ah.seq;
    const n = Number(body.n);
    const label = typeof body.label === 'string' ? body.label : null;
    let choices = null;
    if (agent && agent.status === 'blocked' && agent.stateSeq === stateSeq)
      choices = parseChoices(String((await hub.readScreen('agent.read', { target: pane }, 'visible', 30)).text || '').replace(/\s+$/, ''));
    const sig = choicesSig(choices);
    const held = () => {
      const last = answered.get(pane);
      return Boolean(last && last.seq === stateSeq && last.sig === sig && hub.now() - last.at < ANSWER_HOLD_MS);
    };
    if (held()) return { status: 409, error: 'answered' };
    const r = notifyLib.checkAnswer({ agent, stateSeq, n, label, choices, allowOwn, alt: body.alt === true });
    if (!r.ok) return r;
    // Checked again after the reads above, and claimed before the keys go: a request that arrived
    // meanwhile is refused.
    if (held()) return { status: 409, error: 'answered' };
    const claim = { seq: stateSeq, sig, at: hub.now() };
    for (const [p, last] of answered) if (hub.now() - last.at >= ANSWER_HOLD_MS) answered.delete(p); // spent claims
    answered.set(pane, claim);
    // Nothing to press: the cursor is on that row already (a multiSelect's "Type something").
    if (!r.keys.length) return r;
    try {
      await herdr.call('agent.send_keys', { target: pane, keys: r.keys });
    } catch (err) {
      if (answered.get(pane) === claim) answered.delete(pane);
      throw err;
    }
    hub.recheckAsk(pane);
    hub.refreshSoon();
    return r;
  }

  const unqueuing = new Map(); // pane -> the cancel running there
  const box = async (pane) => CQ.promptBox((await hub.readScreen('agent.read', { target: pane }, 'visible', 60)).text);
  // Ctrl+U until the input is empty: two presses a line (its text, then the break before it), a
  // wrapped line counted as the lines it shows, and two more; on an empty input it does nothing.
  async function clearInput(pane, shown) {
    for (let round = 0; round < 2; round++) {
      await herdr.call('agent.send_keys', { target: pane, keys: Array(2 * shown.split('\n').length + 2).fill('ctrl+u') });
      await sleep(CQ_STEP_MS);
      shown = await box(pane);
      if (shown === null) return false;
      if (CQ.boxEmpty(shown)) return true;
    }
    return false;
  }
  async function unqueue(pane, session, text) {
    const t0 = await transcript.queueOps(session);
    if (!t0) return { status: 409, error: 'not_queued' };
    const queued = CQ.replay(t0.ops).filter(CQ.typed);
    const at = queued.findIndex((c) => CQ.sameQueued(c, text));
    if (at < 0) return { status: 409, error: 'not_queued' };
    if (queued.some((c, i) => i !== at && CQ.hasImage(c))) return { status: 409, error: 'images_queued' };
    const before = await box(pane);
    if (before === null || !CQ.boxEmpty(before)) return { status: 409, error: 'input_busy' };
    await herdr.call('agent.send_keys', { target: pane, keys: ['up'] });
    // What ↑ pulled back, as Claude Code logged it; the input shows it a moment later.
    let pulled = [];
    let shown = null;
    for (let i = 0; i < CQ_TRIES; i++) {
      await sleep(CQ_STEP_MS);
      const since = await transcript.queueOps(session, { at: t0.end });
      pulled = since ? since.ops.filter((o) => o.op === 'popAll' && o.content != null && CQ.typed(o.content)).map((o) => o.content) : [];
      shown = await box(pane);
      if (pulled.length && shown !== null && CQ.boxHolds(shown, pulled)) break;
    }
    if (!pulled.length) {
      // Nothing came back: the queue went in meanwhile (between tool calls), and ↑ with nothing
      // queued walks the input's history. An empty input is as it was; anything else is left alone.
      return { status: 409, error: shown === null || CQ.boxEmpty(shown) ? 'not_queued' : 'unsure' };
    }
    if (shown === null || !CQ.boxHolds(shown, pulled)) return { status: 409, error: 'unsure' };
    if (!(await clearInput(pane, shown))) return { status: 409, error: 'unsure' };
    const i = pulled.findIndex((c) => CQ.sameQueued(c, text));
    const kept = pulled.filter((_, j) => j !== i);
    // The input is empty now: what is not sent again from here on is gone, so a failure says how many.
    for (let n = 0; n < kept.length; n++) {
      try {
        await herdr.call('agent.prompt', { target: pane, text: kept[n] });
      } catch (err) {
        console.log(`${new Date().toISOString()} unqueue ${pane}: sending a kept prompt again failed (${err.code || err.message}); ${kept.length - n} not sent`);
        return { status: 502, error: 'requeue_failed', lost: kept.length - n };
      }
    }
    // herdr answers before Claude Code has taken the last one in: wait for its input to be empty
    // again, so the next cancel (or a message from here) finds it as before.
    for (let n = 0; kept.length && n < CQ_TRIES; n++) {
      const now = await box(pane).catch(() => null);
      if (now === null || CQ.boxEmpty(now)) break;
      await sleep(CQ_STEP_MS);
    }
    // Taken between the first read and ↑: the others are back in the queue, this one went.
    if (i < 0) return { status: 409, error: 'not_queued' };
    return { kept: kept.length };
  }

  return [
    // An agent herdr listed at the last refresh.
    route('*', 'agents/:pane/*', (req, res, m) => {
      m.agent = hub.findAgent(m.params.pane);
      if (!m.agent) return send(res, 404, { error: 'agent_not_found' });
      return NEXT;
    }),
    route('GET', 'agents/:pane/screen/*', async (req, res, { params: { pane }, url }) => {
      const lines = cleanLines(url.searchParams.get('lines'), 80);
      return send(res, 200, await hub.readScreen('agent.read', { target: pane }, url.searchParams.get('source'), lines, url.searchParams.get('format')));
    }),
    // What the composer offers after "/" and "@": Claude agents only, read on this host.
    route('GET', 'agents/:pane/commands', async (req, res, { agent }) => {
      if (agent.agent !== 'claude' || !agent.cwd) return send(res, 200, { supported: false, commands: [], files: [] });
      const r = await commands.list(agent.cwd);
      return send(res, 200, { supported: true, cwd: agent.cwd, commands: r.commands, ...(r.partial ? { partial: true } : {}) });
    }),
    route('GET', 'agents/:pane/files', async (req, res, { agent, url }) => {
      if (agent.agent !== 'claude' || !agent.cwd) return send(res, 200, { supported: false, commands: [], files: [] });
      const q = (url.searchParams.get('q') || '').slice(0, 300);
      return send(res, 200, { supported: true, ...(await commands.files(agent.cwd, q)) });
    }),
    route('GET', 'agents/:pane/transcript/*', async (req, res, { agent, url }) => {
      if (agent.agent !== 'claude' || !agent.session) return send(res, 200, { supported: false, messages: [] });
      const limit = Math.min(Number(url.searchParams.get('limit')) || 120, 500);
      const q = (k) => (url.searchParams.get(k) || '').slice(0, 100) || null;
      const opts = { since: q('since'), rev: q('rev'), before: q('before') };
      return send(res, 200, { supported: true, ...(await transcript.read(agent.session, limit, opts)) });
    }),
    // One of its subagents' work (lib/subagents.js), for its Agent line opened in the chat:
    // { supported, found, id, type, desc, running, since, tools, more, cut, report }.
    route('GET', 'agents/:pane/subagents/:id', async (req, res, { agent, params: { id } }) => {
      if (agent.agent !== 'claude' || !agent.session) return send(res, 200, { supported: false, found: false });
      const b = fsq.budget();
      const file = await transcript.locate(agent.session, b);
      if (!file) return send(res, 200, { supported: true, found: false });
      const g = await transcript.glance(agent.session, b).catch(() => null);
      return send(res, 200, { supported: true, ...(await hub.subagents.log(file, id, (g && g.notified) || {}, b)) });
    }),
    // A Claude agent showing a select dialog herdr calls idle or working (lib/askhold.js) would
    // take the words as keys in the dialog: refused, read now (the hub's last read may be 15 s
    // old), and the agent shown as waiting for an answer from the next refresh on.
    route('POST', 'agents/:pane/prompt/*', async (req, res, { params: { pane }, agent }) => {
      const { text } = await readJson(req);
      if (typeof text !== 'string' || !text.trim()) return send(res, 400, { error: 'empty_prompt' });
      const h = hub.askHeld.get(pane);
      if (agent.agent === 'claude' && (agent.status !== 'blocked' || (h && h.seq === agent.stateSeq))) {
        const screen = await hub.readScreen('agent.read', { target: pane }, 'visible', 30).catch(() => null);
        const ch = screen && heldPrompt(String(screen.text || '').replace(/\s+$/, ''));
        if (ch && ch.dialog) {
          hub.recheckAsk(pane);
          hub.refreshSoon();
          return send(res, 409, { error: 'dialog_open' });
        }
      }
      await herdr.call('agent.prompt', { target: pane, text });
      if (agent.agent === 'claude' && /^\s*\//.test(text)) hub.watchMenu(pane);
      hub.refreshSoon();
      return send(res, 200, { ok: true });
    }),
    route('POST', 'agents/:pane/keys/*', async (req, res, { params: { pane } }) => {
      // text: typed first without Enter, e.g. the answer after a "Type something" choice.
      // read: { lines, format }: the screen as the keys left it comes back too (READ_STEP_MS).
      const { keys, text = '', read = null } = await readJson(req);
      if (!validKeys(keys)) return send(res, 400, { error: 'bad_keys' });
      if (badText(text)) return send(res, 400, { error: 'bad_text' });
      const shape = read && typeof read === 'object' ? { lines: cleanLines(read.lines, 80), format: read.format === 'ansi' ? 'ansi' : 'text' } : null;
      const look = () => hub.readScreen('agent.read', { target: pane }, 'visible', shape.lines, shape.format);
      const before = shape ? await look().catch(() => null) : null;
      if (text) await herdr.call('pane.send_text', { pane_id: pane, text });
      await herdr.call('agent.send_keys', { target: pane, keys });
      hub.recheckAsk(pane);
      hub.refreshSoon();
      if (!shape) return send(res, 200, { ok: true });
      let screen = null;
      for (let i = 0; i < READ_TRIES; i++) {
        await sleep(READ_STEP_MS);
        screen = await look().catch(() => screen);
        if (screen && (!before || screen.text !== before.text)) break;
      }
      return send(res, 200, { ok: true, ...(screen ? { screen } : {}) });
    }),
    // 지금 보내기: Claude Code's chat:sendNow on what it holds queued (prompts sent while it
    // works). Ctrl+X Ctrl+S, not Ctrl+Enter, which a terminal without extended keys turns into
    // a plain Enter. With nothing queued Claude Code leaves the turn alone (2.1.318). Only while
    // it works: once it is idle the queue has gone out already.
    route('POST', 'agents/:pane/sendnow/*', async (req, res, { params: { pane }, agent }) => {
      if (agent.agent !== 'claude') return send(res, 400, { error: 'not_claude' });
      if (agent.status !== 'working') return send(res, 200, { ok: true, sent: false });
      await herdr.call('agent.send_keys', { target: pane, keys: ['ctrl+x', 'ctrl+s'] });
      hub.refreshSoon();
      return send(res, 200, { ok: true, sent: true });
    }),
    // 대기 중 취소 { text }: that prompt out of Claude Code's queue, the turn left running
    // (lib/claudequeue.js has how). Nothing is pressed unless the transcript says it is queued and
    // the input is empty; once ↑ has pulled the queue back, the input must hold just what the
    // transcript says it pulled before Ctrl+U clears it, and the rest is sent again. 409 not_queued:
    // not in the queue (taken already, or the bubble outlived it; nothing pressed); input_busy:
    // something is typed in Claude Code's input; images_queued: another queued prompt has a photo
    // that sending its words again would lose; unsure: the queue came back into the input but could
    // not be put right, so it waits there (nothing lost, nothing sent).
    route('POST', 'agents/:pane/unqueue/*', async (req, res, { params: { pane } }) => {
      const { text } = await readJson(req);
      if (typeof text !== 'string' || !text.trim()) return send(res, 400, { error: 'empty_text' });
      await hub.refresh(); // the last refresh may be seconds old: is it still at work?
      const agent = hub.findAgent(pane);
      if (!agent) return send(res, 404, { error: 'agent_not_found' });
      if (agent.agent !== 'claude') return send(res, 400, { error: 'not_claude' });
      if (agent.status !== 'working' || !agent.session) return send(res, 409, { error: 'not_queued' });
      // One at a time per agent: a second one would press ↑ on the first one's pulled-back queue.
      const mine = (unqueuing.get(pane) || Promise.resolve()).then(() => unqueue(pane, agent.session, text));
      const done = mine.catch(() => {});
      unqueuing.set(pane, done);
      done.then(() => unqueuing.get(pane) === done && unqueuing.delete(pane));
      const r = await mine;
      console.log(`${new Date().toISOString()} unqueue ${pane} -> ${r.status || 200}${r.error ? ` ${r.error}` : ` kept=${r.kept}`}`);
      hub.refreshSoon();
      return send(res, r.status || 200, r.error ? { error: r.error, ...(r.lost ? { lost: r.lost } : {}) } : { ok: true, kept: r.kept });
    }),
    // An answer from a notification button or a choice button in the app: sent only while the
    // agent is blocked on the same prompt (stateSeq, and the option's label when given) it was
    // shown for. own: the app's "Type something" pick.
    route('POST', 'agents/:pane/answer/*', async (req, res, { params: { pane } }) => {
      const body = await readJson(req);
      const r = await answerLocal(pane, body, { allowOwn: body.own === true });
      console.log(`${new Date().toISOString()} answer here ${pane} seq=${body.stateSeq} n=${body.n} -> ${r.status || 200}${r.error ? ` ${r.error}` : ''}`);
      return send(res, r.status || 200, answerBody(r));
    }),
    route('POST', 'agents/:pane/rename/*', async (req, res, { params: { pane } }) => {
      // Empty clears the name; herdr allows only lowercase names.
      const { name } = await readJson(req);
      if (name && (typeof name !== 'string' || !AGENT_NAME.test(name))) return send(res, 400, { error: 'bad_agent_name' });
      await herdr.call('agent.rename', { target: pane, name: name || null });
      await hub.refresh();
      return send(res, 200, { ok: true });
    }),

    // Notification action: { host, pane, stateSeq, n, label? } -> that host's /agents/<pane>/answer.
    route('POST', 'answer', async (req, res) => {
      const body = await readJson(req, 16 * 1024);
      const host = body.host || hub.HOST_ID;
      if (typeof body.pane !== 'string' || !body.pane) return send(res, 400, { error: 'pane_required' });
      const fwd = { stateSeq: body.stateSeq, n: body.n, label: body.label ?? null };
      let out;
      if (host === hub.HOST_ID) {
        const r = await answerLocal(body.pane, fwd);
        out = { status: r.status || 200, body: answerBody(r) };
      } else {
        const peer = hub.peers.get(host);
        if (!peer) return send(res, 404, { error: 'unknown_host' });
        if (!peer.online) return send(res, 503, { error: 'peer_offline' });
        const r = await peer.request('POST', `/api/agents/${encodeURIComponent(body.pane)}/answer`, { body: Buffer.from(JSON.stringify(fwd)), headers: { 'Content-Type': 'application/json', 'X-Herdr-Hub': '1' }, timeoutMs: 20000 });
        out = { status: r.status, body: r.body };
      }
      console.log(`${new Date().toISOString()} answer ${host} ${body.pane} seq=${body.stateSeq} n=${body.n} -> ${out.status}`);
      return send(res, out.status, out.body);
    }),
  ];
};
