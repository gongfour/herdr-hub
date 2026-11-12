'use strict';
// public/gitgraph.js: lanes, folding, the SVG of a row, the view's columns.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../public/gitgraph');

const c = (h, ...p) => ({ h, p });
const pick = (rows) => rows.map((r) => [r.h, r.col, r.up, r.down, r.pass]);

test('a straight line stays in lane 0', () => {
  const rows = G.layout([c('c', 'b'), c('b', 'a'), c('a')]);
  assert.deepEqual(pick(rows), [
    ['c', 0, [], [0], []],
    ['b', 0, [0], [0], []],
    ['a', 0, [0], [], []],
  ]);
});

test('a branch off and a merge back', () => {
  // m merges f into b; f and b both come from a.
  const rows = G.layout([c('m', 'b', 'f'), c('f', 'a'), c('b', 'a'), c('a')]);
  assert.deepEqual(pick(rows), [
    ['m', 0, [], [0, 1], []],
    ['f', 1, [1], [1], [0]],
    // b's own lane goes on to a; the lane awaiting a (from f) passes by it.
    ['b', 0, [0], [1], [1]],
    ['a', 1, [1], [], []],
  ]);
  // Two lanes meet in a: b joined f's lane, so a is reached from lane 1 alone.
  assert.equal(rows[0].width, 2);
});

test('two heads, a lane freed is used again', () => {
  const rows = G.layout([c('x', 'a'), c('y', 'b'), c('b', 'a'), c('a'), c('z')]);
  assert.deepEqual(rows.map((r) => r.col), [0, 1, 1, 0, 0]);
});

test('an octopus merge opens a lane for each parent past the first', () => {
  const rows = G.layout([c('o', 'a', 'b', 'd'), c('d'), c('b'), c('a')]);
  assert.deepEqual(rows[0].down, [0, 1, 2]);
  assert.deepEqual(rows.slice(1).map((r) => r.col), [2, 1, 0]);
});

test('a parent outside the window: the lane runs off the bottom', () => {
  const rows = G.layout([c('b', 'a')]);
  assert.deepEqual(rows[0].down, [0]);
});

test('a lane started at a named commit takes the name colour, every time', () => {
  const one = G.layout([c('t', 'x')], { t: ['feat/git'] });
  const two = G.layout([c('n', 'm'), c('t', 'x')], { t: ['feat/git'] });
  assert.equal(one[0].color[0], two[1].color[1]);
});

test('fold: a straight run of FOLD_MIN or more is one row, keyed by its oldest commit', () => {
  assert.equal(G.FOLD_MIN, 4);
  const commits = [c('h', 'g'), c('g', 'f'), c('f', 'e'), c('e', 'd'), c('d', 'b'), c('b')];
  const rows = G.layout(commits);
  const refs = { h: ['main'] };
  const f = G.fold(rows, commits, { refs });
  assert.deepEqual(f.map((r) => (r.fold ? `fold ${r.n} ${r.key} ${r.from}` : r.h)), ['h', 'fold 4 d g', 'b']);
  assert.deepEqual(f[1].pass, [0]);
  assert.equal(f[1].col, 0);
  // Open: all of it.
  assert.deepEqual(G.fold(rows, commits, { refs, expanded: new Set(['d']) }).map((r) => r.h), ['h', 'g', 'f', 'e', 'd', 'b']);
  // The commit the address names is never folded away (what is left is too short to fold).
  assert.deepEqual(G.fold(rows, commits, { refs, keep: 'f' }).map((r) => (r.fold ? 'fold' : r.h)), ['h', 'g', 'f', 'e', 'd', 'b']);
  // A named one splits the run.
  assert.deepEqual(G.fold(rows, commits, { refs: { h: ['main'], f: ['v1'] } }).map((r) => (r.fold ? 'fold' : r.h)), ['h', 'g', 'f', 'e', 'd', 'b']);
  // Three in a row stay three rows.
  const three = [c('h', 'g'), c('g', 'f'), c('f', 'e'), c('e', 'd'), c('d')];
  assert.equal(G.fold(G.layout(three), three, { refs }).some((r) => r.fold), false);
});

test('fold: merges and fork points stay; lanes going by a fold stay drawn', () => {
  // side branch s1..s3 off a, main m1 merges nothing: the run on the side lane folds while main's
  // lane passes it.
  const commits = [c('m', 'a'), c('s5', 's4'), c('s4', 's3'), c('s3', 's2'), c('s2', 's1'), c('s1', 'a'), c('a', 'r'), c('r')];
  const rows = G.layout(commits);
  const f = G.fold(rows, commits, { refs: { m: ['main'], s5: ['side'] } });
  const fr = f.find((r) => r.fold);
  assert.equal(fr.n, 4);
  assert.deepEqual(fr.pass, [0, 1]);
  assert.equal(fr.col, 1);
  assert.ok(f.some((r) => r.h === 'a')); // a has two children: a fork point
});

test('rowSvg: a dot, lines in and out, classes for colour; a fold row dashed', () => {
  const rows = G.layout([c('m', 'b', 'f'), c('f', 'a'), c('b', 'a'), c('a')]);
  const s = G.rowSvg(rows[0], { w: 10, hgt: 20 });
  assert.match(s, /^<svg class="gg" width="20" height="20"/);
  assert.match(s, /<circle cx="5" cy="10"/);
  assert.equal((s.match(/<path/g) || []).length, 2);
  // A fold row: only the run's own lane dashed, with dots on it; the lanes going by stay solid.
  const fs = G.rowSvg({ fold: true, col: 1, pass: [0, 1], color: {}, width: 2 });
  assert.equal((fs.match(/gg-fold/g) || []).length, 1);
  assert.match(fs, /M21 0V32" class="gg-l gg-c0 gg-fold"/);
  assert.equal((fs.match(/gg-dot/g) || []).length, 3);
  assert.doesNotMatch(fs, /gg-n/);
  // A worktree's HEAD: a bigger node, marked; uncommitted changes: a hollow node, a dotted line down.
  assert.match(G.rowSvg(rows[0], { head: true }), /r="5.5" class="gg-n gg-c\d gg-head"/);
  const wip = G.rowSvg({ wip: true, col: 1, to: 0, pass: [], color: {}, width: 2 });
  assert.match(wip, /gg-wipl/);
  assert.match(wip, /gg-n gg-wip/);
  // Past maxLanes the lines crowd into the last lane shown, the svg no wider.
  const wide = G.rowSvg({ col: 9, up: [9], down: [], pass: [0], color: {}, width: 10 }, { w: 10, maxLanes: 4 });
  assert.match(wide, /width="40"/);
});

test('cols: one, two or three by the view width', () => {
  assert.equal(G.cols(390), 1);
  assert.equal(G.cols(G.COLS_2), 2);
  assert.equal(G.cols(1000), 2);
  assert.equal(G.cols(G.COLS_3), 3);
});
