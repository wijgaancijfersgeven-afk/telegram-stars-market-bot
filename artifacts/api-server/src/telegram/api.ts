export type InlineButton = {
  text: string;
  callback_data?: string;
  url?: string;
};

export type InlineKeyboard = {
  inline_keyboard: InlineButton[][];
};

export type TelegramPhoto = {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
};

export type TelegramDocument = {
  file_id: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
};

export type TelegramSuccessfulPayment = {
  currency: string;
  total_amount: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
};

export type TelegramMessage = {
  message_id: number;
  chat: { id: number };
  from?: {
    id: number;
    first_name: string;
    username?: string;
  };
  text?: string;
  photo?: TelegramPhoto[];
  document?: TelegramDocument;
  successful_payment?: TelegramSuccessfulPayment;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: {
    id: string;
    from: { id: number; first_name: string };
    data?: string;
    message?: TelegramMessage;
  };
  pre_checkout_query?: {
    id: string;
    from: { id: number };
    currency: string;
    total_amount: number;
    invoice_payload: string;
  };
};

type TelegramResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

const token = process.env.TELEGRAM_BOT_TOKEN;

export async function telegramCall<T>(
  method: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let description = "";
    try {
      const errorBody = (await response.json()) as { description?: unknown };
      if (typeof errorBody.description === "string") {
        description = `: ${errorBody.description}`;
      }
    } catch {
      // Keep the HTTP status as the useful error when Telegram returns no JSON.
    }
    throw new Error(
      `Telegram ${method} request failed (${response.status})${description}.`,
    );
  }

  const result = (await response.json()) as TelegramResponse<T>;
  if (!result.ok || result.result === undefined) {
    throw new Error(`Telegram ${method} failed: ${result.description ?? "unknown error"}`);
  }

  return result.result;
}

export function sendMessage(
  chatId: number,
  text: string,
  replyMarkup?: InlineKeyboard,
): Promise<TelegramMessage> {
  return telegramCall<TelegramMessage>("sendMessage", {
    chat_id: chatId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

export function sendPhoto(
  chatId: number,
  photo: string,
  caption: string,
  replyMarkup?: InlineKeyboard,
): Promise<TelegramMessage> {
  return telegramCall<TelegramMessage>("sendPhoto", {
    chat_id: chatId,
    photo,
    caption,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

export async function sendJsonDocument(
  chatId: number,
  filename: string,
  content: string,
  caption: string,
): Promise<TelegramMessage> {
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }

  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", caption);
  form.append(
    "document",
    new Blob([content], { type: "application/json" }),
    filename,
  );
  const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    throw new Error(`Telegram sendDocument request failed (${response.status}).`);
  }
  const result = (await response.json()) as TelegramResponse<TelegramMessage>;
  if (!result.ok || !result.result) {
    throw new Error(`Telegram sendDocument failed: ${result.description ?? "unknown error"}`);
  }
  return result.result;
}

export async function downloadTelegramDocument(
  fileId: string,
  maxBytes: number,
): Promise<string> {
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }

  const file = await telegramCall<{ file_path?: string; file_size?: number }>(
    "getFile",
    { file_id: fileId },
  );
  if (!file.file_path || (file.file_size != null && file.file_size > maxBytes)) {
    throw new Error("Telegram backup file is missing or too large.");
  }
  const response = await fetch(
    `https://api.telegram.org/file/bot${token}/${file.file_path}`,
  );
  if (!response.ok) {
    throw new Error(`Telegram file download failed (${response.status}).`);
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > maxBytes) {
    throw new Error("Telegram backup file is too large.");
  }
  return new TextDecoder().decode(bytes);
}
