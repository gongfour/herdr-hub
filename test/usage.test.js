'use strict';
// 모델·컨텍스트·사용량: the status line script (lib/statusline.js), the host's reading of it and of
// the transcript (lib/usage.js), the words the page shows (public/usage.js), and the agent's
// `usage` in the state, a peer's carried through the hub. The status line JSON is the shape
// Claude Code 2.1.322 sent a throwaway session (2026-11-10).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const U = require('../lib/usage');
const SL = require('../lib/statusline');
const P = require('../public/usage.js');
const { startHub, until } = require('./fixtures/hub');

const SID = 'adf5e7c1-4312-4c52-853b-2c085d4bb5f5';
const NOW = Date.UTC(2026, 10, 10, 7, 0, 0); // 16:00 in Seoul
const statusJson = (o = {}) => ({
  session_id: SID,
  transcript_path: `/Users/x/.claude/projects/-x/${SID}.jsonl`,
  cwd: '/x',
  model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
  context_window: {
    total_input_tokens: 53032,
    total_output_tokens: 5,
    context_window_size: 1000000,
    current_usage: { input_tokens: 2, output_tokens: 5, cache_creation_input_tokens: 24497, cache_read_input_tokens: 28533 },
    used_percentage: 5,
    remaining_percentage: 95,
  },
  rate_limits: { five_hour: { used_percentage: 31, resets_at: NOW / 1000 + 3600 }, seven_day: { used_percentage: 11, resets_at: NOW / 1000 + 4 * 86400 } },
  exceeds_200k_tokens: false,
  version: '2.1.322',
  ...o,
});
const line = (o) => JSON.stringify(o);
const reply = (model, usage, ts, extra = {}) => line({ type: 'assistant', isSidechain: false, timestamp: new Date(ts).toISOString(), uuid: `u${ts}`, message: { id: `m${ts}`, role: 'assistant', model, usage, content: [{ type: 'text', text: 'ok' }] }, ...extra });
const USE = { input_tokens: 2, cache_creation_input_tokens: 502, cache_read_input_tokens: 249591, output_tokens: 895 };

test('statusline script: keeps the parts the Hub shows, by session, written whole; prints nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-'));
  const env = { CLAUDE_CONFIG_DIR: dir };
  assert.equal(SL.dir(env), path.join(dir, 'herdr-hub', 'statusline'));
  const file = SL.write(statusJson(), env, 1234);
  assert.equal(file, path.join(dir, 'herdr-hub', 'statusline', `${SID}.json`));
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(d.at, 1234);
  assert.deepEqual(Object.keys(d).sort(), ['at', 'context_window', 'exceeds_200k_tokens', 'model', 'rate_limits', 'session_id', 'version']);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), [`${SID}.json`]); // no tmp left behind
  // Not a session's JSON: nothing written. A session id that could leave the folder: refused.
  assert.equal(SL.write({}, env), null);
  assert.equal(SL.write({ session_id: '../../evil' }, env), null);
  // Run as Claude Code runs it: JSON on stdin, nothing on stdout, exit 0 even for garbage.
  const run = (input) => spawnSync(process.execPath, [path.join(__dirname, '..', 'lib', 'statusline.js')], { input, env: { ...process.env, CLAUDE_CONFIG_DIR: dir } });
  const r = run(JSON.stringify(statusJson({ session_id: '11111111-2222-3333-4444-555555555555' })));
  assert.equal(r.status, 0);
  assert.equal(r.stdout.toString(), '');
  assert.ok(fs.existsSync(path.join(dir, 'herdr-hub', 'statusline', '11111111-2222-3333-4444-555555555555.json')));
  const bad = run('not json');
  assert.equal(bad.status, 0);
  assert.equal(bad.stdout.toString(), '');
});

test('modelName and defaultWindow: ids to names; the 5 family and [1m] are 1M, older 200k', () => {
  assert.equal(U.modelName('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(U.modelName('claude-haiku-5-5'), 'Haiku 5.5');
  assert.equal(U.modelName('claude-fable-5-2'), 'Fable 5.2');
  assert.equal(U.modelName('claude-opus-4-6'), 'Opus 4.6');
  assert.equal(U.modelName('claude-sonnet-4-20250514'), 'Sonnet 4');
  assert.equal(U.modelName('claude-3-5-sonnet-20241022'), 'Sonnet 3.5');
  assert.equal(U.modelName('claude-opus-4-6[1m]'), 'Opus 4.6');
  assert.equal(U.modelName('some-other'), 'some-other');
  assert.equal(U.defaultWindow('claude-opus-5-5'), 1e6);
  assert.equal(U.defaultWindow('claude-opus-4-6'), 2e5);
  assert.equal(U.defaultWindow('claude-opus-4-6[1m]'), 1e6);
  assert.equal(U.defaultWindow('claude-3-5-sonnet-20241022'), 2e5);
});

test('fromTranscript: the main chat\'s last real reply; a subagent\'s and <synthetic> skipped; /compact after it clears the tokens', () => {
  const t0 = NOW - 60e3;
  const text = [
    reply('claude-sonnet-5-5', { input_tokens: 9 }, t0 - 5000),
    reply('claude-opus-5-5', USE, t0),
    reply('claude-haiku-5-5', { input_tokens: 99 }, t0 + 1000, { isSidechain: true }),
    reply('<synthetic>', { input_tokens: 0 }, t0 + 2000),
    line({ type: 'user', message: { role: 'user', content: 'hi' }, timestamp: new Date(t0 + 3000).toISOString() }),
    '{"type":"assistant", cut',
  ].join('\n');
  assert.deepEqual(U.fromTranscript(text), { modelId: 'claude-opus-5-5', tokens: 2 + 502 + 249591, at: t0 });
  const compacted = `${text}\n${line({ type: 'system', subtype: 'compact_boundary', isSidechain: false, timestamp: new Date(t0 + 9000).toISOString(), compactMetadata: { preTokens: 250000 } })}`;
  assert.deepEqual(U.fromTranscript(compacted), { modelId: 'claude-opus-5-5', tokens: null, at: t0 + 9000 });
  // The next reply after it counts again.
  assert.equal(U.fromTranscript(`${compacted}\n${reply('claude-opus-5-5', { input_tokens: 40000 }, t0 + 20000)}`).tokens, 40000);
  assert.equal(U.fromTranscript(''), null);
});

test('mergeLimits: the latest window wins, the highest percentage within one; reset windows left out', () => {
  const h = NOW / 1000;
  const f = (five, week, at) => ({ at, rate_limits: { ...(five ? { five_hour: { used_percentage: five[0], resets_at: h + five[1] } } : {}), ...(week ? { seven_day: { used_percentage: week[0], resets_at: h + week[1] } } : {}) } });
  const m = U.mergeLimits(
    [
      f([80, -10], [5, 86400], 1), // an old session: its 5-hour window already reset
      f([20, 3600], [9, 86400], 2), // an idle one, same windows, less used
      f([31, 3600], [11, 86400], 3), // the busiest
      { at: 4 }, // no limits (an API key session)
      null,
    ],
    NOW
  );
  assert.deepEqual(m, { five: { pct: 31, resetsAt: NOW + 3600e3 }, week: { pct: 11, resetsAt: NOW + 86400e3 }, at: 3 });
  // A newer window (later reset) beats an older one even when lower.
  assert.equal(U.mergeLimits([f([90, 600], null, 1), f([3, 5 * 3600], null, 2)], NOW).five.pct, 3);
  assert.equal(U.mergeLimits([f([90, -1], null, 1)], NOW), null);
});

test('combine: the status line when it is as new as the reply; the transcript otherwise; limits alone too', () => {
  const sl = { ...SL.keep(statusJson(), NOW) };
  const t = { modelId: 'claude-opus-5-5', tokens: 250095, at: NOW - 1000 };
  const lim = { five: { pct: 31, resetsAt: NOW + 3600e3 }, at: NOW };
  assert.deepEqual(U.combine(t, sl, lim), { modelId: 'claude-opus-5-5', model: 'Opus 5.5', tokens: 53032, window: 1e6, pct: 5, from: 'statusline', limits: lim });
  // A reply after the file (the status line was taken out): the transcript's numbers.
  const later = { ...t, at: NOW + 60e3 };
  assert.deepEqual(U.combine(later, sl), { modelId: 'claude-opus-5-5', model: 'Opus 5.5', tokens: 250095, window: 1e6, pct: 25, from: 'transcript' });
  // No status line: the transcript, the window from the model.
  assert.deepEqual(U.combine({ modelId: 'claude-opus-4-6', tokens: 100000, at: 1 }, null), { modelId: 'claude-opus-4-6', model: 'Opus 4.6', tokens: 100000, window: 2e5, pct: 50, from: 'transcript' });
  // A 1M choice on a 200k model is shown in the name: 「Opus 4.6 1M」 (the status line says so,
  // and the transcript keeps using that window for the same model).
  const one = SL.keep(statusJson({ model: { id: 'claude-opus-4-6', display_name: 'Opus 4.6' }, context_window: { context_window_size: 1e6, used_percentage: 12, current_usage: { input_tokens: 120000 } } }), NOW);
  assert.equal(U.combine(null, one).model, 'Opus 4.6 1M');
  assert.equal(U.combine({ modelId: 'claude-opus-4-6', tokens: 300000, at: NOW + 60e3 }, one).window, 1e6);
  // After /compact: the model, no percentage until the next reply.
  const compacted = SL.keep(statusJson({ context_window: { context_window_size: 1e6, current_usage: null, used_percentage: null } }), NOW);
  assert.deepEqual(U.combine(null, compacted), { modelId: 'claude-opus-5-5', model: 'Opus 5.5', tokens: null, window: 1e6, pct: null, from: 'statusline' });
  // Nothing known but the host's limits; nothing at all.
  assert.deepEqual(U.combine(null, null, lim), { limits: lim });
  assert.equal(U.combine(null, null, null), null);
});

test('reader: a session\'s file, and the host\'s limits from every recent file, read again after 15 s', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slr-'));
  let clock = NOW;
  const r = U.reader({ dir, now: () => clock });
  const fsq = require('../lib/fsq');
  assert.equal(await r.session(SID, fsq.budget()), null);
  assert.equal(await r.hostLimits(fsq.budget()), null); // no folder yet
  SL.write(statusJson(), { CLAUDE_CONFIG_DIR: path.dirname(path.dirname(dir)) }, NOW); // not this dir
  fs.writeFileSync(path.join(dir, `${SID}.json`), JSON.stringify(SL.keep(statusJson(), NOW)));
  assert.equal((await r.session(SID, fsq.budget())).model.id, 'claude-opus-5-5');
  assert.equal(await r.session('../x', fsq.budget()), null);
  assert.equal(await r.hostLimits(fsq.budget()), null); // the last read is kept for 15 s
  clock += 15e3;
  assert.equal((await r.hostLimits(fsq.budget())).five.pct, 31);
  // The 5-hour window resets: gone at once, without waiting for the next read.
  clock = NOW + 3600e3 + 1;
  assert.deepEqual(Object.keys(await r.hostLimits(fsq.budget())).sort(), ['at', 'week']);
});

test('page: the chip, the limits line and the sheet\'s rows in words', () => {
  const u = { modelId: 'claude-opus-5-5', model: 'Opus 5.5', tokens: 420000, window: 1e6, pct: 42, limits: { five: { pct: 31, resetsAt: NOW + 3600e3 }, week: { pct: 12.4, resetsAt: NOW + 3 * 86400e3 }, at: NOW - 5 * 60e3 } };
  assert.deepEqual(P.chip(u), { full: 'Opus 5.5 · 컨텍스트 42%', short: '42%', title: '컨텍스트 420,000 / 1,000,000 토큰', warn: false });
  assert.equal(P.chip({ ...u, pct: 85 }).warn, true);
  assert.equal(P.chip({ ...u, pct: 0.3, tokens: 3000 }).full, 'Opus 5.5 · 컨텍스트 1% 미만');
  assert.deepEqual(P.chip({ model: 'Opus 5.5', pct: null, tokens: null }), { full: 'Opus 5.5', short: 'Opus', title: 'Opus 5.5', warn: false });
  assert.equal(P.chip({ limits: u.limits }), null);
  assert.equal(P.chip(null), null);
  // Times in the page's own zone; the expected words are Seoul's.
  if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'Asia/Seoul') {
    assert.equal(P.limitsLine(u.limits, NOW), '5시간 31% · 주간 12% · 오후 5:00 초기화');
    assert.equal(P.resetText(NOW + 86400e3, NOW), '내일 오후 4:00');
    assert.equal(P.resetText(NOW + 3 * 86400e3, NOW), '금 오후 4:00');
    assert.equal(P.resetText(NOW + 10 * 86400e3, NOW), '11월 20일 오후 4:00');
  }
  assert.match(P.limitsLine({ week: u.limits.week }, NOW), /^주간 12% · .+ 초기화$/);
  assert.equal(P.limitsLine({ five: { pct: 50, resetsAt: NOW - 1 } }, NOW), ''); // reset while the page was open
  assert.equal(P.limitsLine(null), '');
  const rows = P.rows(u, NOW);
  assert.deepEqual(rows.map((r) => r[0]), ['모델', '컨텍스트', '5시간 한도', '주간 한도']);
  assert.deepEqual(rows[0], ['모델', 'Opus 5.5', 'claude-opus-5-5']);
  assert.deepEqual(rows[1], ['컨텍스트', '42%', '420,000 / 1,000,000 토큰']);
  assert.equal(P.rows({ model: 'Opus 5.5', pct: null })[1][1], '알 수 없음');
  assert.match(P.limitsNote(u, NOW), /계정 전체 사용량 · 5분 전 답 기준$/);
  assert.match(P.limitsNote({ model: 'Opus 5.5' }, NOW), /상태 줄/);
});

test('hub: a Claude agent\'s usage in the state, from its host; a peer\'s through the hub; others none', async (t) => {
  const claude = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-claude-'));
  const proj = path.join(claude, 'projects', '-work');
  fs.mkdirSync(proj, { recursive: true });
  const now = Date.now();
  fs.writeFileSync(path.join(proj, `${SID}.jsonl`), `${reply('claude-opus-5-5', USE, now - 2000)}\n`);
  const later = statusJson();
  later.rate_limits = { five_hour: { used_percentage: 31, resets_at: Math.round(now / 1000) + 3600 } };
  SL.write(later, { CLAUDE_CONFIG_DIR: claude }, now);
  const agent = (pane, kind, session) => ({ pane_id: pane, workspace_id: 'w1', tab_id: 't1', agent: kind, agent_status: 'idle', cwd: '/work', agent_session: session ? { kind: 'id', value: session } : undefined });
  const peer = await startHub(t, { id: 'pu', agents: [agent('w1-p2', 'claude', SID), agent('w1-p3', 'codex', SID), agent('w1-p4', 'claude', null)], env: { CLAUDE_CONFIG_DIR: claude } });
  const hub = await startHub(t, { id: 'hu', env: { HERDR_HUB_PEERS: `pu=http://127.0.0.1:${peer.port}` } });
  const usageOf = async (h, host, pane) => ((await h.request('GET', '/api/state')).body.agents.find((a) => a.pane === pane && (!host || a.host === host)) || {}).usage;
  const u = await until(() => usageOf(peer, null, 'w1-p2'), 'usage on the host');
  assert.equal(u.model, 'Opus 5.5');
  assert.equal(u.pct, 5);
  assert.equal(u.from, 'statusline');
  assert.equal(u.limits.five.pct, 31);
  // A Claude agent with no session yet: the host's limits only. Not Claude: nothing.
  assert.deepEqual(Object.keys(await usageOf(peer, null, 'w1-p4')), ['limits']);
  assert.equal(await usageOf(peer, null, 'w1-p3'), undefined);
  // Through the hub, as the peer said.
  assert.deepEqual(await until(() => usageOf(hub, 'pu', 'w1-p2'), 'usage through the hub'), u);
});

test('statusline sweep: session files unused for 30 days and stale .tmp go, the rest and other names stay', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const sl = require('../lib/statusline');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-hub-sl-test-'));
  const now = Date.now();
  const put = (name, ageMs) => {
    const f = path.join(d, name);
    fs.writeFileSync(f, '{}');
    const t = (now - ageMs) / 1000;
    fs.utimesSync(f, t, t);
  };
  const day = 24 * 3600e3;
  put('aaaaaaaa-0000-0000-0000-000000000001.json', 31 * day);
  put('aaaaaaaa-0000-0000-0000-000000000002.json', 29 * day);
  put('aaaaaaaa-0000-0000-0000-000000000003.json.123.tmp', 2 * day);
  put('aaaaaaaa-0000-0000-0000-000000000004.json.124.tmp', 1000);
  put('notes.txt', 400 * day);
  assert.equal(await sl.sweep(d, now), 2);
  assert.deepEqual(fs.readdirSync(d).sort(), ['aaaaaaaa-0000-0000-0000-000000000002.json', 'aaaaaaaa-0000-0000-0000-000000000004.json.124.tmp', 'notes.txt']);
  assert.equal(await sl.sweep(path.join(d, 'missing'), now), 0);
  fs.rmSync(d, { recursive: true, force: true });
});
