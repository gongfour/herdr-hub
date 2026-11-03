'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { track } = require('../lib/times');

const key = (a) => a.pane;
const step = (prev, list, now) => {
  const agents = list.map(([pane, status]) => ({ pane, status }));
  return { map: track(prev, agents, now, key), agents };
};

test('working start and done time from transitions', () => {
  let s = step(new Map(), [['p1', 'idle'], ['p2', 'working']], 1000);
  assert.deepEqual(s.agents.map((a) => [a.workingSince, a.doneAt]), [[null, null], [null, null]]); // p2: start unknown
  s = step(s.map, [['p1', 'working'], ['p2', 'working']], 2000);
  assert.equal(s.agents[0].workingSince, 2000);
  assert.equal(s.agents[1].workingSince, null);
  s = step(s.map, [['p1', 'working'], ['p2', 'done']], 3000);
  assert.equal(s.agents[0].workingSince, 2000); // unchanged while working
  assert.equal(s.agents[1].doneAt, 3000);
  s = step(s.map, [['p1', 'done'], ['p2', 'idle']], 9000);
  assert.deepEqual([s.agents[0].workingSince, s.agents[0].doneAt], [null, 9000]);
  assert.equal(s.agents[1].doneAt, 3000); // done -> idle keeps when it finished
  s = step(s.map, [['p2', 'working']], 10000);
  assert.equal(s.map.has('p1'), false); // gone agents are forgotten
  assert.deepEqual([s.agents[0].workingSince, s.agents[0].doneAt], [10000, 3000]);
});

test("a peer's own values pass through", () => {
  const agents = [{ pane: 'p1', status: 'working', workingSince: 500, doneAt: 100 }];
  track(new Map(), agents, 1000, key);
  assert.deepEqual([agents[0].workingSince, agents[0].doneAt], [500, 100]);
});

test('dump and load survive a restart, and old files are dropped', () => {
  const { dump, load } = require('../lib/times');
  let s = step(new Map(), [['p1', 'idle']], 1000);
  s = step(s.map, [['p1', 'working']], 2000);
  const file = JSON.parse(JSON.stringify(dump({ local: s.map }, 2000)));
  const back = load(file, ['local', 'merged'], 3000, 60e3);
  assert.equal(back.merged.size, 0);
  s = step(back.local, [['p1', 'working']], 4000);
  assert.equal(s.agents[0].workingSince, 2000); // kept across the restart
  assert.equal(load(file, ['local'], 2000 + 61e3, 60e3).local.size, 0);
  assert.equal(load(null, ['local'], 0, 1).local.size, 0);
});
