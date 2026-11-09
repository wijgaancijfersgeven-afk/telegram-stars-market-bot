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

export type Plan = {
  id: number;
  title: string;
  description: string;
  priceStars: number;
  periodSeconds: number;
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
  itemType: "product" | "plan";
  itemId: number;
  itemTitle: string;
  amountStars: number;
  payload: string;
  status: string;
};

export type PaidReceipt = {
  itemType: "product" | "plan";
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

export type ActiveSubscription = {
  title: string;
  expiresAt: Date;
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

function mapPlan(row: Record<string, unknown>): Plan {
  return {
    id: Number(row.id),
    title: String(row.title),
    description: String(row.description),
    priceStars: Number(row.priceStars),
    periodSeconds: Number(row.periodSeconds),
    postPurchaseMessage: String(row.postPurchaseMessage ?? ""),
    active: Boolean(row.active),
  };
}

const productColumns = `
  id, title, description, price_stars AS "priceStars",
  photo_file_id AS "photoFileId",
  post_purchase_message AS "postPurchaseMessage", active
`;

const planColumns = `
  id, title, description, price_stars AS "priceStars",
  period_seconds AS "periodSeconds",
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

export async function listPlans(activeOnly = true): Promise<Plan[]> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT ${planColumns} FROM telegram_plans
     ${activeOnly ? "WHERE active = true" : ""}
     ORDER BY id DESC`,
  );
  return rows.map(mapPlan);
}

export async function getPlan(id: number): Promise<Plan | null> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT ${planColumns} FROM telegram_plans WHERE id = $1`,
    [id],
  );
  return rows[0] ? mapPlan(rows[0]) : null;
}

export async function createPlan(input: {
  title: string;
  description: string;
  priceStars: number;
  postPurchaseMessage: string;
}): Promise<Plan> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `INSERT INTO telegram_plans
      (title, description, price_stars, period_seconds, post_purchase_message)
     VALUES ($1, $2, $3, 2592000, $4)
     RETURNING ${planColumns}`,
    [input.title, input.description, input.priceStars, input.postPurchaseMessage],
  );
  return mapPlan(rows[0] ?? {});
}

export async function setPlanMessage(id: number, message: string): Promise<void> {
  await pool.query(
    "UPDATE telegram_plans SET post_purchase_message = $1 WHERE id = $2",
    [message, id],
  );
}

export async function togglePlan(id: number): Promise<Plan | null> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `UPDATE telegram_plans SET active = NOT active WHERE id = $1
     RETURNING ${planColumns}`,
    [id],
  );
  return rows[0] ? mapPlan(rows[0]) : null;
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
       SET stage = EXCLUDED.stage, data = EXCLUDED.data, updated_at = NOW()`,
    [userId, stage, JSON.stringify(data)],
  );
}

export async function getSession(userId: number): Promise<BotSession | null> {
  const { rows } = await pool.query<{ stage: string; data: Record<string, unknown> }>(
    "SELECT stage, data FROM telegram_sessions WHERE user_id = $1",
    [userId],
  );
  return rows[0] ?? null;
}

export async function clearSession(userId: number): Promise<void> {
  await pool.query("DELETE FROM telegram_sessions WHERE user_id = $1", [userId]);
}

export async function createPendingOrder(input: {
  userId: number;
  itemType: "product" | "plan";
  itemId: number;
  itemTitle: string;
  amountStars: number;
}): Promise<string> {
  const payload = `order:${randomUUID()}`;
  await pool.query(
    `INSERT INTO telegram_orders
      (user_id, item_type, item_id, item_title, amount_stars, payload)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.userId,
      input.itemType,
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
    `SELECT id, user_id AS "userId", item_type AS "itemType",
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
  subscriptionExpirationDate?: number;
}): Promise<PaidReceipt | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const duplicate = await client.query<PendingOrder>(
      `SELECT id, user_id AS "userId", item_type AS "itemType",
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
      `SELECT id, user_id AS "userId", item_type AS "itemType",
        item_id AS "itemId", item_title AS "itemTitle",
        amount_stars AS "amountStars", payload, status
       FROM telegram_orders WHERE payload = $1 FOR UPDATE`,
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
       SET status = 'paid', telegram_charge_id = $1, paid_at = NOW()
       WHERE id = $2`,
      [input.chargeId, order.id],
    );

    if (order.itemType === "plan") {
      const planResult = await client.query<{ periodSeconds: number }>(
        `SELECT period_seconds AS "periodSeconds"
         FROM telegram_plans WHERE id = $1`,
        [order.itemId],
      );
      const seconds = planResult.rows[0]?.periodSeconds ?? 2_592_000;
      const expiresAt = input.subscriptionExpirationDate
        ? new Date(input.subscriptionExpirationDate * 1000)
        : new Date(Date.now() + seconds * 1000);

      await client.query(
        `INSERT INTO telegram_subscriptions (user_id, plan_id, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, plan_id) DO UPDATE
           SET expires_at = EXCLUDED.expires_at, updated_at = NOW()`,
        [input.userId, order.itemId, expiresAt],
      );
    }

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

  if (order.itemType === "plan") {
    const { rows } = await pool.query<{ postPurchaseMessage: string }>(
      `SELECT post_purchase_message AS "postPurchaseMessage"
       FROM telegram_plans WHERE id = $1`,
      [order.itemId],
    );
    return rows[0]
      ? {
          itemType: "plan",
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

export async function listActiveSubscriptions(): Promise<
  Array<{ userId: number; title: string; expiresAt: Date }>
> {
  const { rows } = await pool.query<{
    userId: number;
    title: string;
    expiresAt: Date;
  }>(
    `SELECT s.user_id AS "userId", p.title,
      s.expires_at AS "expiresAt"
     FROM telegram_subscriptions s
     JOIN telegram_plans p ON p.id = s.plan_id
     WHERE s.expires_at > NOW()
     ORDER BY s.expires_at ASC LIMIT 15`,
  );
  return rows;
}

export async function listUserSubscriptions(
  userId: number,
): Promise<ActiveSubscription[]> {
  const { rows } = await pool.query<ActiveSubscription>(
    `SELECT p.title, s.expires_at AS "expiresAt"
     FROM telegram_subscriptions s
     JOIN telegram_plans p ON p.id = s.plan_id
     WHERE s.user_id = $1 AND s.expires_at > NOW()
     ORDER BY s.expires_at ASC`,
    [userId],
  );
  return rows;
}
