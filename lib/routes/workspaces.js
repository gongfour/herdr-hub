'use strict';
// Workspaces: a new one (with an agent in it, optionally), and per workspace: rename, close, its
// 기본 폴더, a new tab or a new agent tab.
const path = require('path');
const { route, NEXT } = require('../router');
const { send, readJson } = require('../http');
const { cleanLabel, cleanCwd } = require('../validate');

module.exports = (hub) => {
  const { herdr } = hub;
  // The workspace's change done: a refresh, then { ok }.
  const done = async (res) => {
    await hub.refresh();
    return send(res, 200, { ok: true });
  };
  // New tab, optionally with an agent started in its root pane. cwd (optional, the same rules
  // as a new workspace): where the tab opens. Without it herdr opens it in the folder of the
  // workspace's active tab — a herdr workspace has no folder of its own.
  const newTab = (withAgent) => async (req, res, { ws, body }) => {
    const cwd = body.cwd == null || body.cwd === '' ? null : await cleanCwd(body.cwd);
    const spec = withAgent ? hub.cleanAgentSpec(body, [ws.label, cwd && path.basename(cwd)]) : null;
    const params = { workspace_id: ws.workspace_id, label: cleanLabel(body.label), focus: false };
    if (cwd) params.cwd = cwd;
    const r = await herdr.call('tab.create', params);
    const pane = r.root_pane.pane_id;
    if (spec) await hub.startAgent(pane, spec);
    await hub.refresh();
    return send(res, 200, { ok: true, pane });
  };

  return [
    route('POST', 'workspaces', async (req, res) => {
      const body = await readJson(req);
      const cwd = await cleanCwd(body.cwd);
      const label = cleanLabel(body.label);
      const spec = body.agent ? hub.cleanAgentSpec(body.agent, [label, path.basename(cwd)]) : null;
      const wsLabel = label || path.basename(cwd) || cwd;
      const r = await herdr.call('workspace.create', { cwd, label: wsLabel, focus: false });
      const pane = r.root_pane.pane_id;
      // Its folder becomes its 기본 폴더: where its next tabs open too, until changed.
      hub.setWsDir(r.workspace.workspace_id, cwd, r.workspace.label || wsLabel);
      let agentError = null;
      if (spec) await hub.startAgent(pane, spec).catch((err) => (agentError = err.message));
      await hub.refresh();
      return send(res, 200, { ok: true, workspace: r.workspace.workspace_id, pane, agent: spec && !agentError, agentError });
    }),

    // A workspace herdr listed at the last refresh; the body read before the action is known.
    route('POST', 'workspaces/:id/*', async (req, res, m) => {
      m.ws = hub.findWorkspace(m.params.id);
      if (!m.ws) return send(res, 404, { error: 'workspace_not_found' });
      m.body = await readJson(req);
      return NEXT;
    }),
    route('POST', 'workspaces/:id/rename/*', async (req, res, { ws, body }) => {
      await herdr.call('workspace.rename', { workspace_id: ws.workspace_id, label: cleanLabel(body.label, { required: true }) });
      return done(res);
    }),
    route('POST', 'workspaces/:id/close/*', async (req, res, { ws }) => {
      await herdr.call('workspace.close', { workspace_id: ws.workspace_id });
      return done(res);
    }),
    // Its 기본 폴더 (lib/wsdirs): { cwd } sets it (the same rules as a new workspace's folder),
    // empty or null clears it.
    route('POST', 'workspaces/:id/dir/*', async (req, res, { ws, body }) => {
      const cwd = body.cwd == null || body.cwd === '' ? null : await cleanCwd(body.cwd);
      await hub.setWsDir(ws.workspace_id, cwd, ws.label);
      return done(res);
    }),
    route('POST', 'workspaces/:id/tabs/*', newTab(false)),
    route('POST', 'workspaces/:id/agents/*', newTab(true)),
    route('POST', 'workspaces/:id/*', (req, res) => send(res, 404, { error: 'not_found' })),
  ];
};
