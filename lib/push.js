'use strict';
// Web Push with VAPID keys generated on first run and kept in data/.

const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

class Push {
  constructor(dataDir, subject) {
    this.dataDir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    this.keysFile = path.join(dataDir, 'vapid.json');
    this.subsFile = path.join(dataDir, 'subscriptions.json');
    if (!fs.existsSync(this.keysFile)) {
      fs.writeFileSync(this.keysFile, JSON.stringify(webpush.generateVAPIDKeys(), null, 2), { mode: 0o600 });
    }
    this.keys = JSON.parse(fs.readFileSync(this.keysFile, 'utf8'));
    webpush.setVapidDetails(subject, this.keys.publicKey, this.keys.privateKey);
    this.subs = fs.existsSync(this.subsFile) ? JSON.parse(fs.readFileSync(this.subsFile, 'utf8')) : [];
  }

  get publicKey() {
    return this.keys.publicKey;
  }

  save() {
    fs.writeFileSync(this.subsFile, JSON.stringify(this.subs, null, 2), { mode: 0o600 });
  }

  add(sub) {
    if (!sub || typeof sub.endpoint !== 'string' || !sub.keys) throw new Error('invalid subscription');
    this.subs = this.subs.filter((s) => s.endpoint !== sub.endpoint);
    this.subs.push({ endpoint: sub.endpoint, keys: sub.keys, added: new Date().toISOString() });
    this.save();
  }

  remove(endpoint) {
    this.subs = this.subs.filter((s) => s.endpoint !== endpoint);
    this.save();
  }

  has(endpoint) {
    return this.subs.some((s) => s.endpoint === endpoint);
  }

  // Every registered device (agent notifications).
  send(payload) {
    return this.deliver(this.subs, payload);
  }

  // One device only (시험 알림 from that device). Unknown endpoint: nothing is sent.
  async sendTo(endpoint, payload) {
    const subs = this.subs.filter((s) => s.endpoint === endpoint);
    if (!subs.length) return { sent: 0, removed: 0, found: false };
    return { ...(await this.deliver(subs, payload)), found: true };
  }

  async deliver(subs, payload) {
    const body = JSON.stringify(payload);
    const gone = [];
    let sent = 0;
    await Promise.all(
      subs.map((s) =>
        webpush.sendNotification(s, body, { TTL: 3600, urgency: 'high' }).then(() => sent++, (err) => {
          if (err.statusCode === 404 || err.statusCode === 410) gone.push(s.endpoint);
          else console.error('push failed', err.statusCode || '', err.body || err.message);
        })
      )
    );
    if (gone.length) {
      this.subs = this.subs.filter((s) => !gone.includes(s.endpoint));
      this.save();
    }
    return { sent, removed: gone.length };
  }
}

module.exports = { Push };
