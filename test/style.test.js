'use strict';
// public/style.css keeps to its scales (AGENTS.md 여백): every font size is a --fs-* step.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
const lines = css.split('\n');

test('font sizes come from the --fs-* scale, not px written in place', () => {
  const bad = [];
  lines.forEach((l, i) => {
    if (/^\s*--fs-\d+:/.test(l)) return; // the scale itself
    if (/font-size:\s*\d+(\.\d+)?px/.test(l) || /font:\s*(\d00\s+)?\d+(\.\d+)?px/.test(l)) bad.push(`${i + 1}: ${l.trim().slice(0, 100)}`);
  });
  assert.deepEqual(bad, []);
  // Each step is used, and nothing asks for a step that isn't there.
  const steps = new Set([...css.matchAll(/^\s*(--fs-\d+):/gm)].map((m) => m[1]));
  for (const [, used] of css.matchAll(/var\((--fs-\d+)\)/g)) assert.ok(steps.has(used), used);
});
