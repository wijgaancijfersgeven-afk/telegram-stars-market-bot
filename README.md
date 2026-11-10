# Telegram Stars Market Bot

A Turkish, Telegram-only storefront for selling digital products with one-time Telegram Stars payments. Product management, post-purchase messages, support links, and JSON backups are controlled through Telegram buttons by the configured admin.

## Requirements

- Node.js 24
- pnpm
- A Telegram bot token

## Run locally

```sh
pnpm install
pnpm --filter @workspace/api-server run dev
```

Before starting the bot, set `TELEGRAM_BOT_TOKEN` as a secret and set `TELEGRAM_ADMIN_ID` in the environment. Do not commit credentials. The bot uses SQLite. If `SQLITE_PATH` is not set, it creates `artifacts/api-server/data/telegram.sqlite` when launched from the API package. SQLite files are intentionally excluded from Git.

Open the bot in Telegram and send `/start`. The admin can add products, set a photo and a post-purchase message, change whether a product is on sale, configure a support link, and export or restore a JSON backup.

## Deploy on Railway

The repository includes `railway.json` for the build command, start command, and health check.

1. Create a Railway service from this GitHub repository.
2. Add a Railway Volume and mount it at `/data`.
3. Add these service variables:
   - `TELEGRAM_BOT_TOKEN` — the bot token, entered as a Railway secret
   - `TELEGRAM_ADMIN_ID` — the Telegram user ID allowed to manage the bot
   - `SQLITE_PATH=/data/telegram.sqlite`
4. Deploy the service and check `/api/healthz`.

Keep the service to one replica when using this SQLite volume. The container's temporary filesystem is not a replacement for the volume.

## Payments and backups

- The bot accepts one-time product payments in Telegram Stars (`XTR`); recurring subscriptions are not implemented.
- Admin backups contain products, orders, and settings. Restoring a backup replaces those records after a confirmation step.
- Backups from the earlier bot version are accepted: old subscription plans become one-time products, while recurring subscription records are ignored.
- Telegram photo file IDs belong to the bot that received them. A backup restored under a different bot token may not be able to display the old photos.
