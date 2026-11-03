'use strict';
// Photos attached in the agent composer. Each host keeps its own: the agent that reads the
// file runs there. Files live in <tmpdir>/paddock-uploads and are swept after 7 days.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = process.env.PADDOCK_UPLOADS || path.join(os.tmpdir(), 'paddock-uploads');
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

// contentType: the request's Content-Type. Returns { path, name }.
function save(contentType, buf, dir = DIR) {
  const ext = TYPES[String(contentType || '').split(';')[0].trim().toLowerCase()];
  if (!ext) throw bad('bad_image_type', 415);
  if (!buf.length) throw bad('empty_image');
  if (buf.length > MAX_BYTES) throw bad('image_too_large', 413);
  if (sniff(buf) !== ext) throw bad('bad_image_type', 415);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${stamp()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const file = path.join(dir, name);
  fs.writeFileSync(file, buf, { flag: 'wx' });
  return { path: file, name };
}

// A stored file by name, or null. Only names save() makes, so nothing outside DIR.
function find(name, dir = DIR) {
  const m = NAME.exec(String(name || ''));
  if (!m) return null;
  const file = path.join(dir, name);
  try {
    if (!fs.statSync(file).isFile()) return null;
  } catch {
    return null;
  }
  return { file, type: MIME[m[3]] };
}

// Delete uploads older than 7 days. Returns how many went.
function sweep(dir = DIR, now = Date.now()) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  let n = 0;
  for (const name of names) {
    if (!NAME.test(name)) continue;
    const file = path.join(dir, name);
    try {
      if (now - fs.statSync(file).mtimeMs > KEEP_MS) {
        fs.unlinkSync(file);
        n++;
      }
    } catch {
      /* gone already */
    }
  }
  return n;
}

module.exports = { DIR, MAX_BYTES, NAME, save, find, sweep, sniff };
