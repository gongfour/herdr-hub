'use strict';
// Keys to a shell pane and its screen back, the same for POST /api/panes/<id>/keys and the live
// channel (lib/routes/panes.js, lib/routes/live.js), with the workarounds for a herdr that holds
// calls (the ping before a key, keep-awake, hedged reads).
const echo = require('./echo');
const awake = require('./awake');
const { hedge } = require('./live');

// Keys herdr has no name for (0.9: "unsupported key"): their xterm sequences, typed as text.
const SEQ_KEYS = { pageup: '\x1b[5~', pagedown: '\x1b[6~', home: '\x1b[H', end: '\x1b[F', delete: '\x1b[3~', insert: '\x1b[2~' };
// herdr on the Mac holds ~half of the key calls that go the Node way ~105 ms, but almost never one
// that comes 3 ms after another call (measured: 13–15/30 → 2–3/30; one sent at the same moment is
// always held). So on a host whose herdr is kept awake (HERDR_HUB_AWAKE_MS, off on desktop) a ping
// goes first — unless the connect helper carries the calls (lib/herdr), which herdr never holds.
const PRIME_MS = 3;

function paneIO({ herdr, readScreen, env = process.env }) {
  async function sendPaneKeys(pane, keys) {
    let run = [];
    const flush = async () => {
      if (run.length) await herdr.call('pane.send_keys', { pane_id: pane, keys: run });
      run = [];
    };
    for (const k of keys) {
      if (SEQ_KEYS[k]) {
        await flush();
        await herdr.call('pane.send_text', { pane_id: pane, text: SEQ_KEYS[k] });
      } else run.push(k);
    }
    await flush();
  }
  // Text, then keys: one herdr call (pane.send_input) when every key has a herdr name, else as above.
  let sendInputOk = true;
  // herdr may hold this call: it goes the Node way (lib/herdr: the connect helper is off, or not up).
  // The workarounds below (the ping before a key, keep-awake, hedged reads) are for that case only.
  const herdrHolds = () => !herdr.direct();
  const maybeHedge = (fn) => (herdrHolds() ? hedge(fn) : fn());
  const awakeMs = awake.intervalFromEnv(env.HERDR_HUB_AWAKE_MS);
  async function primeHerdr() {
    if (!herdrHolds() || !(awakeMs > 0)) return;
    herdr.call('ping', {}, { timeoutMs: 2000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, PRIME_MS));
  }
  // herdr's pane.wait_for_output for the echo (lib/echo): true when the pattern is on screen. It
  // ends here at ms whatever herdr does: herdr 0.9.3 answers a 40 ms timeout after ~105–210 ms.
  // hedged: sent again when herdr holds it (lib/live hedge), as the live channel does.
  function waitOutput(pane, lines, pattern, ms, { hedged = false, info = null } = {}) {
    const call = () => herdr.call('pane.wait_for_output', { pane_id: pane, source: 'recent_unwrapped', lines, match: { type: 'regex', value: pattern }, timeout_ms: ms });
    let timer;
    return Promise.race([
      (hedged ? maybeHedge(call) : call()).then(
        () => true,
        (err) => {
          if (info) info.werr = err.code;
          return false;
        }
      ),
      new Promise((r) => (timer = setTimeout(() => r(false), ms))),
    ]).finally(() => clearTimeout(timer));
  }

  // info (optional): the live channel's trace of this call (lib/live), the ping's wait in ms.
  async function sendPaneInput(pane, text, keys, info) {
    const t0 = performance.now();
    await primeHerdr();
    if (info) info.prime = performance.now() - t0;
    if (text && keys.length && sendInputOk && !keys.some((k) => SEQ_KEYS[k])) {
      try {
        return await herdr.call('pane.send_input', { pane_id: pane, text, keys });
      } catch (err) {
        if (!(err.code === 'invalid_request' && /unknown variant/.test(err.message))) throw err;
        sendInputOk = false; // a herdr without it: two calls from now on
      }
    }
    if (text) await herdr.call('pane.send_text', { pane_id: pane, text });
    if (keys.length) await sendPaneKeys(pane, keys);
  }

  // herdr kept awake while a shell here is in use (lib/awake): keys and the shell view's reads touch it.
  // Requests proxied from the hub land here too, so each host keeps its own herdr awake.
  const herdrAwake = awake.keepAwake({ ping: () => herdr.call('ping', {}, { timeoutMs: 2000 }), intervalMs: awakeMs });
  const touchAwake = () => herdrHolds() && herdrAwake.touch();

  // The last screen read per shell pane (lib/echo): what a key's echo is compared against.
  const paneScreens = echo.lastScreens();
  async function readPane(pane, source, lines, format) {
    const screen = await readScreen('pane.read', { pane_id: pane }, source, lines, format);
    paneScreens.set(pane, { source, format, lines }, screen);
    return screen;
  }

  return { sendPaneInput, waitOutput, readPane, paneScreens, touchAwake, maybeHedge, herdrAwake };
}

module.exports = { paneIO, SEQ_KEYS };
