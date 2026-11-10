'use strict';
// Web Push with VAPID keys generated on first run and kept in data/.

const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const jsonfile = require('./jsonfile');

const MAX_SUBS = 50;

class Push {
  constructor(dataDir, subject) {
    this.dataDir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    this.keysFile = path.join(dataDir, 'vapid.json');
    this.subsFile = path.join(dataDir, 'subscriptions.json');
    // Made on first run. A broken file (set aside as .bad) gets new keys: the devices' old
    // subscriptions stop working and they subscribe again, but the hub starts.
    let keys = jsonfile.read(this.keysFile, { log: (m) => console.error(`push: ${m}`) });
    if (!keys || typeof keys.publicKey !== 'string' || typeof keys.privateKey !== 'string') {
      keys = webpush.generateVAPIDKeys();
      fs.writeFileSync(`${this.keysFile}.tmp`, JSON.stringify(keys, null, 2), { mode: 0o600 });
      fs.renameSync(`${this.keysFile}.tmp`, this.keysFile);
    }
    this.keys = keys;
    webpush.setVapidDetails(subject, this.keys.publicKey, this.keys.privateKey);
    // A cut-short or broken file: set aside, no devices (they subscribe again from 설정 → 알림).
    const subs = jsonfile.read(this.subsFile, { fallback: [], log: (m) => console.error(`push: ${m}`) });
    this.subs = Array.isArray(subs) ? subs.filter((s) => s && typeof s.endpoint === 'string' && s.keys) : [];
    this.write = jsonfile.writer(this.subsFile, { mode: 0o600 });
  }

  get publicKey() {
    return this.keys.publicKey;
  }

  // The list as it is now, written in the background (the next save carries any later change).
  save() {
    return this.write(this.subs).catch((err) => console.error('push: subscriptions save failed:', err.message));
  }

  // A browser's PushSubscription: an https endpoint and its two keys, and the language that device
  // shows the page in (notifications in it; 'ko' unless 'en'). At most MAX_SUBS devices: a new
  // one past that pushes out the one subscribed longest ago.
  add(sub) {
    const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
    let https = false;
    try {
      https = new URL(sub.endpoint).protocol === 'https:';
    } catch {}
    if (!sub || !str(sub.endpoint, 2048) || !https || !sub.keys || !str(sub.keys.p256dh, 256) || !str(sub.keys.auth, 128))
      throw Object.assign(new Error('bad_subscription'), { status: 400, code: 'bad_subscription' });
    this.subs = this.subs.filter((s) => s.endpoint !== sub.endpoint);
    this.subs.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, lang: sub.lang === 'en' ? 'en' : 'ko', added: new Date().toISOString() });
    if (this.subs.length > MAX_SUBS) this.subs = this.subs.slice(-MAX_SUBS);
    return this.save();
  }

  remove(endpoint) {
    this.subs = this.subs.filter((s) => s.endpoint !== endpoint);
    return this.save();
  }

  has(endpoint) {
    return this.subs.some((s) => s.endpoint === endpoint);
  }

  // Every registered device (agent notifications). payload: the payload, or (lang) => the payload
  // in that language, made once per language the devices use.
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
    const bodies = new Map(); // lang -> JSON
    const bodyFor = (s) => {
      const lang = s.lang === 'en' ? 'en' : 'ko';
      if (!bodies.has(lang)) bodies.set(lang, JSON.stringify(typeof payload === 'function' ? payload(lang) : payload));
      return bodies.get(lang);
    };
    const gone = [];
    let sent = 0;
    await Promise.all(
      subs.map((s) =>
        webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, bodyFor(s), { TTL: 3600, urgency: 'high' }).then(() => sent++, (err) => {
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
