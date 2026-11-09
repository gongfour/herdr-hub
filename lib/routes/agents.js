'use strict';
// Agents on this host: the screen, the composer's "/" and "@" lists, the transcript, a prompt,
// keys, 지금 보내기, an answer to its prompt, rename. And POST /api/answer, a notification's
// button: answered here, or passed to the peer the agent is on.
const commands = require('../commands');
const transcript = require('../transcript');
const notifyLib = require('../notify');
const { parseChoices, choicesSig, heldPrompt } = require('../../public/choices');
const { route, NEXT } = require('../router');
const { send, readJson } = require('../http');
const { AGENT_NAME, validKeys, badText, cleanLines } = require('../validate');

const ANSWER_HOLD_MS = 5000;
// What an answer request gets back (here, or through the hub from a notification button).
const answerBody = (r) => (r.ok ? { ok: true, n: r.item.n, label: r.item.label } : { error: r.error });

module.exports = (hub) => {
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
    // Drawn just before herdr misread the prompt's last screen as idle (lib/hub.js holdAsk): the same prompt.
    const ah = hub.askHeld.get(pane);
    if (agent && ah && agent.stateSeq === ah.seq && stateSeq === ah.from) stateSeq = ah.seq;
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
    const r = notifyLib.checkAnswer({ agent, stateSeq, n, label, choices, allowOwn });
    if (!r.ok) return r;
    // Checked again after the reads above, and claimed before the keys go: a request that arrived
    // meanwhile is refused.
    if (held()) return { status: 409, error: 'answered' };
    const claim = { seq: stateSeq, sig, at: hub.now() };
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
    // A Claude agent showing a select dialog herdr calls idle or working (lib/hub.js holdAsk) would
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
      hub.refreshSoon();
      return send(res, 200, { ok: true });
    }),
    route('POST', 'agents/:pane/keys/*', async (req, res, { params: { pane } }) => {
      // text: typed first without Enter, e.g. the answer after a "Type something" choice.
      const { keys, text = '' } = await readJson(req);
      if (!validKeys(keys)) return send(res, 400, { error: 'bad_keys' });
      if (badText(text)) return send(res, 400, { error: 'bad_text' });
      if (text) await herdr.call('pane.send_text', { pane_id: pane, text });
      await herdr.call('agent.send_keys', { target: pane, keys });
      hub.recheckAsk(pane);
      hub.refreshSoon();
      return send(res, 200, { ok: true });
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
