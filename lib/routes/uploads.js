'use strict';
// Photos for the agent composer, kept on this host for the agent here to read.
const fs = require('fs');
const uploads = require('../uploads');
const { route } = require('../router');
const { send, readRaw } = require('../http');

module.exports = (hub) => [
  route('POST', 'uploads', async (req, res) => {
    const body = await readRaw(req, uploads.MAX_BYTES);
    return send(res, 200, await uploads.save(req.headers['content-type'], body, hub.uploadsDir));
  }),
  route('GET', 'uploads/:name', async (req, res, { params: { name } }) => {
    const f = await uploads.find(name, hub.uploadsDir);
    if (!f) return send(res, 404, { error: 'not_found' });
    // Names are never reused, so the phone may keep a copy.
    return fs.readFile(f.file, (err, data) =>
      err ? send(res, 404, { error: 'not_found' }) : send(res, 200, data, { 'Content-Type': f.type, 'Cache-Control': 'private, max-age=604800, immutable', 'X-Content-Type-Options': 'nosniff' })
    );
  }),
];
