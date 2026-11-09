import type {
  BackupOrder,
  BackupProduct,
  BackupSubscription,
  TelegramBackup,
} from "./store";

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return Number(value);
}

function timestamp(value: unknown, label: string): string {
  const date = text(value, label, 64);
  if (!Number.isFinite(Date.parse(date))) {
    throw new Error(`${label} is not a valid date.`);
  }
  return new Date(date).toISOString();
}

function list(value: unknown, label: string, maxLength: number): unknown[] {
  if (!Array.isArray(value) || value.length > maxLength) {
    throw new Error(`${label} is invalid or too large.`);
  }
  return value;
}

function parseProduct(value: unknown): BackupProduct {
  const item = record(value, "Product");
  const photoFileId =
    item.photoFileId === null
      ? null
      : text(item.photoFileId, "Product photoFileId", 512);
  if (typeof item.active !== "boolean") {
    throw new Error("Product active flag is invalid.");
  }
  const priceStars = positiveInteger(item.priceStars, "Product priceStars");
  if (priceStars > 1_000_000_000) throw new Error("Product price is too high.");
  if (item.billingType !== "one_time" && item.billingType !== "subscription") {
    throw new Error("Product billingType is invalid.");
  }
  const periodSeconds = positiveInteger(item.periodSeconds, "Product periodSeconds");
  if (item.billingType === "subscription" && periodSeconds !== 2_592_000) {
    throw new Error("Only 30-day Telegram Stars subscriptions are supported.");
  }
  return {
    id: positiveInteger(item.id, "Product id"),
    title: text(item.title, "Product title", 120),
    description: text(item.description, "Product description", 800),
    priceStars,
    billingType: item.billingType,
    periodSeconds,
    photoFileId,
    postPurchaseMessage: text(
      item.postPurchaseMessage,
      "Product postPurchaseMessage",
      3_500,
    ),
    active: item.active,
    createdAt: timestamp(item.createdAt, "Product createdAt"),
  };
}

function parseOrder(value: unknown): BackupOrder {
  const item = record(value, "Order");
  if (item.itemType !== "product") {
    throw new Error("Order itemType is invalid.");
  }
  if (item.status !== "pending" && item.status !== "paid") {
    throw new Error("Order status is invalid.");
  }
  const chargeId =
    item.telegramChargeId === null
      ? null
      : text(item.telegramChargeId, "Order telegramChargeId", 512);
  if (item.status === "paid" && !chargeId) {
    throw new Error("Paid orders must include a Telegram charge ID.");
  }
  const amountStars = positiveInteger(item.amountStars, "Order amountStars");
  if (amountStars > 1_000_000_000) throw new Error("Order amount is too high.");
  return {
    id: positiveInteger(item.id, "Order id"),
    userId: positiveInteger(item.userId, "Order userId"),
    itemType: item.itemType,
    itemId: positiveInteger(item.itemId, "Order itemId"),
    itemTitle: text(item.itemTitle, "Order itemTitle", 120),
    amountStars,
    payload: text(item.payload, "Order payload", 128),
    status: item.status,
    telegramChargeId: chargeId,
    createdAt: timestamp(item.createdAt, "Order createdAt"),
    paidAt:
      item.paidAt === null ? null : timestamp(item.paidAt, "Order paidAt"),
  };
}

function parseSubscription(value: unknown): BackupSubscription {
  const item = record(value, "Subscription");
  return {
    id: positiveInteger(item.id, "Subscription id"),
    userId: positiveInteger(item.userId, "Subscription userId"),
    productId: positiveInteger(item.productId, "Subscription productId"),
    expiresAt: timestamp(item.expiresAt, "Subscription expiresAt"),
    updatedAt: timestamp(item.updatedAt, "Subscription updatedAt"),
  };
}

export function parseTelegramBackup(input: unknown): TelegramBackup {
  const backup = record(input, "Backup");
  if (backup.format !== "telegram-bot-backup" || backup.version !== 2) {
    throw new Error("Unsupported backup format or version.");
  }

  const products = list(backup.products, "Products", 10_000).map(parseProduct);
  const orders = list(backup.orders, "Orders", 100_000).map(parseOrder);
  const subscriptions = list(backup.subscriptions, "Subscriptions", 100_000).map(
    parseSubscription,
  );
  const rawSettings = list(backup.settings, "Settings", 50);
  const settings = rawSettings.map((value) => {
    const setting = record(value, "Setting");
    const key = text(setting.key, "Setting key", 50);
    const settingValue = text(setting.value, "Setting value", 4_000);
    if (!/^[a-z][a-z0-9_]*$/.test(key)) throw new Error("Setting key is invalid.");
    if (
      key === "support_url" &&
      settingValue &&
      !settingValue.startsWith("https://")
    ) {
      throw new Error("Support URL must use HTTPS.");
    }
    return { key, value: settingValue };
  });

  const unique = (values: number[], label: string): void => {
    if (new Set(values).size !== values.length) {
      throw new Error(`${label} contains duplicate IDs.`);
    }
  };
  unique(products.map((item) => item.id), "Products");
  unique(orders.map((item) => item.id), "Orders");
  unique(subscriptions.map((item) => item.id), "Subscriptions");
  if (new Set(orders.map((item) => item.payload)).size !== orders.length) {
    throw new Error("Orders contain duplicate invoice payloads.");
  }
  const chargeIds = orders
    .map((item) => item.telegramChargeId)
    .filter((id): id is string => Boolean(id));
  if (new Set(chargeIds).size !== chargeIds.length) {
    throw new Error("Orders contain duplicate Telegram charge IDs.");
  }
  const productIds = new Set(products.map((item) => item.id));
  for (const order of orders) {
    if (!productIds.has(order.itemId)) {
      throw new Error("An order references a missing product.");
    }
  }
  for (const subscription of subscriptions) {
    if (!productIds.has(subscription.productId)) {
      throw new Error("A subscription references a missing product.");
    }
  }

  return {
    format: "telegram-bot-backup",
    version: 2,
    exportedAt: timestamp(backup.exportedAt, "Backup exportedAt"),
    products,
    orders,
    subscriptions,
    settings,
  };
}
