'use strict';
// Plain shell panes: the screen, a command line, keys (with the echo back), rename, split, an agent
// started in it, close. Close works on any pane, agent or not.
const path = require('path');
const echo = require('../echo');
const { route, NEXT } = require('../router');
const { send, readJson } = require('../http');
const { PANE_KEYS, validKeys, badText, cleanLines, cleanLabel } = require('../validate');

module.exports = (hub) => {
  const { herdr, io } = hub;
  // The change done: a refresh, then the result.
  const done = async (res, result = { ok: true }) => {
    await hub.refresh();
    return send(res, 200, result);
  };

  // input: one command line, the text then Enter (empty text just presses Enter).
  // keys: optional text typed first without Enter, so "Get-Ch" + tab completes.
  const typed = (kind) => async (req, res, { params: { pane }, body }) => {
    io.touchAwake();
    const { text = '' } = body;
    const keys = kind === 'input' ? ['enter'] : body.keys;
    if (badText(text)) return send(res, 400, { error: 'bad_text' });
    // keys may be empty when there is text: raw mode typing one character at a time.
    const textOnly = kind === 'keys' && text && Array.isArray(keys) && keys.length === 0;
    if (!textOnly && !validKeys(keys, PANE_KEYS)) return send(res, 400, { error: 'bad_keys' });
    await io.sendPaneInput(pane, text, textOnly ? [] : keys);
    if (kind === 'input') return done(res);
    // Typing changes no state the views show: no refresh or broadcast per key (the
    // regular one and herdr's events cover the rest), one shortly after an Enter.
    if (!textOnly && keys.includes('enter')) hub.refreshAfterKeys();
    // 키 직접 입력 asks for the screen back ({ echo: { format } }): the echo arrives with
    // the reply instead of a second request (two hops when the pane is on a peer), as
    // soon as it is on screen (lib/echo). lines: as many as the page reads (200 for a
    // page from before it said, 400 at most).
    if (!body.echo || typeof body.echo !== 'object') return send(res, 200, { ok: true });
    const lines = cleanLines(body.echo.lines, 200);
    const shape = { source: 'recent_unwrapped', format: body.echo.format, lines };
    const { screen } = await echo.waitEcho(
      {
        waitFor: (pattern, ms) => io.waitOutput(pane, lines, pattern, ms),
        read: () => io.readPane(pane, shape.source, lines, shape.format),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        now: () => performance.now(),
      },
      { text: textOnly || !keys.length ? text : '', before: io.paneScreens.get(pane, shape) }
    );
    return send(res, 200, { ok: true, screen });
  };

  return [
    // A shell pane herdr listed at the last refresh (an agent's pane only to close it).
    route('*', 'panes/:pane/*', (req, res, m) => {
      const { pane } = m.params;
      m.term = hub.findTerminal(pane);
      if (!m.term && !(m.parts[2] === 'close' && hub.findAgent(pane))) return send(res, 404, { error: 'pane_not_found' });
      return NEXT;
    }),
    route('GET', 'panes/:pane/screen/*', async (req, res, { params: { pane }, url }) => {
      io.touchAwake();
      const lines = cleanLines(url.searchParams.get('lines'), 120);
      return send(res, 200, await io.readPane(pane, url.searchParams.get('source'), lines, url.searchParams.get('format')));
    }),
    // Every POST reads its body before the action is known.
    route('POST', 'panes/:pane/*', async (req, res, m) => {
      m.body = await readJson(req);
      return NEXT;
    }),
    route('POST', 'panes/:pane/input/*', typed('input')),
    route('POST', 'panes/:pane/keys/*', typed('keys')),
    route('POST', 'panes/:pane/rename/*', async (req, res, { params: { pane }, body }) => {
      await herdr.call('pane.rename', { pane_id: pane, label: cleanLabel(body.label) });
      return done(res);
    }),
    route('POST', 'panes/:pane/split/*', async (req, res, { params: { pane }, body }) => {
      const direction = body.direction === 'right' ? 'right' : 'down';
      const r = await herdr.call('pane.split', { target_pane_id: pane, direction, focus: false });
      return done(res, { ok: true, pane: r.pane.pane_id });
    }),
    route('POST', 'panes/:pane/agent/*', async (req, res, { params: { pane }, body, term }) => {
      await hub.startAgent(pane, hub.cleanAgentSpec(body, [term.workspaceLabel, path.basename(term.cwd || '')]));
      return done(res);
    }),
    route('POST', 'panes/:pane/close/*', async (req, res, { params: { pane } }) => {
      await herdr.call('pane.close', { pane_id: pane });
      io.paneScreens.drop(pane);
      return done(res);
    }),
    route('POST', 'panes/:pane/*', (req, res) => send(res, 404, { error: 'not_found' })),
  ];
};
