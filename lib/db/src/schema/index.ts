export const sqliteSchema = `
  CREATE TABLE IF NOT EXISTS telegram_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL CHECK (length(title) <= 120),
    description TEXT NOT NULL DEFAULT '',
    price_stars INTEGER NOT NULL CHECK (price_stars BETWEEN 1 AND 1000000000),
    photo_file_id TEXT,
    post_purchase_message TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS telegram_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    item_type TEXT NOT NULL DEFAULT 'product' CHECK (item_type = 'product'),
    item_id INTEGER NOT NULL,
    item_title TEXT NOT NULL,
    amount_stars INTEGER NOT NULL CHECK (amount_stars > 0),
    payload TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
    telegram_charge_id TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    paid_at TEXT
  );

  CREATE TABLE IF NOT EXISTS telegram_sessions (
    user_id INTEGER PRIMARY KEY,
    stage TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS telegram_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS telegram_orders_created_idx
    ON telegram_orders (created_at DESC);
`;