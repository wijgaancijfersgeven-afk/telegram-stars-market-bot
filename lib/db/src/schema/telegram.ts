import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const telegramProductsTable = pgTable("telegram_products", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 120 }).notNull(),
  description: text("description").notNull(),
  priceStars: integer("price_stars").notNull(),
  photoFileId: text("photo_file_id"),
  postPurchaseMessage: text("post_purchase_message").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const telegramPlansTable = pgTable("telegram_plans", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 120 }).notNull(),
  description: text("description").notNull(),
  priceStars: integer("price_stars").notNull(),
  periodSeconds: integer("period_seconds").notNull().default(2_592_000),
  postPurchaseMessage: text("post_purchase_message").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const telegramOrdersTable = pgTable(
  "telegram_orders",
  {
    id: serial("id").primaryKey(),
    userId: bigint("user_id", { mode: "number" }).notNull(),
    itemType: varchar("item_type", { length: 20 }).notNull(),
    itemId: integer("item_id").notNull(),
    itemTitle: varchar("item_title", { length: 120 }).notNull(),
    amountStars: integer("amount_stars").notNull(),
    payload: varchar("payload", { length: 128 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    telegramChargeId: text("telegram_charge_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("telegram_orders_payload_uq").on(table.payload),
    uniqueIndex("telegram_orders_charge_uq").on(table.telegramChargeId),
  ],
);

export const telegramSubscriptionsTable = pgTable(
  "telegram_subscriptions",
  {
    id: serial("id").primaryKey(),
    userId: bigint("user_id", { mode: "number" }).notNull(),
    planId: integer("plan_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("telegram_subscriptions_user_plan_uq").on(
      table.userId,
      table.planId,
    ),
  ],
);

export const telegramSessionsTable = pgTable("telegram_sessions", {
  userId: bigint("user_id", { mode: "number" }).primaryKey(),
  stage: varchar("stage", { length: 50 }).notNull(),
  data: jsonb("data")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const telegramSettingsTable = pgTable("telegram_settings", {
  key: varchar("key", { length: 50 }).primaryKey(),
  value: text("value").notNull(),
});
