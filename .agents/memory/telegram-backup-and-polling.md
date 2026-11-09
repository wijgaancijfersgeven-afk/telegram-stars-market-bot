---
name: Telegram bot operations
description: Non-obvious constraints for Telegram polling callbacks and JSON backups.
---

- If Telegram rejects `answerCallbackQuery` with HTTP 400 because a button callback expired, treat that update as stale and advance polling. Retrying it indefinitely blocks newer updates.
- Product photo `file_id` values in JSON backups are scoped to the same Telegram bot. Restoring with a different bot requires uploading those photos again.

**Why:** Callback acknowledgements expire quickly, while the polling loop processes updates in order. The backup preserves Telegram file references rather than copying image bytes.

**How to apply:** Keep stale callback errors isolated from the polling offset. When importing a backup, expect file IDs to work only when the original bot identity is retained.
