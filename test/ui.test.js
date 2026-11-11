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
