'use strict';
// Preloaded (node -r) into a test server by test/nohang.test.js.
//   HUB_TEST_BLOCK_AFTER_MS: block the main thread for good after that long (Atomics.wait),
//     as a synchronous readdir in a guarded folder did; the watchdog must kill the process.
//   HUB_TEST_STUCK_DIR: fs.promises.readdir/stat/opendir of that path never answer, as a guarded
//     folder's do; requests that touch it must give up while the rest of the server answers.
const fs = require('fs');
const path = require('path');
const { isMainThread } = require('worker_threads');
if (!isMainThread) return; // not in the watchdog's thread

const after = Number(process.env.HUB_TEST_BLOCK_AFTER_MS || 0);
if (after > 0) setTimeout(() => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0), after);

const stuck = process.env.HUB_TEST_STUCK_DIR && path.resolve(process.env.HUB_TEST_STUCK_DIR);
if (stuck) {
  const never = () => new Promise(() => {});
  for (const name of ['readdir', 'opendir']) {
    const real = fs.promises[name];
    fs.promises[name] = (p, ...rest) => (path.resolve(String(p)) === stuck ? never() : real.call(fs.promises, p, ...rest));
  }
}
