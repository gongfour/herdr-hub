'use strict';
// A stand-in herdr API socket for server tests: one workspace, no agents, newline-delimited JSON
// like the real one. Every request is kept in `calls`; events.subscribe stays open and quiet.
const net = require('net');

function fakeHerdr(socketPath) {
  const calls = [];
  let tabs = 0;
  // The shell pane's screen: what pane.read gives; typed text lands on its last line.
  const shell = { screen: '$ ' };
  const answer = (method, params) => {
    switch (method) {
      case 'agent.list':
        return { agents: [] };
      case 'workspace.list':
        return { workspaces: [{ workspace_id: 'w1', label: 'proj' }] };
      case 'pane.list':
        return { panes: [{ pane_id: 'w1-p1', workspace_id: 'w1', tab_id: 't1', cwd: '/', terminal_title: 'zsh' }] };
      case 'tab.create':
        tabs++;
        return { tab: { tab_id: `t${tabs + 1}` }, root_pane: { pane_id: `w1-p${tabs + 1}` } };
      case 'agent.start':
        return { ok: true };
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
      if (msg.method === 'events.subscribe') return conn.write(JSON.stringify({ id: msg.id, result: { ok: true } }) + '\n');
      conn.end(JSON.stringify({ id: msg.id, result: answer(msg.method, msg.params) }) + '\n');
    });
  });
  return new Promise((resolve) => server.listen(socketPath, () => resolve({ calls, shell, close: () => server.close() })));
}

module.exports = { fakeHerdr };
