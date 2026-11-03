'use strict';
// Viewport snapshots from the phone (public/diag.js, temporary), for checking the keyboard
// layout without a debugger: one JSON line per snapshot in <data>/viewport.log. Past the cap the
// file becomes viewport.log.1 (the older one goes), so about 1 MB in all.

const fs = require('fs');
const path = require('path');

const MAX = 512 * 1024;

function viewportLog(dir) {
  const file = path.join(dir, 'viewport.log');
  return function append(entry) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      let size = 0;
      try {
        size = fs.statSync(file).size;
      } catch {
        /* first line */
      }
      if (size > MAX) fs.renameSync(file, `${file}.1`);
      fs.appendFileSync(file, JSON.stringify(entry) + '\n');
    } catch {
      /* diagnostics must never break the app */
    }
  };
}

module.exports = { viewportLog };
