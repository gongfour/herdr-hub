'use strict';
// This host's own routes through the real server (fake herdr): a prompt, keys, closing a pane or
// a workspace, renaming. Each one reaches herdr with the pane or workspace it was asked for, and
// nothing reaches herdr when it is refused.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startHub } = require('./fixtures/hub');

const agent = (pane, status, seq, kind = 'claude') => ({ pane_id: pane, workspace_id: 'w1', agent: kind, agent_status: status, state_change_seq: seq, terminal_title: kind });
const callsOf = (herdr, method) => herdr.calls.filter((c) => c.method === method).map((c) => c.params);

test('POST /prompt: the text to that agent; empty, unknown or without the header: nothing sent', async (t) => {
  const hub = await startHub(t, { id: 'prompt', agents: [agent('w1-p2', 'idle', 1)] });
  for (const [p, body, h, status, error] of [
    ['/api/agents/w1-p2/prompt', { text: 'hi' }, { 'X-Herdr-Hub': null }, 403, 'missing_header'],
    ['/api/agents/w1-p2/prompt', { text: '   ' }, {}, 400, 'empty_prompt'],
    ['/api/agents/w1-p2/prompt', { text: 5 }, {}, 400, 'empty_prompt'],
    ['/api/agents/w1-p9/prompt', { text: 'hi' }, {}, 404, 'agent_not_found'],
    // A shell pane is not an agent.
    ['/api/agents/w1-p1/prompt', { text: 'hi' }, {}, 404, 'agent_not_found'],
  ]) {
    const r = await hub.request('POST', p, body, h);
    assert.equal(r.status, status, `${p} ${JSON.stringify(body)}`);
    assert.equal(r.body.error, error);
  }
  // A body that is not JSON.
  assert.equal((await hub.request('POST', '/api/agents/w1-p2/prompt', Buffer.from('{'))).status, 400);
  assert.deepEqual(callsOf(hub.herdr, 'agent.prompt'), []);
  const r = await hub.request('POST', '/api/agents/w1-p2/prompt', { text: '안녕\n두 줄' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.deepEqual(callsOf(hub.herdr, 'agent.prompt'), [{ target: 'w1-p2', text: '안녕\n두 줄' }]);
  // GET on it is not a prompt.
  assert.equal((await hub.request('GET', '/api/agents/w1-p2/prompt')).status, 404);
});

test('POST agent /keys and pane /input, /keys: checked keys to that pane', async (t) => {
  const hub = await startHub(t, { id: 'keys', agents: [agent('w1-p2', 'blocked', 1)] });
  const { herdr } = hub;
  assert.equal((await hub.request('POST', '/api/agents/w1-p2/keys', { keys: ['rm -rf'] })).body.error, 'bad_keys');
  assert.equal((await hub.request('POST', '/api/agents/w1-p2/keys', { keys: ['esc'], text: 5 })).body.error, 'bad_text');
  assert.deepEqual(callsOf(herdr, 'agent.send_keys'), []);
  assert.deepEqual((await hub.request('POST', '/api/agents/w1-p2/keys', { keys: ['esc'] })).body, { ok: true });
  assert.deepEqual(callsOf(herdr, 'agent.send_keys'), [{ target: 'w1-p2', keys: ['esc'] }]);

  // A shell pane: /input is the text then Enter.
  assert.equal((await hub.request('POST', '/api/panes/w1-p1/input', { text: 'ls' })).status, 200);
  assert.equal(herdr.shell.screen, '$ ls\n$ ');
  assert.equal((await hub.request('POST', '/api/panes/w1-p1/keys', { keys: ['bogus'] })).body.error, 'bad_keys');
  assert.equal((await hub.request('POST', '/api/panes/w1-p1/keys', { text: 'a\u0000' , keys: [] })).body.error, 'bad_text');
  // An agent pane is not a shell pane for keys.
  assert.equal((await hub.request('POST', '/api/panes/w1-p2/keys', { keys: ['enter'] })).body.error, 'pane_not_found');
  assert.equal((await hub.request('POST', '/api/panes/w1-p1/keys', { text: 'x', keys: [] })).status, 200);
  assert.equal(herdr.shell.screen, '$ ls\n$ x');
});

test('closing: a shell pane, an agent pane, a workspace — that one only; unknown ones are 404', async (t) => {
  const hub = await startHub(t, { id: 'close', agents: [agent('w1-p2', 'idle', 1)] });
  const { herdr } = hub;
  herdr.workspaces.push({ workspace_id: 'w2', label: 'other' });
  herdr.event();
  for (const [p, status, error] of [
    ['/api/panes/w1-p9/close', 404, 'pane_not_found'],
    ['/api/workspaces/w9/close', 404, 'workspace_not_found'],
    ['/api/workspaces/w1/bogus', 404, 'not_found'],
    ['/api/panes/w1-p1/bogus', 404, 'not_found'],
  ]) {
    const r = await hub.request('POST', p, {});
    assert.equal(r.status, status, p);
    assert.equal(r.body.error, error, p);
  }
  assert.equal((await hub.request('POST', '/api/panes/w1-p1/close', {}, { 'X-Herdr-Hub': null })).status, 403);
  assert.deepEqual(callsOf(herdr, 'pane.close'), []);
  assert.deepEqual(callsOf(herdr, 'workspace.close'), []);

  assert.deepEqual((await hub.request('POST', '/api/panes/w1-p1/close', {})).body, { ok: true });
  assert.deepEqual((await hub.request('POST', '/api/panes/w1-p2/close', {})).body, { ok: true });
  assert.deepEqual(callsOf(herdr, 'pane.close'), [{ pane_id: 'w1-p1' }, { pane_id: 'w1-p2' }]);
  // An agent pane closes, but takes no shell routes.
  assert.equal((await hub.request('POST', '/api/panes/w1-p2/rename', { label: 'x' })).body.error, 'pane_not_found');

  // The workspace list has w2 once a refresh ran (the close above refreshed).
  const r = await hub.request('POST', '/api/workspaces/w2/close', {});
  assert.deepEqual(r.body, { ok: true }, r.text);
  assert.deepEqual(callsOf(herdr, 'workspace.close'), [{ workspace_id: 'w2' }]);
  assert.deepEqual((await hub.request('POST', '/api/workspaces/w1/rename', { label: '새 이름' })).body, { ok: true });
  assert.deepEqual(callsOf(herdr, 'workspace.rename'), [{ workspace_id: 'w1', label: '새 이름' }]);
  assert.equal((await hub.request('POST', '/api/workspaces/w1/rename', { label: '' })).status, 400);
  assert.deepEqual((await hub.request('POST', '/api/agents/w1-p2/rename', { name: 'Bad Name' })).body, { error: 'bad_agent_name' });
  assert.deepEqual(callsOf(herdr, 'agent.rename'), []);
});

test('the router: methods, unknown paths, a broken %-escape', async (t) => {
  const hub = await startHub(t, { id: 'router', agents: [agent('w1-p2', 'idle', 1)] });
  for (const [m, p, status, error] of [
    ['GET', '/api/nope', 404, 'not_found'],
    ['GET', '/api', 404, null],
    ['POST', '/api/state', 404, 'not_found'],
    ['DELETE', '/api/agents/w1-p2/prompt', 404, 'not_found'],
    ['GET', '/api/agents/%E0%A4%A/screen', 400, 'bad_path'],
    ['GET', '/api/agents/w1-p2/bogus', 404, 'not_found'],
    ['GET', '/api/version/x', 404, 'not_found'],
    ['GET', '/api/hosts/x', 404, 'not_found'],
    ['POST', '/nope', 405, 'method_not_allowed'],
    ['GET', '/api/push/key', 200, 'push_disabled'],
    ['POST', '/api/push/subscribe', 409, 'push_disabled'],
  ]) {
    const r = await hub.request(m, p, m === 'GET' ? null : {});
    assert.equal(r.status, status, `${m} ${p} ${r.text}`);
    if (error) assert.equal(r.body && r.body.error, error, `${m} ${p}`);
  }
  const s = await hub.request('GET', '/api/state');
  assert.equal(s.body.hostId, 'router');
  assert.equal(s.body.agents[0].pane, 'w1-p2');
  const h = await hub.request('GET', '/api/host');
  assert.equal(h.body.id, 'router');
  assert.equal(typeof h.body.api, 'number');
  const v = await hub.request('GET', '/api/version');
  assert.equal(v.body.api, h.body.api);
  assert.deepEqual((await hub.request('GET', '/api/hosts')).body.peers, []);
});
