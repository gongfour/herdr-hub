'use strict';
// Photos attached in the agent composer. Each host keeps its own: the agent that reads the
// file runs there. Files live in the hub's data/uploads (HERDR_HUB_UPLOADS to move it; the hub
// sets it, lib/hub.js), readable by this user only, and are swept after 7 days. Until 1.0 they
// were in the system's temp folder (<tmpdir>/herdr-hub-uploads, earlier paddock-uploads): a
// photo still there is found too, until the sweep takes it, so chats keep their thumbnails.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OLD_DIRS = [path.join(os.tmpdir(), 'herdr-hub-uploads'), path.join(os.tmpdir(), 'paddock-uploads')];
const dirOf = (dataDir, env = {}) => env.HERDR_HUB_UPLOADS || path.join(dataDir, 'uploads');
const MAX_BYTES = 10 * 1024 * 1024;
const KEEP_MS = 7 * 24 * 3600 * 1000;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const NAME = /^(\d{8}-\d{6})-([0-9a-f]{8})\.(jpg|png|webp)$/;

const bad = (code, status = 400) => Object.assign(new Error(code), { status, code });

// The bytes must be what the Content-Type says.
function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) return 'png';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

const pad = (n) => String(n).padStart(2, '0');
function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// contentType: the request's Content-Type. Returns { path, name }. Asynchronous like every
// filesystem call on a request path (AGENTS.md).
async function save(contentType, buf, dir) {
  const ext = TYPES[String(contentType || '').split(';')[0].trim().toLowerCase()];
  if (!ext) throw bad('bad_image_type', 415);
  if (!buf.length) throw bad('empty_image');
  if (buf.length > MAX_BYTES) throw bad('image_too_large', 413);
  if (sniff(buf) !== ext) throw bad('bad_image_type', 415);
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  const name = `${stamp()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const file = path.join(dir, name);
  await fs.promises.writeFile(file, buf, { flag: 'wx', mode: 0o600 });
  return { path: file, name };
}

// A stored file by name, or null: in dir, else in the old temp folders. Only names save() makes,
// so nothing outside them.
async function find(name, dir, old = OLD_DIRS) {
  const m = NAME.exec(String(name || ''));
  if (!m) return null;
  for (const d of [dir, ...old]) {
    const file = path.join(d, name);
    try {
      if ((await fs.promises.stat(file)).isFile()) return { file, type: MIME[m[3]] };
    } catch {
      /* not here */
    }
  }
  return null;
}

// Delete uploads older than 7 days. Returns how many went.
async function sweep(dir, now = Date.now()) {
  let names;
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return 0;
  }
  let n = 0;
  for (const name of names) {
    if (!NAME.test(name)) continue;
    const file = path.join(dir, name);
    try {
      if (now - (await fs.promises.stat(file)).mtimeMs > KEEP_MS) {
        await fs.promises.unlink(file);
        n++;
      }
    } catch {
      /* gone already */
    }
  }
  return n;
}

module.exports = { OLD_DIRS, dirOf, MAX_BYTES, NAME, save, find, sweep, sniff };
