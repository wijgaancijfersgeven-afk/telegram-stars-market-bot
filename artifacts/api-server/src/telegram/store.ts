import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";

export type Product = {
  id: number;
  title: string;
  description: string;
  priceStars: number;
  photoFileId: string | null;
  postPurchaseMessage: string;
  active: boolean;
};

export type BotSession = {
  stage: string;
  data: Record<string, unknown>;
};

type PendingOrder = {
  id: number;
  userId: number;
  itemType: "product";
  itemId: number;
  itemTitle: string;
  amountStars: number;
  payload: string;
  status: string;
};

export type PaidReceipt = {
  itemType: "product";
  itemTitle: string;
  postPurchaseMessage: string;
};

export type RecentOrder = {
  userId: number;
  itemTitle: string;
  amountStars: number;
  status: string;
  createdAt: Date;
};

export type BackupProduct = {
  id: number;
  title: string;
  description: string;
  priceStars: number;
  photoFileId: string | null;
  postPurchaseMessage: string;
  active: boolean;
  createdAt: string;
};

export type BackupOrder = {
  id: number;
  userId: number;
  itemType: "product";
  itemId: number;
  itemTitle: string;
  amountStars: number;
  payload: string;
  status: "pending" | "paid";
  telegramChargeId: string | null;
  createdAt: string;
  paidAt: string | null;
};

export type TelegramBackup = {
  format: "telegram-bot-backup";
  version: 2;
  exportedAt: string;
  products: BackupProduct[];
  orders: BackupOrder[];
  settings: Array<{ key: string; value: string }>;
  legacyConversion?: {
    convertedPlans: number;
    ignoredSubscriptions: number;
  };
};

function mapProduct(row: Record<string, unknown>): Product {
  return {
    id: Number(row.id),
    title: String(row.title),
    description: String(row.description),
    priceStars: Number(row.priceStars),
    photoFileId: row.photoFileId == null ? null : String(row.photoFileId),
    postPurchaseMessage: String(row.postPurchaseMessage ?? ""),
    active: Boolean(row.active),
  };
}

const productColumns = `
  id, title, description, price_stars AS "priceStars",
  photo_file_id AS "photoFileId",
  post_purchase_message AS "postPurchaseMessage", active
`;

export async function listProducts(activeOnly = true): Promise<Product[]> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT ${productColumns} FROM telegram_products
     ${activeOnly ? "WHERE active = true" : ""}
     ORDER BY id DESC`,
  );
  return rows.map(mapProduct);
}

export async function getProduct(id: number): Promise<Product | null> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT ${productColumns} FROM telegram_products WHERE id = $1`,
    [id],
  );
  return rows[0] ? mapProduct(rows[0]) : null;
}

export async function createProduct(input: {
  title: string;
  description: string;
  priceStars: number;
  photoFileId: string | null;
  postPurchaseMessage: string;
}): Promise<Product> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `INSERT INTO telegram_products
      (title, description, price_stars, photo_file_id, post_purchase_message)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${productColumns}`,
    [
      input.title,
      input.description,
      input.priceStars,
      input.photoFileId,
      input.postPurchaseMessage,
    ],
  );
  return mapProduct(rows[0] ?? {});
}

export async function setProductMessage(
  id: number,
  message: string,
): Promise<void> {
  await pool.query(
    "UPDATE telegram_products SET post_purchase_message = $1 WHERE id = $2",
    [message, id],
  );
}

export async function toggleProduct(id: number): Promise<Product | null> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `UPDATE telegram_products SET active = NOT active WHERE id = $1
     RETURNING ${productColumns}`,
    [id],
  );
  return rows[0] ? mapProduct(rows[0]) : null;
}

export async function saveSession(
  userId: number,
  stage: string,
  data: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    `INSERT INTO telegram_sessions (user_id, stage, data)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET stage = EXCLUDED.stage, data = EXCLUDED.data,
           updated_at = CURRENT_TIMESTAMP`,
    [userId, stage, JSON.stringify(data)],
  );
}

export async function getSession(userId: number): Promise<BotSession | null> {
  const { rows } = await pool.query<{
    stage: string;
    data: string | Record<string, unknown>;
  }>(
    "SELECT stage, data FROM telegram_sessions WHERE user_id = $1",
    [userId],
  );
  const session = rows[0];
  if (!session) return null;
  return {
    stage: session.stage,
    data:
      typeof session.data === "string"
        ? (JSON.parse(session.data) as Record<string, unknown>)
        : session.data,
  };
}

export async function clearSession(userId: number): Promise<void> {
  await pool.query("DELETE FROM telegram_sessions WHERE user_id = $1", [userId]);
}

export async function createPendingOrder(input: {
  userId: number;
  itemId: number;
  itemTitle: string;
  amountStars: number;
}): Promise<string> {
  const payload = `order:${randomUUID()}`;
  await pool.query(
    `INSERT INTO telegram_orders
      (user_id, item_type, item_id, item_title, amount_stars, payload)
     VALUES ($1, 'product', $2, $3, $4, $5)`,
    [
      input.userId,
      input.itemId,
      input.itemTitle,
      input.amountStars,
      payload,
    ],
  );
  return payload;
}

export async function isValidPreCheckout(input: {
  userId: number;
  payload: string;
  currency: string;
  totalAmount: number;
}): Promise<boolean> {
  const { rows } = await pool.query<PendingOrder>(
    `SELECT id, user_id AS "userId", 'product' AS "itemType",
      item_id AS "itemId", item_title AS "itemTitle",
      amount_stars AS "amountStars", payload, status
     FROM telegram_orders WHERE payload = $1`,
    [input.payload],
  );
  const order = rows[0];
  return Boolean(
    order &&
      order.status === "pending" &&
      Number(order.userId) === input.userId &&
      input.currency === "XTR" &&
      order.amountStars === input.totalAmount,
  );
}

export async function completePayment(input: {
  userId: number;
  payload: string;
  currency: string;
  totalAmount: number;
  chargeId: string;
}): Promise<PaidReceipt | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const duplicate = await client.query<PendingOrder>(
      `SELECT id, user_id AS "userId", 'product' AS "itemType",
        item_id AS "itemId", item_title AS "itemTitle",
        amount_stars AS "amountStars", payload, status
       FROM telegram_orders WHERE telegram_charge_id = $1`,
      [input.chargeId],
    );
    const alreadyProcessed = duplicate.rows[0];
    if (alreadyProcessed) {
      if (alreadyProcessed.payload !== input.payload) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query("COMMIT");
      return loadReceipt(alreadyProcessed);
    }

    const result = await client.query<PendingOrder>(
      `SELECT id, user_id AS "userId", 'product' AS "itemType",
        item_id AS "itemId", item_title AS "itemTitle",
        amount_stars AS "amountStars", payload, status
       FROM telegram_orders WHERE payload = $1`,
      [input.payload],
    );
    const order = result.rows[0];
    if (
      !order ||
      order.status !== "pending" ||
      Number(order.userId) !== input.userId ||
      input.currency !== "XTR" ||
      order.amountStars !== input.totalAmount
    ) {
      await client.query("ROLLBACK");
      return null;
    }

    await client.query(
      `UPDATE telegram_orders
       SET status = 'paid', telegram_charge_id = $1,
           paid_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = $2`,
      [input.chargeId, order.id],
    );

    await client.query("COMMIT");
    return loadReceipt(order);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function loadReceipt(
  order: PendingOrder,
): Promise<PaidReceipt | null> {
  if (order.itemType === "product") {
    const { rows } = await pool.query<{ postPurchaseMessage: string }>(
      `SELECT post_purchase_message AS "postPurchaseMessage"
       FROM telegram_products WHERE id = $1`,
      [order.itemId],
    );
    return rows[0]
      ? {
          itemType: "product",
          itemTitle: order.itemTitle,
          postPurchaseMessage: rows[0].postPurchaseMessage,
        }
      : null;
  }

  return null;
}

export async function getSetting(key: string): Promise<string | null> {
  const { rows } = await pool.query<{ value: string }>(
    "SELECT value FROM telegram_settings WHERE key = $1",
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO telegram_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value],
  );
}

export async function listRecentOrders(): Promise<RecentOrder[]> {
  const { rows } = await pool.query<RecentOrder>(
    `SELECT user_id AS "userId", item_title AS "itemTitle",
      amount_stars AS "amountStars", status, created_at AS "createdAt"
     FROM telegram_orders ORDER BY created_at DESC LIMIT 15`,
  );
  return rows;
}

export async function createBackupSnapshot(): Promise<TelegramBackup> {
  const [products, orders, settings] = await Promise.all([
    pool.query<BackupProduct>(
      `SELECT id, title, description, price_stars AS "priceStars",
        photo_file_id AS "photoFileId",
        post_purchase_message AS "postPurchaseMessage", active,
        created_at AS "createdAt"
       FROM telegram_products ORDER BY id`,
    ),
    pool.query<BackupOrder>(
      `SELECT id, user_id AS "userId", 'product' AS "itemType",
        item_id AS "itemId", item_title AS "itemTitle",
        amount_stars AS "amountStars", payload, status,
        telegram_charge_id AS "telegramChargeId",
        created_at AS "createdAt", paid_at AS "paidAt"
       FROM telegram_orders ORDER BY id`,
    ),
    pool.query<{ key: string; value: string }>(
      "SELECT key, value FROM telegram_settings ORDER BY key",
    ),
  ]);

  return {
    format: "telegram-bot-backup",
    version: 2,
    exportedAt: new Date().toISOString(),
    products: products.rows.map((row) => ({
      ...row,
      active: Boolean(row.active),
      createdAt: new Date(row.createdAt).toISOString(),
    })),
    orders: orders.rows.map((row) => ({
      ...row,
      userId: Number(row.userId),
      createdAt: new Date(row.createdAt).toISOString(),
      paidAt: row.paidAt ? new Date(row.paidAt).toISOString() : null,
    })),
    settings: settings.rows,
  };
}

export async function restoreBackup(snapshot: TelegramBackup): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM telegram_orders");
    await client.query("DELETE FROM telegram_products");
    await client.query("DELETE FROM telegram_settings");

    for (const product of snapshot.products) {
      await client.query(
        `INSERT INTO telegram_products
          (id, title, description, price_stars, photo_file_id,
           post_purchase_message, active, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          product.id,
          product.title,
          product.description,
          product.priceStars,
          product.photoFileId,
          product.postPurchaseMessage,
          product.active,
          product.createdAt,
        ],
      );
    }

    for (const order of snapshot.orders) {
      await client.query(
        `INSERT INTO telegram_orders
          (id, user_id, item_type, item_id, item_title, amount_stars,
           payload, status, telegram_charge_id, created_at, paid_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          order.id,
          order.userId,
          order.itemType,
          order.itemId,
          order.itemTitle,
          order.amountStars,
          order.payload,
          order.status,
          order.telegramChargeId,
          order.createdAt,
          order.paidAt,
        ],
      );
    }

    for (const setting of snapshot.settings) {
      await client.query(
        "INSERT INTO telegram_settings (key, value) VALUES ($1, $2)",
        [setting.key, setting.value],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
