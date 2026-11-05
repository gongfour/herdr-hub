'use strict';
// Herdr Hub: serves the web app and a small JSON API over the local herdr server.
// Listens on loopback only; `tailscale serve` provides HTTPS and identity.
// This file is the process: the hub itself is lib/hub.js (createServer), its API lib/routes/.

// Filesystem calls on request paths are asynchronous (lib/fsq.js) and each may hold a libuv pool
// thread while a guarded or dead folder keeps it waiting; 16 threads, not 4, so a few stuck ones
// leave room for the rest. Read when the pool first starts; the launchers set it too.
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';

const herdr = require('./lib/herdr');
const uploads = require('./lib/uploads');
const watchdog = require('./lib/watchdog');
const { createServer } = require('./lib/hub');

let hub;
try {
  hub = createServer({ herdr, env: process.env });
} catch (err) {
  console.error(err.message);
  process.exit(2);
}

// Old photos go at start and once a day.
uploads.sweep();
setInterval(() => uploads.sweep(), 24 * 3600 * 1000).unref();

// A main thread that stops running JavaScript (a synchronous call that never returns) cannot
// answer anything, and the supervisor (launchd KeepAlive, run.cmd's loop) only restarts a process
// that exited: the watchdog thread kills it then (lib/watchdog.js).
watchdog.start({ ms: process.env.HERDR_HUB_WATCHDOG_MS == null ? undefined : Number(process.env.HERDR_HUB_WATCHDOG_MS) });

const HOST = process.env.HOST || '127.0.0.1';
hub.listen(HOST, () => {
  const C = hub.config;
  const { BUILD } = hub;
  console.log(`herdr-hub on http://${HOST}:${hub.port} (herdr socket ${herdr.defaultSocketPath()})`);
  console.log(C.ALLOWED.length ? `allowed tailscale logins: ${C.ALLOWED.join(', ')}` : 'local access only');
  console.log(`hosts: ${[...C.HOST_RULE.allowed, ...C.HOST_RULE.suffixes.map((x) => `*${x}`)].join(', ')}`);
  console.log(`build ${BUILD.version}${BUILD.dirty ? '+dirty' : ''} ${BUILD.commit} (${BUILD.from}); API ${hub.hub.API_VERSION}`);
  console.log(`host ${C.HOST_ID} (${C.HOSTNAME}); push ${hub.hub.push ? 'on' : 'off'}${C.PUSH_MUTE.length ? ` (muted: ${C.PUSH_MUTE.join(', ')})` : ''}; peers (${hub.peerStore.from}${hub.peerStore.manageable ? '' : ', not a hub'}): ${[...hub.hub.peers.values()].map((p) => `${p.id}=${p.url}`).join(', ') || 'none'}`);
});

// A promise nobody awaited that fails (a stray async callback): logged with its stack and the hub
// keeps serving: the request it came from, if any, has already been answered or timed out, and no
// state is left half-written by a rejection. A thrown exception is different: it can stop a
// function midway through changing state, so it is logged and the process exits (code 1) for
// launchd / run.cmd's loop to start it again, as Node would have done, only now with a time stamp.
process.on('unhandledRejection', (err) => {
  console.error(`${new Date().toISOString()} unhandled rejection:`, err && err.stack ? err.stack : err);
});
process.on('uncaughtException', (err) => {
  console.error(`${new Date().toISOString()} uncaught exception, exiting:`, err && err.stack ? err.stack : err);
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => {
    hub.stopFollowing();
    process.exit(0);
  });
