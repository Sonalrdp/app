import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const dbDir = path.resolve(rootDir, 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = process.env.DB_PATH 
  ? path.resolve(rootDir, process.env.DB_PATH) 
  : path.resolve(dbDir, 'gateway.sqlite');

export const db = new DatabaseSync(dbPath);

// Enable WAL mode for high concurrency
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_credentials (
    id TEXT PRIMARY KEY,
    api_key TEXT UNIQUE NOT NULL,
    access_token TEXT UNIQUE NOT NULL,
    merchant_name TEXT DEFAULT 'Live Merchant',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    order_id TEXT PRIMARY KEY,
    product_id TEXT,
    product_name TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'INR',
    customer_name TEXT,
    customer_email TEXT,
    customer_phone TEXT,
    upi_vpa TEXT,
    upi_string TEXT,
    status TEXT DEFAULT 'PENDING',
    utr TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL,
    paid_at TEXT
  );

  CREATE TABLE IF NOT EXISTS observer_logs (
    id TEXT PRIMARY KEY,
    sender TEXT,
    raw_message TEXT NOT NULL,
    amount REAL,
    utr TEXT,
    payer_vpa TEXT,
    matched_order_id TEXT,
    status TEXT DEFAULT 'RECEIVED',
    created_at TEXT NOT NULL
  );
`);

// Seed default settings if missing
const defaultSettings = [
  ['upi_vpa', process.env.UPI_VPA || 'merchant@upi'],
  ['upi_name', process.env.UPI_NAME || 'Cortex Store'],
  ['merchant_api_key', process.env.MERCHANT_API_KEY || 'ctx_live_key_' + crypto.randomBytes(4).toString('hex')],
  ['admin_passkey', process.env.ADMIN_PASSKEY || 'admin123'],
  ['webhook_url', process.env.WEBHOOK_URL || ''],
  ['webhook_secret', process.env.WEBHOOK_SECRET || 'ctx_wh_sec_' + crypto.randomBytes(8).toString('hex')],
  ['store_name', 'Cortex UPI Payment Gateway']
];

const checkSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');

for (const [k, v] of defaultSettings) {
  const row = checkSetting.get(k);
  if (!row) {
    insertSetting.run(k, v);
  }
}

// Seed initial API credential if none exists
const credCount = db.prepare('SELECT COUNT(*) as count FROM api_credentials').get();
if (Number(credCount.count) === 0) {
  const insertCred = db.prepare(`
    INSERT INTO api_credentials (id, api_key, access_token, merchant_name, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertCred.run(
    'cred_default',
    'ctx_live_' + crypto.randomBytes(8).toString('hex'),
    'ctx_sec_token_' + crypto.randomBytes(16).toString('hex'),
    'Primary Merchant Account',
    new Date().toISOString()
  );
}

// Export Settings Helper
export const Settings = {
  get(key, defaultValue = '') {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : defaultValue;
  },
  getAll() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const map = {};
    for (const r of rows) map[r.key] = r.value;
    return map;
  },
  set(key, value) {
    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, String(value));
  }
};

// Export API Credentials Helper
export const ApiCredentials = {
  getLatest() {
    return db.prepare('SELECT * FROM api_credentials ORDER BY created_at DESC LIMIT 1').get();
  },
  getAll() {
    return db.prepare('SELECT * FROM api_credentials ORDER BY created_at DESC').all();
  },
  create(name = 'New Merchant Integration') {
    const id = 'cred_' + Date.now().toString(36);
    const apiKey = 'ctx_live_' + crypto.randomBytes(8).toString('hex');
    const accessToken = 'ctx_sec_token_' + crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO api_credentials (id, api_key, access_token, merchant_name, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, apiKey, accessToken, name, now);

    return { id, api_key: apiKey, access_token: accessToken, merchant_name: name, created_at: now };
  },
  validate(keyOrToken) {
    if (!keyOrToken) return false;
    const clean = String(keyOrToken).replace(/^Bearer\s+/i, '').trim();
    const row = db.prepare('SELECT id FROM api_credentials WHERE api_key = ? OR access_token = ?').get(clean, clean);
    return !!row;
  }
};

// Export Orders Helper
export const Orders = {
  create({ order_id, product_name, amount, customer_name, customer_email, customer_phone, upi_vpa, upi_string, metadata }) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO orders (
        order_id, product_name, amount, currency,
        customer_name, customer_email, customer_phone, upi_vpa,
        upi_string, status, metadata, created_at
      ) VALUES (?, ?, ?, 'INR', ?, ?, ?, ?, ?, 'PENDING', ?, ?)
    `).run(
      order_id,
      product_name || 'UPI Payment',
      Number(amount),
      customer_name || 'Customer',
      customer_email || '',
      customer_phone || '',
      upi_vpa,
      upi_string,
      typeof metadata === 'object' ? JSON.stringify(metadata) : (metadata || null),
      now
    );
    return this.getById(order_id);
  },
  getById(order_id) {
    const row = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(order_id);
    if (!row) return null;
    return {
      ...row,
      metadata: row.metadata ? (() => { try { return JSON.parse(row.metadata); } catch { return row.metadata; } })() : null
    };
  },
  getAll(limit = 100) {
    const rows = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?').all(limit);
    return rows.map(r => ({
      ...r,
      metadata: r.metadata ? (() => { try { return JSON.parse(r.metadata); } catch { return r.metadata; } })() : null
    }));
  },
  markPaid(order_id, utr) {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE orders
      SET status = 'PAID', utr = ?, paid_at = ?
      WHERE order_id = ?
    `).run(utr, now, order_id);
    return this.getById(order_id);
  },
  updateStatus(order_id, status, utr = null) {
    const now = status === 'PAID' ? new Date().toISOString() : null;
    db.prepare(`
      UPDATE orders
      SET status = ?, utr = COALESCE(?, utr), paid_at = COALESCE(?, paid_at)
      WHERE order_id = ?
    `).run(status, utr, now, order_id);
    return this.getById(order_id);
  },
  getStats() {
    const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
    const paidOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'PAID'").get().count;
    const pendingOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'PENDING'").get().count;
    const volumeRow = db.prepare("SELECT SUM(amount) as total FROM orders WHERE status = 'PAID'").get();
    const totalVolume = volumeRow && volumeRow.total ? Number(volumeRow.total) : 0;

    return {
      totalOrders: Number(totalOrders),
      paidOrders: Number(paidOrders),
      pendingOrders: Number(pendingOrders),
      totalVolume: Number(totalVolume.toFixed(2)),
      conversionRate: totalOrders > 0 ? Number(((paidOrders / totalOrders) * 100).toFixed(1)) : 0
    };
  },
  clearAll() {
    db.prepare('DELETE FROM orders').run();
    return true;
  }
};

// Export Observer Logs Helper (for MacroDroid and Banking Alerts)
export const ObserverLogs = {
  create({ sender, raw_message, amount, utr, payer_vpa, matched_order_id, status }) {
    const id = 'msg_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO observer_logs (id, sender, raw_message, amount, utr, payer_vpa, matched_order_id, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      sender || 'MacroDroid',
      raw_message || '',
      amount ? Number(amount) : null,
      utr || null,
      payer_vpa || null,
      matched_order_id || null,
      status || 'RECEIVED',
      now
    );
    return this.getById(id);
  },
  getById(id) {
    return db.prepare('SELECT * FROM observer_logs WHERE id = ?').get(id);
  },
  getAll(limit = 100) {
    return db.prepare('SELECT * FROM observer_logs ORDER BY created_at DESC LIMIT ?').all(limit);
  },
  getCount() {
    const row = db.prepare('SELECT COUNT(*) as count FROM observer_logs').get();
    return row ? Number(row.count) : 0;
  },
  clearAll() {
    db.prepare('DELETE FROM observer_logs').run();
    return true;
  }
};
