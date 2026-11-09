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

export type TelegramSuccessfulPayment = {
  currency: string;
  total_amount: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
  subscription_expiration_date?: number;
  is_recurring?: boolean;
  is_first_recurring?: boolean;
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
    throw new Error(`Telegram ${method} request failed (${response.status}).`);
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
