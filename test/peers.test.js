'use strict';
// A peer that goes offline keeps its last state as a ghost (lib/peers.js): listed greyed "as of"
// when it was last heard, never counted or acted on as live, replaced by the live state when back,
// and kept across a hub restart (dumpGhosts / loadGhosts).
const test = require('node:test');
const assert = require('node:assert');
const { Peer, staleView, dumpGhosts, loadGhosts } = require('../lib/peers');

const quiet = (fn) => {
  const log = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
  }
};
const frame = (p, s) => quiet(() => p.frame(`event: state\ndata: ${JSON.stringify(s)}`));
const peerState = {
  hostId: 'server',
  hostLabel: 'server',
  herdr: 'up',
  agents: [
    { pane: 'p1', status: 'working', workspace: 'w1', workingSince: 100 },
    { pane: 'p2', status: 'blocked', workspace: 'w1', stateSeq: 4 },
    { pane: 'px', status: 'idle', host: 'other' }, // not its own: dropped
  ],
  terminals: [{ pane: 'p3', workspace: 'w1' }],
  workspaces: [{ workspace_id: 'w1', label: 'hub' }],
};

test('staleView: every item carries when, and an agent is stale with its last status kept', () => {
  const v = staleView({ herdr: 'up', agents: [{ pane: 'p1', status: 'blocked', doneAt: 5 }], terminals: [{ pane: 't' }], workspaces: [{ workspace_id: 'w' }] }, 1234);
  assert.deepEqual(v.agents, [{ pane: 'p1', status: 'stale', lastStatus: 'blocked', doneAt: 5, stale: 1234 }]);
  assert.deepEqual(v.terminals, [{ pane: 't', stale: 1234 }]);
  assert.deepEqual(v.workspaces, [{ workspace_id: 'w', stale: 1234 }]);
  assert.equal(v.herdr, 'up');
});

test('offline keeps the last state as a ghost; back online the live state replaces it', () => {
  const p = new Peer({ id: 'server', url: 'http://127.0.0.1:1' });
  try {
    assert.equal(p.view(), null, 'never heard: nothing listed');
    frame(p, peerState);
    assert.equal(p.online, true);
    assert.deepEqual(p.view().agents.map((a) => a.pane), ['p1', 'p2']);
    assert.equal(p.view().agents[0].status, 'working');
    assert.equal(p.info().staleAt, null);
    const at = p.stateAt;
    assert.ok(at > 0);

    quiet(() => p.setOnline(false, 'stream idle'));
    assert.equal(p.online, false);
    const v = p.view();
    assert.deepEqual(v.agents.map((a) => [a.pane, a.status, a.lastStatus, a.stale]), [
      ['p1', 'stale', 'working', at],
      ['p2', 'stale', 'blocked', at],
    ]);
    assert.ok(v.agents.every((a) => a.status !== 'blocked' && a.status !== 'working'), 'no live status: nothing counts it');
    assert.equal(v.workspaces[0].stale, at);
    assert.equal(p.info().staleAt, at);
    assert.equal(p.info().online, false);
    assert.equal(p.info().herdr, 'offline');
    assert.equal(p.state.agents[0].status, 'working', 'the kept state itself is untouched');

    frame(p, { ...peerState, agents: [{ pane: 'p1', status: 'done', workspace: 'w1' }] });
    assert.equal(p.online, true);
    assert.deepEqual(p.view().agents, [{ pane: 'p1', status: 'done', workspace: 'w1' }]);
    assert.equal(p.info().staleAt, null);
  } finally {
    p.stop();
  }
});

test('ghosts outlive a restart: dumped, loaded for the same peer and address, not too old', () => {
  const p = new Peer({ id: 'server', url: 'http://127.0.0.1:1' });
  frame(p, peerState);
  const data = JSON.parse(JSON.stringify(dumpGhosts([p])));
  p.stop();
  const at = data.server.at;

  const back = new Peer({ id: 'server', url: 'http://127.0.0.1:1' });
  const moved = new Peer({ id: 'laptop', url: 'http://127.0.0.1:2' });
  try {
    assert.equal(loadGhosts({ ...data, laptop: { ...data.server, url: 'http://127.0.0.1:9' } }, [back, moved], at + 1000), 1);
    assert.equal(back.online, false);
    assert.equal(back.since, at);
    assert.deepEqual(back.view().agents.map((a) => [a.pane, a.status, a.stale]), [
      ['p1', 'stale', at],
      ['p2', 'stale', at],
    ]);
    assert.equal(back.info().staleAt, at);
    assert.equal(moved.view(), null, 'another address: not its ghost');

    const old = new Peer({ id: 'server', url: 'http://127.0.0.1:1' });
    assert.equal(loadGhosts(data, [old], at + 4 * 86400e3), 0, 'older than three days: gone');
    old.stop();

    // A live state that came first is never overwritten by a ghost.
    const live = new Peer({ id: 'server', url: 'http://127.0.0.1:1' });
    frame(live, { ...peerState, agents: [] });
    loadGhosts(data, [live], at + 1000);
    assert.deepEqual(live.view().agents, []);
    live.stop();

    assert.equal(loadGhosts(null, [back], at), 0);
    assert.equal(loadGhosts({ server: { at, url: 'http://127.0.0.1:1', state: { agents: 'x' } } }, [moved], at), 0);
  } finally {
    back.stop();
    moved.stop();
  }
});

test('a ping keeps the ghost\'s time current: "as of" is when the peer was last heard', async () => {
  const http = require('http');
  let res = null;
  const srv = http.createServer((req, r) => {
    res = r;
    r.writeHead(200, { 'Content-Type': 'text/event-stream' });
    r.write(`event: state\ndata: ${JSON.stringify(peerState)}\n\n`);
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const p = new Peer({ id: 'server', url: `http://127.0.0.1:${srv.address().port}` });
  const until = async (fn) => {
    for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(fn());
  };
  try {
    quiet(() => p.start());
    await until(() => p.online);
    const first = p.stateAt;
    await new Promise((r) => setTimeout(r, 30));
    res.write(`event: ping\ndata: ${Date.now()}\n\n`);
    await until(() => p.stateAt > first);
    assert.equal(p.state.agents.length, 2, 'a ping changes only the time');
  } finally {
    p.stop();
    if (res) res.destroy();
    srv.close();
  }
});
