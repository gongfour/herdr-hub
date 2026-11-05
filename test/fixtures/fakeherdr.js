'use strict';
// A stand-in herdr API socket for server tests: one workspace, no agents, newline-delimited JSON
// like the real one. Every request is kept in `calls`; events.subscribe stays open and quiet.
// `workspaces` is the list herdr gives (a test may change it); workspace.create adds one.
// `agents`: what agent.list gives (none unless a test adds one).
// `hold`: method -> ms; the next call of that method is answered with what was true when it came,
// but that much later (a slow read that ends after a newer one). Used once, then removed.
// `screens`: pane -> text that agent.read gives for it (an agent's prompt on screen).
// `fail`: method -> { code, message }: that method answers with this herdr error (until removed).
// `event()`: an event on every open events.subscribe stream (the hub refreshes soon after).
const net = require('net');

function fakeHerdr(socketPath) {
  const calls = [];
  const workspaces = [{ workspace_id: 'w1', label: 'proj' }];
  const agents = [];
  let tabs = 0;
  // The shell pane's screen: what pane.read gives; typed text lands on its last line.
  const shell = { screen: '$ ' };
  const hold = {};
  const screens = {};
  const fail = {};
  const subs = new Set();
  const answer = (method, params) => {
    switch (method) {
      case 'agent.list':
        return { agents: agents.map((a) => ({ ...a })) };
      case 'workspace.list':
        return { workspaces: workspaces.map((w) => ({ ...w })) };
      case 'workspace.create': {
        const w = { workspace_id: `w${workspaces.length + 1}`, label: params.label };
        workspaces.push(w);
        return { workspace: w, root_pane: { pane_id: `${w.workspace_id}-p1` } };
      }
      case 'pane.list':
        return { panes: [{ pane_id: 'w1-p1', workspace_id: 'w1', tab_id: 't1', cwd: '/', terminal_title: 'zsh' }] };
      case 'tab.create':
        tabs++;
        return { tab: { tab_id: `t${tabs + 1}` }, root_pane: { pane_id: `w1-p${tabs + 1}` } };
      case 'agent.start':
        return { ok: true };
      case 'agent.read':
        return { read: { text: screens[params.target] || '', truncated: false, format: 'text' } };
      case 'pane.read':
        return { read: { text: shell.screen, truncated: false, format: params.format === 'ansi' ? 'ansi' : 'text' } };
      case 'pane.send_text':
      case 'pane.send_input':
        shell.screen += params.text || '';
        if ((params.keys || []).includes('enter')) shell.screen += '\n$ ';
        return {};
      case 'pane.send_keys':
        if (params.keys.includes('enter')) shell.screen += '\n$ ';
        return {};
      default:
        return {};
    }
  };
  const server = net.createServer((conn) => {
    let buf = '';
    conn.setEncoding('utf8');
    conn.on('error', () => {});
    conn.on('data', (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      const msg = JSON.parse(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      calls.push({ method: msg.method, params: msg.params });
      if (msg.method === 'events.subscribe') {
        subs.add(conn);
        conn.on('close', () => subs.delete(conn));
        return conn.write(JSON.stringify({ id: msg.id, result: { ok: true } }) + '\n');
      }
      const line = fail[msg.method]
        ? JSON.stringify({ id: msg.id, error: fail[msg.method] }) + '\n'
        : JSON.stringify({ id: msg.id, result: answer(msg.method, msg.params) }) + '\n';
      const ms = hold[msg.method];
      if (ms == null) return conn.end(line);
      delete hold[msg.method];
      setTimeout(() => conn.end(line), ms);
    });
  });
  const event = (type = 'pane.updated') => {
    for (const c of subs) c.write(JSON.stringify({ event: type, data: {} }) + '\n');
  };
  const close = () => {
    for (const c of subs) c.destroy();
    server.close();
  };
  return new Promise((resolve) => server.listen(socketPath, () => resolve({ calls, shell, workspaces, agents, hold, screens, fail, event, close })));
}

module.exports = { fakeHerdr };
