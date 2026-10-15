const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const webpush = require('web-push');

const KEEP_DAYS = 14;

// Staff-editable settings (Settings page).
const DEFAULT_SETTINGS = {
  washMinutes: 45,
  noShowMinutes: 10,
  dailyLimit: 0, // 0 = no limit
};

// Tiny JSON-file store. Fine for one boarding house's worth of laundry.
class Store {
  constructor(file, defaults = {}) {
    this.file = file;
    this.data = { entries: [], qrToken: null, secret: null, subscriptions: {}, vapid: null, version: 0 };
    if (fs.existsSync(file)) {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    }
    if (!this.data.secret) this.data.secret = crypto.randomBytes(32).toString('hex');
    if (!this.data.qrToken) this.data.qrToken = newToken();
    if (!this.data.vapid) this.data.vapid = webpush.generateVAPIDKeys();
    if (!this.data.displayKey) this.data.displayKey = newToken();
    const saved = this.data.settings || {};
    this.data.settings = Object.fromEntries(
      Object.keys(DEFAULT_SETTINGS).map((k) => [k, saved[k] ?? defaults[k] ?? DEFAULT_SETTINGS[k]]),
    );
    this.save();
  }

  save() {
    this.data.version += 1;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get secret() { return this.data.secret; }
  get qrToken() { return this.data.qrToken; }
  get vapid() { return this.data.vapid; }
  get version() { return this.data.version; }
  get displayKey() { return this.data.displayKey; }
  get settings() { return this.data.settings; }

  updateSettings(changes) {
    this.data.settings = { ...this.data.settings, ...changes };
    this.save();
  }

  rotateQrToken() {
    this.data.qrToken = newToken();
    this.data.displayKey = newToken();
    this.save();
    return this.data.qrToken;
  }

  list(date) {
    return this.data.entries
      .filter((e) => e.date === date)
      .sort((a, b) => order(a) - order(b));
  }

  get(id) {
    return this.data.entries.find((e) => e.id === id);
  }

  add(date, { name, house, deviceId }, at = Date.now()) {
    const entry = {
      id: crypto.randomBytes(8).toString('hex'),
      date,
      name,
      house,
      deviceId,
      status: 'waiting',
      createdAt: at,
      misses: 0,
    };
    this.data.entries.push(entry);
    this.save();
    return entry;
  }

  setStatus(id, status, at = Date.now()) {
    const entry = this.get(id);
    if (!entry) return null;
    entry.status = status;
    entry.calledAt = status === 'called' ? at : null;
    entry.startedAt = status === 'washing' ? at : status === 'done' ? entry.startedAt : null;
    if (status === 'done') entry.doneAt = at;
    this.save();
    return entry;
  }

  // Missed their turn: back of the queue. Returns the updated entry.
  requeue(id, at = Date.now()) {
    const entry = this.get(id);
    if (!entry) return null;
    entry.status = 'waiting';
    entry.calledAt = null;
    entry.queuedAt = at;
    entry.misses = (entry.misses || 0) + 1;
    this.save();
    return entry;
  }

  // --- push subscriptions, keyed by the anonymous device id ---
  subscriptionsFor(deviceId) {
    return this.data.subscriptions[deviceId] || [];
  }

  addSubscription(deviceId, sub) {
    const subs = this.subscriptionsFor(deviceId).filter((s) => s.endpoint !== sub.endpoint);
    this.data.subscriptions[deviceId] = [...subs, sub].slice(-5);
    this.save();
  }

  removeSubscription(endpoint) {
    for (const [device, subs] of Object.entries(this.data.subscriptions)) {
      const kept = subs.filter((s) => s.endpoint !== endpoint);
      if (kept.length) this.data.subscriptions[device] = kept;
      else delete this.data.subscriptions[device];
    }
    this.save();
  }

  remove(id) {
    const before = this.data.entries.length;
    this.data.entries = this.data.entries.filter((e) => e.id !== id);
    if (this.data.entries.length !== before) this.save();
    return this.data.entries.length !== before;
  }

  clear(date) {
    this.data.entries = this.data.entries.filter((e) => e.date !== date);
    this.save();
  }

  prune(today) {
    const cutoff = addDays(today, -KEEP_DAYS);
    const before = this.data.entries.length;
    this.data.entries = this.data.entries.filter((e) => e.date >= cutoff);
    if (this.data.entries.length !== before) this.save();
  }
}

// Queue position: sign-up time, or the time they were sent to the back.
function order(e) {
  return e.queuedAt || e.createdAt;
}

function newToken() {
  return crypto.randomBytes(12).toString('base64url');
}

// Dates are plain YYYY-MM-DD strings in school (UK) time.
function todayIn(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

module.exports = { Store, todayIn, addDays, DEFAULT_SETTINGS };
