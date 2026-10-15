const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEEP_DAYS = 14;

// Tiny JSON-file store. Fine for one boarding house's worth of laundry.
class Store {
  constructor(file) {
    this.file = file;
    this.data = { entries: [], qrToken: null, secret: null };
    if (fs.existsSync(file)) {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    }
    if (!this.data.secret) this.data.secret = crypto.randomBytes(32).toString('hex');
    if (!this.data.qrToken) this.data.qrToken = newToken();
    this.save();
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get secret() { return this.data.secret; }
  get qrToken() { return this.data.qrToken; }

  rotateQrToken() {
    this.data.qrToken = newToken();
    this.save();
    return this.data.qrToken;
  }

  list(date) {
    return this.data.entries
      .filter((e) => e.date === date)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  get(id) {
    return this.data.entries.find((e) => e.id === id);
  }

  add(date, { name, house, deviceId }) {
    const entry = {
      id: crypto.randomBytes(8).toString('hex'),
      date,
      name,
      house,
      deviceId,
      status: 'waiting',
      createdAt: Date.now(),
    };
    this.data.entries.push(entry);
    this.save();
    return entry;
  }

  setStatus(id, status) {
    const entry = this.get(id);
    if (!entry) return null;
    entry.status = status;
    this.save();
    return entry;
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

module.exports = { Store, todayIn, addDays };
