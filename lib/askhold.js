'use strict';
// Prompts a Claude agent shows that herdr doesn't report as waiting, held as 답 필요 here from
// what the screen shows (public/choices.js heldPrompt).
//
// herdr (its Claude manifest of 2026.10.11) reads two of Claude's prompts as its input box once
// the session has a name (the name sits in the rule under them): AskUserQuestion's last screen
// (「Review your answers … ❯ 1. Submit answers」) and the plan approval (「Would you like to
// proceed? ❯ 1. Yes, and use auto mode」). The agent turns idle while it still waits for an
// answer. When a Claude agent turns idle or done, its screen is read once; if one of those
// prompts is on it, it stays blocked here until herdr's state changes again (the answer sent, or
// Esc).
// Claude's select dialogs (「Teach auto mode about your environment? … ❯ Also scan shell history
// false … Enter to continue · Esc to cancel」) herdr doesn't see at all: idle or working, and
// still so once the dialog is answered or closed. So an idle, done or working Claude agent's
// screen is also read every ASK_RECHECK_MS (the first time it is seen, too: no notification
// then, there is no status before it), and one held for a dialog every HELD_RECHECK_MS; the
// hold goes when the dialog is no longer there. A slash command's menu (/model …) is held the
// same way with menu: true (nobody waits for it: no notification, not counted as 답 필요).
// An answer drawn for the blocked state just before (its stateSeq is `from`) is for the same
// prompt: answerLocal (lib/routes/agents.js) takes it.
//
// Refreshes overlap (lib/hub.js refresh: one that ends late is dropped). Two rules keep a late
// one from undoing a newer one's work: only a newer stateSeq ends a hold (herdr's stateSeq never
// goes back), and a read for an older state never overwrites a hold set for a newer one.
//
// askHold({ readScreen, now, refresh, wasOf }) -> { held, hold(a), recheck(pane), watchMenu(pane),
//   prune(panes), close() }. wasOf(pane): the agent as the last applied refresh had it ({ seq }).
//   hold(a) is called for each agent of a refresh, sets a.status = 'blocked' (and a.menu) while
//   held, and waits for that pane's screen read when one is due.
const { heldPrompt } = require('../public/choices');

const ASK_RECHECK_MS = 15e3;
const HELD_RECHECK_MS = 2e3;
// A slash command sent from here (/model, /config …) may open a menu in Claude Code, which herdr
// doesn't see: the screen is read again a few times while it draws, not 15 s later.
const MENU_READS_MS = [600, 1500, 3000, 5000];
const ASK_STATUSES = new Set(['idle', 'done', 'working']);

function askHold({ readScreen, now = Date.now, refresh = () => {}, wasOf = () => null }) {
  const held = new Map(); // pane -> { seq, from, dialog, menu }: herdr's stateSeq, the blocked one before
  const checked = new Map(); // pane -> { seq, at, read, pending } the last screen read
  const heldSeq = (pane) => (held.get(pane) || {}).seq;

  function read(pane, seq, from) {
    return readScreen('agent.read', { target: pane }, 'visible', 30)
      .then((r) => {
        const ch = heldPrompt(String(r.text || '').replace(/\s+$/, ''));
        const h = held.get(pane);
        if (h && h.seq > seq) return; // a newer state's read has set it already
        const kind = { dialog: Boolean(ch && ch.dialog), menu: Boolean(ch && ch.menu) };
        if (ch) held.set(pane, h && h.seq === seq ? { ...h, ...kind } : { seq, from, ...kind });
        else if (h && h.seq === seq) held.delete(pane);
      })
      .catch(() => {}); // unread: what was held (or herdr's status) stands
  }

  async function hold(a) {
    const h0 = held.get(a.pane);
    if (h0 && a.stateSeq > h0.seq) held.delete(a.pane);
    if (a.agent !== 'claude' || !ASK_STATUSES.has(a.status)) return;
    // One read at a time; a refresh running meanwhile waits for that read.
    let check = checked.get(a.pane);
    const was = wasOf(a.pane);
    // A change herdr reports (to idle or done) is read at once; anything else on the clock.
    const changed = was && was.seq !== a.stateSeq && a.status !== 'working';
    const h = held.get(a.pane);
    const every = h && h.dialog ? HELD_RECHECK_MS : ASK_RECHECK_MS;
    const due = !check || (changed && check.seq !== a.stateSeq) || now() - check.at >= every;
    // A read still on its way for an older state is not this state's read: the new one follows it
    // (one read at a time per pane), rather than waiting for the next 15 s.
    const behind = check && check.pending && check.seq !== a.stateSeq;
    if (due && (!(check && check.pending) || behind)) {
      const pane = a.pane;
      const before = behind ? check.read : null;
      const next = { seq: a.stateSeq, at: now(), pending: true };
      const from = was ? was.seq : null;
      next.read = (before ? before.then(() => read(pane, a.stateSeq, from)) : read(pane, a.stateSeq, from)).finally(() => (next.pending = false));
      check = next;
      checked.delete(pane);
      checked.set(pane, check);
      if (checked.size > 256) checked.delete(checked.keys().next().value);
    }
    if (check) await check.read;
    if (heldSeq(a.pane) === a.stateSeq) {
      a.status = 'blocked';
      // A slash command's menu: someone just opened it; no notification.
      if (held.get(a.pane).menu) a.menu = true;
    }
  }

  // Read the screen again at the next refresh (keys went to it: a dialog may have closed).
  const recheck = (pane) => checked.delete(pane);

  const timers = new Set();
  function watchMenu(pane) {
    for (const ms of MENU_READS_MS) {
      const t = setTimeout(() => {
        timers.delete(t);
        recheck(pane);
        refresh();
      }, ms);
      timers.add(t);
    }
  }

  // A pane that is gone takes its holds and reads with it (herdr reuses no pane id while up).
  function prune(panes) {
    for (const m of [held, checked]) for (const pane of m.keys()) if (!panes.has(pane)) m.delete(pane);
  }

  function close() {
    for (const t of timers) clearTimeout(t);
    timers.clear();
  }

  return { held, hold, recheck, watchMenu, prune, close };
}

module.exports = { askHold, ASK_RECHECK_MS, HELD_RECHECK_MS, MENU_READS_MS };
