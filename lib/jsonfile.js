'use strict';
// The Hub's own JSON files in data/ (subscriptions, the peer list): read once at start, written
// whole and atomically after a change.
//   read(file, { fallback, log }): the parsed file, or fallback when there is none. A file that is
//     not JSON (a write cut short by a crash or a kill, a bad hand edit) is moved aside to
//     <file>.bad and fallback is used: a hub must start, not exit on its own data.
//   writer(file, { mode, space }): save(value) -> a promise. Async (never on the request path's thread),
//     one write at a time in the order asked, each to <file>.tmp then renamed over the file, so a
//     crash halfway leaves the previous file whole. Rejects when the write fails.
const fs = require('fs');
const path = require('path');

function read(file, { fallback = null, log = () => {} } = {}) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') log(`${path.basename(file)} unreadable: ${err.message}`);
    return fallback;
  }
  try {
    return JSON.parse(text);
  } catch {
    log(`${path.basename(file)} is not JSON; starting without it (kept as ${path.basename(file)}.bad)`);
    try {
      fs.renameSync(file, `${file}.bad`);
    } catch {}
    return fallback;
  }
}

// space: JSON.stringify's (2 by default; 0 for a file written often and read by no one).
function writer(file, { mode, space = 2 } = {}) {
  let chain = Promise.resolve();
  return function save(value) {
    const body = JSON.stringify(value, null, space || undefined) + '\n';
    const done = chain.then(async () => {
      const tmp = `${file}.tmp`;
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(tmp, body, mode ? { mode } : undefined);
      await fs.promises.rename(tmp, file);
    });
    chain = done.catch(() => {});
    return done;
  };
}

module.exports = { read, writer };
