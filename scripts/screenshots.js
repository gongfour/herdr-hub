'use strict';
// The README's screenshots, made again from example data: `node scripts/screenshots.js [ko|en]`
// (both when no language is given), into docs/images/<lang>/, the page and its example data in
// that language.
// A hub in this process over the test's fake herdr (no real agent, nothing of this machine), its
// agents' chats written as Claude Code transcripts into a temporary config folder, and the page
// opened in this machine's Chrome (playwright-core, a dev dependency). Writes docs/images/*.png.
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-shots-'));
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude');
const { chromium } = require('playwright-core');
const { hubInProcess, until } = require('../test/fixtures/hub');

const LANGS = process.argv[2] ? [process.argv[2]] : ['ko', 'en'];
const HOME = '/Users/alex';
// The example data in each language: titles, the chat, the user's words.
const DATA = {
  ko: {
    titles: ['결제 모듈 리팩터링과 시험 정리', '주문 API 응답 시간 줄이기', '설치 안내 문서 다시 쓰기', '배포 스크립트 점검', '로그 보관 기간 정리'],
    ask: '결제 모듈을 새 스키마로 옮기고 시험도 정리해 줘.',
    look: '결제 모듈부터 살펴보겠습니다.',
    plan: '`payments/` 아래 세 파일이 옛 필드 `amount_cents` 를 씁니다.\n\n1. `charge.ts`·`refund.ts` 를 새 `amount` 필드로 바꿉니다.\n2. 시험 픽스처를 고칩니다.\n3. 스테이징에 마이그레이션을 적용합니다.',
    test: '시험 실행',
    done: '시험 128개가 모두 통과했습니다. 이제 스테이징에 마이그레이션을 적용하겠습니다.',
  },
  en: {
    titles: ['Payments refactor and test cleanup', 'Speed up the orders API', 'Rewrite the install guide', 'Check the deploy script', 'Log retention cleanup'],
    ask: 'Move the payments module to the new schema and tidy up the tests.',
    look: "I'll start with the payments module.",
    plan: 'Three files under `payments/` still use the old `amount_cents` field.\n\n1. Switch `charge.ts` and `refund.ts` to the new `amount` field.\n2. Fix the test fixtures.\n3. Apply the migration on staging.',
    test: 'Run the tests',
    done: 'All 128 tests pass. Next I will apply the migration on staging.',
  },
};

const BASH = `
 Bash command

   npm run migrate -- --env staging
   Apply the new payments schema to staging

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for npm run commands in ${HOME}/shop-api
   3. No, and tell Claude what to do differently (esc)
`;
const WORKING = '✻ Running the test suite… (1m 12s · esc to interrupt)\n\n────────────────────────────────────────\n❯ \n────────────────────────────────────────';
const IDLE = '● Done.\n\n────────────────────────────────────────\n❯ \n────────────────────────────────────────\n  ? for shortcuts';

// A Claude Code transcript: the user's words, the assistant's text and tool calls with results.
const SESSION = '0f6c2a4e-9b1d-4c3e-8a7f-2d5e6b7c8a91';
function transcript(d) {
  const L = [];
  let n = 0;
  const user = (text) => L.push({ type: 'user', promptId: `p${++n}`, timestamp: `2026-11-10T09:0${n}:00Z`, message: { role: 'user', content: [{ type: 'text', text }] } });
  const say = (text) => L.push({ type: 'assistant', message: { id: `a${++n}`, model: 'claude-opus-5-5', content: [{ type: 'text', text }] } });
  const tool = (name, input, result) => {
    const id = `t${++n}`;
    L.push({ type: 'assistant', message: { id: `a${n}`, model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name, input }] } });
    L.push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: result }] } });
  };
  user(d.ask);
  say(d.look);
  tool('Read', { file_path: `${HOME}/shop-api/payments/charge.ts` }, 'export async function charge(order) { … }');
  tool('Grep', { pattern: 'amount_cents', path: `${HOME}/shop-api` }, 'payments/charge.ts\npayments/refund.ts\ntest/payments.test.ts');
  say(d.plan);
  tool('Edit', { file_path: `${HOME}/shop-api/payments/charge.ts`, old_string: 'amount_cents', new_string: 'amount' }, 'ok');
  tool('Bash', { command: 'npm test', description: d.test }, 'Tests: 128 passed, 128 total');
  say(d.done);
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', '-Users-alex-shop-api');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${SESSION}.jsonl`), L.map((x) => JSON.stringify(x)).join('\n') + '\n');
}

const agent = (pane, ws, status, seq, title, name, dir, session = null) => ({
  pane_id: pane, workspace_id: ws, agent: 'claude', agent_status: status, state_change_seq: seq,
  terminal_title: title, name, foreground_cwd: `${HOME}/${dir}`, ...(session ? { agent_session: { kind: 'id', value: session } } : {}),
});

async function shoot(lang) {
  const d = DATA[lang];
  fs.rmSync(path.join(process.env.CLAUDE_CONFIG_DIR, 'projects'), { recursive: true, force: true });
  transcript(d);
  const cleanups = [];
  const t = { after: (fn) => cleanups.push(fn) };
  const h = await hubInProcess(t, {
    id: 'desktop',
    env: { HERDR_HUB_HOST_LABEL: 'desktop' },
    agents: [
      agent('w1-p1', 'w1', 'blocked', 12, d.titles[0], 'shop-api', 'shop-api', SESSION),
      agent('w1-p2', 'w1', 'working', 9, d.titles[1], 'shop-api-2', 'shop-api'),
      agent('w2-p1', 'w2', 'idle', 4, d.titles[2], 'docs-site', 'docs-site'),
      agent('w3-p1', 'w3', 'blocked', 7, d.titles[3], 'infra', 'infra'),
      agent('w3-p2', 'w3', 'idle', 3, d.titles[4], 'infra-2', 'infra'),
    ],
  });
  const { herdr } = h;
  herdr.workspaces.splice(0, herdr.workspaces.length, { workspace_id: 'w1', label: 'shop-api' }, { workspace_id: 'w2', label: 'docs-site' }, { workspace_id: 'w3', label: 'infra' });
  Object.assign(herdr.screens, { 'w1-p1': BASH, 'w1-p2': WORKING, 'w2-p1': IDLE, 'w3-p1': BASH.replace('npm run migrate -- --env staging', './deploy.sh staging'), 'w3-p2': IDLE });
  await until(async () => (await h.request('GET', '/api/state')).body.agents.length === 5, 'agents listed');

  const out = path.join(__dirname, '..', 'docs', 'images', lang);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  fs.mkdirSync(out, { recursive: true });
  const shot = async (name, { width, height, hash, ready, theme = 'light' }) => {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, locale: lang === 'en' ? 'en-US' : 'ko-KR', colorScheme: theme });
    await ctx.addInitScript((l) => localStorage.setItem('herdr-hub.lang', l), lang);
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${h.port}/${hash || ''}`);
    await page.waitForFunction(() => typeof state !== 'undefined' && state.herdr === 'up');
    if (ready) await page.locator(ready).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    await ctx.close();
    console.log(`docs/images/${lang}/${name}.png`);
  };
  await shot('phone-list', { width: 390, height: 760, ready: '.blocked-line' });
  await shot('phone-answer', { width: 390, height: 760, hash: '#/h/desktop/agent/w1-p1', ready: '#d-blocked .choice[data-n="1"]' });
  await shot('wide', { width: 1280, height: 760, hash: '#/h/desktop/agent/w1-p1', ready: '#d-blocked .choice[data-n="1"]', theme: 'dark' });
  await browser.close();
  for (const fn of cleanups.reverse()) await fn();
}

(async () => {
  for (const lang of LANGS) await shoot(lang);
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
