'use strict';
// The page itself, in a real browser: a hub in this process over the fake herdr, opened in headless
// Chrome (playwright-core, a dev dependency; it uses the Chrome installed on this machine and
// downloads nothing). Nothing in the page is stubbed: what it shows comes from the hub's API and
// what it sends lands on the fake herdr. Skipped where no Chrome can be started.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { hubInProcess, until } = require('./fixtures/hub');

let chromium = null;
try {
  ({ chromium } = require('playwright-core'));
} catch {
  /* not installed: skipped below */
}

const FIX = path.join(__dirname, 'fixtures');
const BASH = `
 Bash command

   npm run migrate -- --env staging
   Apply the new payments schema to staging

 Do you want to proceed?
 ❯ 1. Yes
   2. No
`;
const ASK = fs.readFileSync(path.join(FIX, 'ask', 'one.txt'), 'utf8'); // AskUserQuestion with 「Type something.」
const MENU = fs.readFileSync(path.join(FIX, 'menu', 'model.txt'), 'utf8'); // /model's menu
const IDLE = '● Done.\n\n────────────────────────────────────────\n❯ \n────────────────────────────────────────\n  ? for shortcuts';
// The question after 「Type something.」 was picked: its row is now a field with the caret in it.
const ASK_TYPING = ASK.replace('  3. Type something.', '❯ 3. ▌').replace('❯ 1. 빨강', '  1. 빨강');

const agent = (pane, status, seq, title, name) => ({ pane_id: pane, workspace_id: 'w1', agent: 'claude', agent_status: status, state_change_seq: seq, terminal_title: title, name });
const sentTo = (herdr, method, pane) => herdr.calls.filter((c) => c.method === method && (c.params.target === pane || c.params.pane_id === pane)).map((c) => c.params);

let browser = null;
const why = { skip: false };
test.before(async () => {
  if (!chromium) return void (why.skip = 'playwright-core is not installed');
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch (err) {
    why.skip = `no Chrome to drive: ${err.message.split('\n')[0]}`;
  }
});
test.after(async () => {
  if (browser) await browser.close();
});

// A phone-sized page on the hub; every console error and CSP report is kept for the test to check.
async function open(t, h, hash = '') {
  if (why.skip) return t.skip(why.skip);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', (m) => m.type() === 'error' && page.errors.push(m.text()));
  page.on('pageerror', (e) => page.errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${h.port}/${hash}`);
  await page.waitForFunction(() => typeof state !== 'undefined' && state.herdr === 'up');
  return page;
}
const noErrors = (page) => assert.deepEqual(page.errors.filter((e) => !/favicon/.test(e)), []);

test('list: the 답 필요 line opens the waiting agent; the search button opens 빠른 이동', async (t) => {
  const h = await hubInProcess(t, { id: 'ui1', agents: [agent('w1-p2', 'blocked', 5, '결제 모듈 리팩터링', 'shop-api'), agent('w1-p3', 'working', 4, '주문 API 정리', 'shop-api-2')] });
  h.herdr.screens['w1-p2'] = BASH;
  const page = await open(t, h);
  if (!page) return;
  const line = page.locator('.blocked-line');
  await line.waitFor();
  assert.match(await line.innerText(), /답 필요 1/);
  await page.locator('[data-find]').click();
  await page.locator('.qs').waitFor();
  assert.match(await page.locator('.qs').innerText(), /답 필요[\s\S]*결제 모듈 리팩터링/);
  await page.keyboard.press('Escape');
  await line.click();
  await page.waitForFunction(() => location.hash.includes('/agent/w1-p2'));
  noErrors(page);
});

test('agent: titled by its conversation, its name below; a choice button answers on the host', async (t) => {
  const h = await hubInProcess(t, { id: 'ui2', agents: [agent('w1-p2', 'blocked', 5, '결제 모듈 리팩터링', 'shop-api')] });
  h.herdr.screens['w1-p2'] = BASH;
  const page = await open(t, h, '#/h/ui2/agent/w1-p2');
  if (!page) return;
  await page.locator('#d-title .t').waitFor();
  assert.equal(await page.locator('#d-title .t').innerText(), '결제 모듈 리팩터링');
  assert.match(await page.locator('#d-title .sub').innerText(), /shop-api/);
  const yes = page.locator('#d-blocked .choice[data-n="1"]');
  await yes.waitFor();
  assert.match(await yes.innerText(), /Yes/);
  // The phone's toggles say what they are.
  assert.deepEqual(await page.locator('#d-blocked .toggle[data-toggle]').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label'))), ['터미널 화면 보기', '키 직접 보내기']);
  await yes.click();
  await until(() => sentTo(h.herdr, 'agent.send_keys', 'w1-p2').length === 1, 'the answer');
  assert.equal(sentTo(h.herdr, 'agent.prompt', 'w1-p2').length, 0);
  noErrors(page);
});

test('a slash command menu: Esc from the message box cancels it in Claude Code', async (t) => {
  const h = await hubInProcess(t, { id: 'ui3', agents: [agent('w1-p2', 'idle', 6, 'model 고르기', 'shop-api')] });
  h.herdr.screens['w1-p2'] = MENU;
  const page = await open(t, h, '#/h/ui3/agent/w1-p2');
  if (!page) return;
  await page.locator('#d-blocked .blocked-box.menu').waitFor({ timeout: 20000 });
  // Where the focus is after sending /model: the message box (shut for typing while the menu is open).
  await page.locator('#d-input').focus();
  await page.keyboard.press('Escape');
  await until(() => sentTo(h.herdr, 'agent.send_keys', 'w1-p2').some((p) => p.keys.join() === 'esc'), 'Esc sent');
  assert.match(page.url(), /agent\/w1-p2/); // still in the chat, not sent back to the list
  noErrors(page);
});

test('a slash command menu by keyboard: the cursor row is marked, ↑↓ move it at once and go to Claude Code, Enter picks', async (t) => {
  const h = await hubInProcess(t, { id: 'ui9', agents: [agent('w1-p2', 'idle', 6, 'model 고르기', 'shop-api')] });
  h.herdr.screens['w1-p2'] = MENU;
  // Claude Code moving its cursor: each ↓ a row down, ↑ a row up, as the next read shows it; Enter
  // picks and the menu closes.
  const rows = MENU.split('\n');
  const move = (d) => {
    const i = rows.findIndex((l) => /^ {3}❯ \d\./.test(l));
    if (!/^ {5}\d\./.test(rows[i + d] || '')) return;
    rows[i] = rows[i].replace('❯ ', '  ');
    rows[i + d] = rows[i + d].replace(/^ {5}/, '   ❯ ');
  };
  h.herdr.on['agent.send_keys'] = (p) => {
    for (const k of p.keys) move(k === 'down' ? 1 : k === 'up' ? -1 : 0);
    h.herdr.screens['w1-p2'] = p.keys.includes('enter') ? IDLE : rows.join('\n');
  };
  const page = await open(t, h, '#/h/ui9/agent/w1-p2');
  if (!page) return;
  const box = page.locator('#d-blocked .blocked-box.menu');
  await box.waitFor({ timeout: 20000 });
  const at = () => page.evaluate(() => [...document.querySelectorAll('#d-blocked .choice.at')].map((b) => Number(b.dataset.n)));
  assert.deepEqual(await at(), [2], 'the row the terminal has its cursor on');
  // From the empty message box (where the caret is after sending /model): ↓ moves the mark in the
  // same task, before the host has answered, and goes to Claude Code.
  await page.locator('#d-input').focus();
  await page.keyboard.press('ArrowDown');
  assert.deepEqual(await at(), [3]);
  await until(() => sentTo(h.herdr, 'agent.send_keys', 'w1-p2').some((p) => p.keys.join() === 'down'), '↓ sent');
  // The screen after it comes back with the keys: no wait for the next read (every 3 s).
  await page.waitForFunction(() => /❯ 3\./.test(detail.blockedText || ''), null, { timeout: 1500 });
  assert.deepEqual(await at(), [3]);
  // Two ↑ in a row: in order, and the mark ends where the terminal's cursor does.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction(() => /❯ 1\./.test(detail.blockedText || ''), null, { timeout: 3000 });
  assert.deepEqual(await at(), [1]);
  assert.deepEqual(sentTo(h.herdr, 'agent.send_keys', 'w1-p2').flatMap((p) => p.keys), ['down', 'up', 'up']);
  assert.equal(await page.locator('#d-input').evaluate((el) => el.value), '', 'the arrows did not bring back an old message');
  // Words in the box keep their arrows: nothing goes to the menu.
  await page.keyboard.type('x');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Delete');
  assert.equal(sentTo(h.herdr, 'agent.send_keys', 'w1-p2').length, 3);
  // Enter from the empty box picks the row; the menu closes.
  await page.keyboard.press('Enter');
  await until(() => sentTo(h.herdr, 'agent.send_keys', 'w1-p2').some((p) => p.keys.join() === 'enter'), 'Enter sent');
  await box.waitFor({ state: 'detached', timeout: 20000 });
  noErrors(page);
});

test('a slash command menu: one line a row with a mouse (as the terminal\'s list), tall rows under a finger', async (t) => {
  const h = await hubInProcess(t, { id: 'ui11', agents: [agent('w1-p2', 'idle', 6, 'model 고르기', 'shop-api')] });
  h.herdr.screens['w1-p2'] = MENU;
  if (why.skip) return t.skip(why.skip);
  const rows = async (opts) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR', ...opts });
    t.after(() => ctx.close());
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${h.port}/#/h/ui11/agent/w1-p2`);
    await page.locator('#d-blocked .blocked-box.menu .choice').first().waitFor({ timeout: 20000 });
    return page.evaluate(() =>
      [...document.querySelectorAll('#d-blocked .choice')].map((b) => {
        const name = b.querySelector('.name').getBoundingClientRect();
        const desc = b.querySelector('.desc');
        return { h: Math.round(b.getBoundingClientRect().height), oneLine: !desc || Math.abs(desc.getBoundingClientRect().top - name.top) < 4, title: b.title };
      })
    );
  };
  const mouse = await rows({});
  assert.ok(mouse.length >= 5);
  for (const r of mouse) {
    assert.ok(r.h <= 36, `a mouse's row is ${r.h}px`);
    assert.ok(r.oneLine, 'the description beside the name');
  }
  assert.match(mouse[0].title, /^Default \(recommended\) — Opus 5\.5/, 'the whole row in the tooltip');
  const finger = await rows({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  for (const r of finger) assert.ok(r.h >= 44, `a finger's row is ${r.h}px`);
});

test('a slash command that opens a menu: its bubble says 보내는 중, not 대기 중, and goes once the menu is up', async (t) => {
  // A conversation to show the bubble in: a Claude Code transcript of one exchange.
  const claude = fs.mkdtempSync(path.join(require('os').tmpdir(), 'hub-ui12-'));
  const was = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = claude;
  t.after(() => {
    if (was === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = was;
    fs.rmSync(claude, { recursive: true, force: true });
  });
  const SESSION = '7d0c1e2f-3a4b-4c5d-8e6f-9a0b1c2d3e4f';
  fs.mkdirSync(path.join(claude, 'projects', '-tmp-docs'), { recursive: true });
  const lines = [
    { type: 'user', promptId: 'p1', timestamp: '2026-11-10T09:00:00Z', message: { role: 'user', content: [{ type: 'text', text: '문서를 정리해 줘' }] } },
    { type: 'assistant', message: { id: 'a1', model: 'claude-opus-5-5', content: [{ type: 'text', text: '정리했습니다.' }] } },
  ];
  fs.writeFileSync(path.join(claude, 'projects', '-tmp-docs', `${SESSION}.jsonl`), lines.map((x) => JSON.stringify(x)).join('\n') + '\n');
  const h = await hubInProcess(t, { id: 'ui12', agents: [{ ...agent('w1-p2', 'idle', 3, '문서 정리', 'docs'), agent_session: { kind: 'id', value: SESSION } }] });
  h.herdr.screens['w1-p2'] = IDLE;
  // Claude Code opens /model's menu a moment after the command came; it writes the command down
  // only once the menu is closed, so nothing about it turns up in the conversation meanwhile.
  h.herdr.on['agent.prompt'] = (p) => {
    if (p.text === '/model') setTimeout(() => (h.herdr.screens['w1-p2'] = MENU), 300);
  };
  const page = await open(t, h, '#/h/ui12/agent/w1-p2');
  if (!page) return;
  await page.locator('.msg', { hasText: '정리했습니다.' }).waitFor();
  await page.locator('#d-input').click();
  await page.keyboard.type('/model');
  await page.locator('#d-send').click();
  const bubble = page.locator('.msg.user.pending');
  await bubble.waitFor();
  assert.match(await bubble.innerText(), /\/model[\s\S]*보내는 중/);
  assert.doesNotMatch(await bubble.innerText(), /대기 중/);
  await page.locator('#d-blocked .blocked-box.menu').waitFor({ timeout: 20000 });
  await bubble.waitFor({ state: 'detached', timeout: 5000 });
  noErrors(page);
});

test('the / list: Return on a command sends it at once; Tab, or a command that needs words, only puts it in the box', async (t) => {
  // A Claude agent with a folder: the / list has the built-in commands.
  const h = await hubInProcess(t, { id: 'ui10', agents: [{ ...agent('w1-p2', 'idle', 3, '문서 정리', 'docs'), cwd: require('os').tmpdir() }] });
  h.herdr.screens['w1-p2'] = IDLE;
  const page = await open(t, h, '#/h/ui10/agent/w1-p2');
  if (!page) return;
  const input = page.locator('#d-input');
  const first = page.locator('#d-pal #pal-0 .pal-name');
  const prompts = () => sentTo(h.herdr, 'agent.prompt', 'w1-p2').map((p) => p.text);
  // Tab: in the box to go on writing (/compact what to keep), nothing sent.
  await input.click();
  await page.keyboard.type('/compac');
  await page.waitForFunction(() => (document.querySelector('#d-pal #pal-0 .pal-name') || {}).textContent === '/compact');
  await page.keyboard.press('Tab');
  assert.equal(await input.evaluate((el) => el.value), '/compact ');
  // A command that needs words (/add-dir <path>): Return puts it in too.
  await input.evaluate((el) => (el.value = ''));
  await page.keyboard.type('/add-di');
  await page.waitForFunction(() => (document.querySelector('#d-pal #pal-0 .pal-name') || {}).textContent === '/add-dir');
  await page.keyboard.press('Enter');
  assert.equal(await input.evaluate((el) => el.value), '/add-dir ');
  assert.deepEqual(prompts(), []);
  // Return on /model: sent at once (one Return, as in Claude Code), the box empty again.
  await input.evaluate((el) => (el.value = ''));
  await page.keyboard.type('/mode');
  await first.waitFor();
  await page.waitForFunction(() => (document.querySelector('#d-pal #pal-0 .pal-name') || {}).textContent === '/model');
  await page.keyboard.press('Enter');
  await until(() => prompts().length === 1, '/model sent');
  assert.deepEqual(prompts(), ['/model']);
  await page.waitForFunction(() => document.getElementById('d-input').value === '');
  // A tap on a row is the same.
  await page.keyboard.type('/conte');
  await page.waitForFunction(() => (document.querySelector('#d-pal #pal-0 .pal-name') || {}).textContent === '/context');
  await page.locator('#d-pal #pal-0').click();
  await until(() => prompts().length === 2, '/context sent');
  assert.deepEqual(prompts(), ['/model', '/context']);
  noErrors(page);
});

test('typed answer: the words go only once the question took the pick, never into it as it was', async (t) => {
  const h = await hubInProcess(t, { id: 'ui4', agents: [agent('w1-p2', 'blocked', 7, '색 고르기', 'shop-api')] });
  const { herdr } = h;
  herdr.screens['w1-p2'] = ASK;
  const page = await open(t, h, '#/h/ui4/agent/w1-p2');
  if (!page) return;
  await page.locator('#d-blocked .choice[data-n="3"]').waitFor();

  // Claude Code is slow: the pick never shows. Nothing is typed, the words stay.
  await page.locator('#d-input').click();
  await page.keyboard.type('초록 2 개');
  await page.locator('#d-send').click();
  await until(() => sentTo(herdr, 'agent.send_keys', 'w1-p2').length === 1, 'the pick');
  await page.locator('.toast', { hasText: '입력 칸이 아직 열리지 않았습니다' }).waitFor({ timeout: 6000 });
  assert.equal(sentTo(herdr, 'pane.send_text', 'w1-p2').length, 0);
  assert.equal(await page.locator('#d-input').innerText(), '초록 2 개');

  // Now the pick lands: the field opens, and the words go into it.
  herdr.on['agent.send_keys'] = () => (herdr.screens['w1-p2'] = ASK_TYPING);
  herdr.screens['w1-p2'] = ASK;
  await page.waitForTimeout(2100); // past the host's 「answered」 hold of this prompt's screen
  await page.locator('#d-send').click();
  await until(() => sentTo(herdr, 'pane.send_text', 'w1-p2').length === 1, 'the words', 8000);
  assert.deepEqual(sentTo(herdr, 'pane.send_text', 'w1-p2')[0].text, '초록 2 개');
  noErrors(page);
});

test('the pages run under their CSP: nothing blocked on the list, an agent, settings, shortcuts', async (t) => {
  const h = await hubInProcess(t, { id: 'ui5', agents: [agent('w1-p2', 'idle', 3, '문서 정리', 'docs')] });
  h.herdr.screens['w1-p2'] = IDLE;
  const page = await open(t, h);
  if (!page) return;
  const csp = [];
  page.on('console', (m) => /Content Security Policy/i.test(m.text()) && csp.push(m.text()));
  for (const hash of ['#/h/ui5/agent/w1-p2', '#/settings', '#/keys', '#/']) {
    await page.evaluate((x) => (location.hash = x), hash);
    await page.waitForTimeout(400);
  }
  assert.deepEqual(csp, []);
  noErrors(page);
});

// The host segment with more hosts than fit a phone: the chosen one is brought to its middle.
// Where the chosen button's middle is from the segment's middle (px), measured on the screen.
const segAt = (page) =>
  page.evaluate(() => {
    const nav = document.querySelector('.seg.hosts');
    const b = nav.querySelector('button[aria-pressed="true"]');
    const r = nav.getBoundingClientRect();
    const q = b.getBoundingClientRect();
    return { host: b.dataset.host, off: Math.round(q.left + q.width / 2 - (r.left + r.width / 2)), left: nav.scrollLeft, max: nav.scrollWidth - nav.clientWidth };
  });
const centred = (page, host) =>
  until(async () => {
    const s = await segAt(page);
    return s.host === host && Math.abs(s.off) <= 1 && s;
  }, `${host} in the middle of the host segment`);

test('host segment: the chosen host glides to its middle, stays there, and is left where a finger puts it', async (t) => {
  // Eight peers nobody answers (offline buttons): far more than a phone's segment holds.
  const peers = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'].map((id, i) => `${id}=http://127.0.0.1:${i + 1}`).join(',');
  const h = await hubInProcess(t, { id: 'ui7', agents: [agent('w1-p2', 'idle', 3, '문서 정리', 'docs')], env: { HERDR_HUB_PEERS: peers } });
  h.herdr.screens['w1-p2'] = IDLE;
  const page = await open(t, h);
  if (!page) return;
  await page.locator('.seg.hosts button[data-host="hotel"]').waitFor();
  const first = await segAt(page);
  assert.equal(first.host, 'all');
  assert.equal(first.left, 0); // 전체 is at the start: as far as the end lets it
  assert.ok(first.max > 300, `the segment overflows (${first.max}px)`);
  // A tap, then Alt+→: each time it glides to the middle.
  await page.locator('.seg.hosts button[data-host="charlie"]').click();
  await centred(page, 'charlie');
  await page.keyboard.press('Alt+ArrowRight');
  await centred(page, 'delta');
  // An agent and back: the list kept, its segment where it was (not back at the start).
  await page.evaluate(() => (location.hash = '#/h/ui7/agent/w1-p2'));
  await page.locator('#d-title').waitFor();
  await page.evaluate(() => (location.hash = '#/'));
  await page.locator('.seg.hosts').waitFor();
  const back = await segAt(page);
  assert.equal(back.host, 'delta');
  assert.ok(Math.abs(back.off) <= 1, `delta still in the middle after coming back (${back.off}px off)`);
  // Moved by hand: left there by what is drawn next.
  await page.evaluate(() => (document.querySelector('.seg.hosts').scrollLeft = 0));
  await page.evaluate(() => render());
  await page.waitForTimeout(300);
  assert.equal((await segAt(page)).left, 0);
  // Opened again: there at once.
  await page.reload();
  await page.locator('.seg.hosts button[data-host="hotel"]').waitFor();
  await centred(page, 'delta');
  // Reduced motion: no glide, there in the same task as the key.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Alt+ArrowLeft');
  const now = await segAt(page);
  assert.equal(now.host, 'charlie');
  assert.ok(Math.abs(now.off) <= 1, `charlie in the middle at once (${now.off}px off)`);
  noErrors(page);
});

test('host colour: picked in 설정 → 연결, then on its host button, its cards and its chip; 없음 takes it away', async (t) => {
  const h = await hubInProcess(t, { id: 'ui8', agents: [agent('w1-p2', 'idle', 3, '문서 정리', 'docs')], env: { HERDR_HUB_PEERS: 'srv=http://127.0.0.1:9' } });
  h.herdr.screens['w1-p2'] = IDLE;
  const page = await open(t, h, '#/settings');
  if (!page) return;
  const pick = async (color) => {
    await page.locator('.cl-color[data-color-host="ui8"]').click();
    await page.locator(`.sheet .action[data-k="${color}"]`).click();
  };
  await pick('blue');
  await page.locator('.cl-color[data-color-host="ui8"] .hc-swatch[data-hc="blue"]').waitFor();
  assert.match(await page.locator('.cl-color[data-color-host="ui8"]').getAttribute('aria-label'), /ui8 색: 파랑/);
  assert.equal(await page.locator('.cl-color[data-color-host="srv"] .hc-swatch[data-hc]').count(), 0, 'the other host has none');
  await page.evaluate(() => (location.hash = '#/'));
  await page.locator('.seg.hosts button[data-host="ui8"][data-hc="blue"]').waitFor();
  assert.equal(await page.locator('.seg.hosts button[data-host="srv"][data-hc]').count(), 0);
  await page.locator('section.ws[data-hc="blue"] .host-chip[data-hc="blue"]').waitFor();
  // The card's head is tinted, not the surface's white.
  const head = () => page.evaluate(() => getComputedStyle(document.querySelector('section.ws .ws-front')).backgroundColor);
  assert.notEqual(await head(), 'rgb(255, 255, 255)');
  // The open settings show the one chosen; 없음 takes it away everywhere.
  await page.evaluate(() => (location.hash = '#/settings'));
  await page.locator('.cl-color[data-color-host="ui8"]').click();
  assert.equal(await page.locator('.sheet .action[data-k="blue"]').getAttribute('aria-current'), 'true');
  await page.locator('.sheet .action[data-k="none"]').click();
  await page.locator('.cl-color[data-color-host="ui8"] .hc-swatch:not([data-hc])').waitFor();
  await page.evaluate(() => (location.hash = '#/'));
  await page.locator('section.ws').waitFor();
  assert.equal(await page.locator('.seg.hosts [data-hc], section.ws[data-hc], .host-chip[data-hc]').count(), 0);
  assert.equal(await head(), 'rgb(255, 255, 255)');
  noErrors(page);
});

// English: every screen, opened with 언어 · Language set to English, shows no Korean (the example
// data is English too). What is left Korean on purpose is the 언어 setting's own labels.
test('English: no Korean left on the list, an agent, its answer box, quick switch, settings, shortcuts', async (t) => {
  const h = await hubInProcess(t, { id: 'ui6', agents: [agent('w1-p2', 'blocked', 5, 'Payments refactor', 'shop-api'), agent('w1-p3', 'working', 4, 'Order API cleanup', 'shop-api-2')] });
  h.herdr.screens['w1-p2'] = BASH;
  if (why.skip) return t.skip(why.skip);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  t.after(() => ctx.close());
  await ctx.addInitScript(() => localStorage.setItem('herdr-hub.lang', 'en'));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${h.port}/`);
  await page.waitForFunction(() => typeof state !== 'undefined' && state.herdr === 'up');
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
  const korean = async (where) => {
    const text = await page.evaluate(() => {
      const keep = document.querySelector('[data-pref="lang"], #s-lang');
      return [...document.querySelectorAll('body *')]
        .filter((el) => !el.children.length && el.offsetParent && !(keep && keep.contains(el)))
        .map((el) => `${el.textContent} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.getAttribute('placeholder') || el.dataset.placeholder || ''}`)
        .join('\n');
    });
    const left = text.split('\n').filter((l) => /[가-힣]/.test(l) && !/언어 · Language|기기 따라|한국어/.test(l));
    assert.deepEqual(left, [], `Korean on ${where}`);
  };
  await page.locator('.blocked-line').waitFor();
  await korean('the list');
  await page.locator('[data-find]').click();
  await page.locator('.qs').waitFor();
  await korean('quick switch');
  await page.keyboard.press('Escape');
  await page.evaluate(() => (location.hash = '#/h/ui6/agent/w1-p2'));
  await page.locator('#d-blocked .choice[data-n="1"]').waitFor();
  await korean('the agent and its answer box');
  for (const hash of ['#/settings', '#/keys']) {
    await page.evaluate((x) => (location.hash = x), hash);
    await page.waitForTimeout(500);
    await korean(hash);
  }
  assert.deepEqual(errors, []);
});
