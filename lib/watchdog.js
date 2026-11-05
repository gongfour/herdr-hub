'use strict';
// A thread that kills the process when the main thread stops running JavaScript. A synchronous
// call that never returns (2026-11-05: a readdir in a folder macOS guards) leaves the process
// alive at 0% CPU: nothing answers, SIGTERM is never handled, and the supervisor (launchd
// KeepAlive on server, run.cmd's loop on desktop) restarts only a process that exited.
//
// The main thread bumps a counter in shared memory every second and writes the request it last
// started there (method and path). The worker checks every second; when the counter has not moved
// for `ms`, it writes one line to stderr and SIGKILLs the process. In a worker, process.exit()
// would end only the worker; process.kill(process.pid) ends the whole process.
// HERDR_HUB_WATCHDOG_MS: the timeout (default 30000); 0 turns it off.

const { Worker, isMainThread, workerData } = require('worker_threads');

const DEFAULT_MS = 30000;
const REQ_BYTES = 240;

let shared = null; // { beat: Int32Array, req: Uint8Array }
const enc = new TextEncoder();

function start({ ms = DEFAULT_MS, beatMs = 1000 } = {}) {
  if (!isMainThread || shared || !(ms > 0)) return null;
  const sab = new SharedArrayBuffer(8 + REQ_BYTES);
  shared = { beat: new Int32Array(sab, 0, 2), req: new Uint8Array(sab, 8, REQ_BYTES) };
  const worker = new Worker(__filename, { workerData: { sab, ms, beatMs, reqBytes: REQ_BYTES }, execArgv: [] });
  worker.unref();
  worker.on('error', (err) => console.error(`watchdog: ${err.message}`));
  setInterval(() => Atomics.add(shared.beat, 0, 1), beatMs).unref();
  console.log(`watchdog: exits after ${ms} ms without a heartbeat`);
  return worker;
}

// The request the main thread started last, for the watchdog's line. Cheap: one encodeInto.
function request(label) {
  if (!shared) return;
  const { written } = enc.encodeInto(label.slice(0, REQ_BYTES), shared.req);
  if (written < REQ_BYTES) shared.req[written] = 0;
  Atomics.store(shared.beat, 1, Math.floor(Date.now() / 1000) % 2 ** 31);
}

function watch({ sab, ms, beatMs, reqBytes }) {
  const fs = require('fs');
  const beat = new Int32Array(sab, 0, 2);
  const req = new Uint8Array(sab, 8, reqBytes);
  let last = Atomics.load(beat, 0);
  let seen = Date.now();
  let tick = seen;
  const every = Math.min(beatMs, 1000);
  setInterval(() => {
    const now = Date.now();
    // This thread itself was paused too (the machine slept, the process was stopped): the main
    // thread gets a fresh allowance rather than being blamed for the gap.
    const paused = now - tick > every * 3 + 2000;
    tick = now;
    const b = Atomics.load(beat, 0);
    if (b !== last || paused) {
      last = b;
      seen = now;
      return;
    }
    if (now - seen < ms) return;
    const end = req.indexOf(0);
    const label = Buffer.from(req.subarray(0, end < 0 ? reqBytes : end)).toString('utf8');
    const at = Atomics.load(beat, 1);
    const ago = at ? `${Math.floor(now / 1000) - at}s ago` : 'none';
    // console.* in a worker goes through the main thread, which is stuck: write straight to fd 2.
    try {
      fs.writeSync(2, `${new Date(now).toISOString()} watchdog: main thread silent for ${now - seen} ms; last request started: ${label || '-'} (${ago}); killing the process so it restarts\n`);
    } catch {}
    process.kill(process.pid, 'SIGKILL');
  }, every);
}

if (!isMainThread && workerData && workerData.sab) watch(workerData);

module.exports = { start, request, DEFAULT_MS };
