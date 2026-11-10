# Telegram Stars Market Bot

A Telegram-only shop for digital products, with one-time Telegram Stars payments and an admin-controlled product catalog.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- Required secret: `TELEGRAM_BOT_TOKEN`
- Required env: `TELEGRAM_ADMIN_ID`
- Optional env: `SQLITE_PATH` — SQLite file path; defaults to `artifacts/api-server/data/telegram.sqlite` when launched from the API package

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: SQLite using Node.js's built-in `node:sqlite`
- Payments: Telegram Stars, one-time product purchases only
- Validation: Zod (`zod/v4`)
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/telegram/bot.ts` — bot menus, admin flows, and payment handling
- `artifacts/api-server/src/telegram/store.ts` — product/order persistence and JSON backup/restore
- `lib/db/src/schema/index.ts` — SQLite schema
- `railway.json` — Railway build/start/health-check settings

## Architecture decisions

- Product data, orders, settings, and admin setup are managed inside Telegram; there is no web admin panel.
- All product invoices are one-time Telegram Stars payments. The bot does not create or renew subscriptions.
- SQLite is the production database. Railway needs a persistent volume mounted at `/data` with `SQLITE_PATH=/data/telegram.sqlite`.
- JSON backups include products, order history, and settings. Restoring replaces current records after admin confirmation.

## Product

- Customers browse digital products and pay with Telegram Stars.
- The admin can add products, attach photos, configure a post-purchase message, manage sales status, set a support link, and export/import backups.

## User preferences

- Keep the interface in Turkish, with emoji-led labels and uppercase headings.
- Keep SQLite; do not migrate this project to PostgreSQL.
- Use a public GitHub repository for Railway deployment.

## Gotchas

- Keep SQLite files out of Git. On Railway, attach a persistent volume at `/data`; the container filesystem alone is not durable.
- Telegram photo `file_id` values are tied to the bot that received them, so changing bot tokens can make restored product photos unavailable.
- Telegram Stars invoices must use currency `XTR` and an empty provider token.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
