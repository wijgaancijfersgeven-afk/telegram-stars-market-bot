import { logger } from "../lib/logger";
import {
  sendMessage,
  sendPhoto,
  telegramCall,
  type InlineKeyboard,
  type TelegramMessage,
  type TelegramUpdate,
} from "./api";
import {
  clearSession,
  completePayment,
  createPendingOrder,
  createPlan,
  createProduct,
  getPlan,
  getProduct,
  getSession,
  getSetting,
  isValidPreCheckout,
  listActiveSubscriptions,
  listPlans,
  listProducts,
  listRecentOrders,
  listUserSubscriptions,
  saveSession,
  setPlanMessage,
  setProductMessage,
  setSetting,
  togglePlan,
  toggleProduct,
} from "./store";

const SUBSCRIPTION_PERIOD_SECONDS = 2_592_000;
const MAX_MESSAGE_LENGTH = 3_500;

function adminId(): number | null {
  const parsed = Number(process.env.TELEGRAM_ADMIN_ID);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function isAdmin(userId: number): boolean {
  return userId === adminId();
}

function keyboard(rows: InlineKeyboard["inline_keyboard"]): InlineKeyboard {
  return { inline_keyboard: rows };
}

const customerMenu = keyboard([
  [
    { text: "Ürün kataloğu", callback_data: "menu:products" },
    { text: "Abonelik planları", callback_data: "menu:plans" },
  ],
  [{ text: "Aboneliklerim", callback_data: "menu:subscriptions" }],
]);

const adminMenu = keyboard([
  [
    { text: "Ürünleri yönet", callback_data: "adm:products" },
    { text: "Abonelikleri yönet", callback_data: "adm:plans" },
  ],
  [
    { text: "Son siparişler", callback_data: "adm:orders" },
    { text: "Aktif abonelikler", callback_data: "adm:subscriptions" },
  ],
  [
    { text: "Destek bağlantısı", callback_data: "adm:support" },
    { text: "Mağazayı gör", callback_data: "menu:store" },
  ],
]);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asId(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function dataString(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === "string" ? value : "";
}

function dataNumber(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  return typeof value === "number" ? value : 0;
}

async function showHome(chatId: number, userId: number): Promise<void> {
  if (isAdmin(userId)) {
    await sendMessage(chatId, "Yönetim paneli. Aşağıdaki butonlardan işlem seçin.", adminMenu);
    return;
  }
  await sendMessage(
    chatId,
    "Mağazaya hoş geldiniz. Ürünleri ve abonelik planlarını aşağıdan inceleyebilirsiniz.",
    customerMenu,
  );
}

async function showProducts(chatId: number, adminMode = false): Promise<void> {
  const products = await listProducts(!adminMode);
  if (products.length === 0) {
    await sendMessage(
      chatId,
      adminMode ? "Henüz ürün yok. Yeni ürün ekleyebilirsiniz." : "Şu anda satışta ürün bulunmuyor.",
      adminMode
        ? keyboard([[{ text: "Yeni ürün ekle", callback_data: "adm:add-product" }], [{ text: "Yönetim menüsü", callback_data: "menu:admin" }]])
        : customerMenu,
    );
    return;
  }

  for (const product of products) {
    const caption = `${product.title}\n\n${product.description}\n\nFiyat: ${product.priceStars} Stars`;
    if (adminMode) {
      const status = product.active ? "Satışta" : "Kapalı";
      await sendMessage(
        chatId,
        `${caption}\nDurum: ${status}`,
        keyboard([[{ text: "Ürün ayarları", callback_data: `adm:product:${product.id}` }]]),
      );
    } else {
      const markup = keyboard([
        [{ text: "Stars ile satın al", callback_data: `buy:product:${product.id}` }],
        [{ text: "Ana menü", callback_data: "menu:home" }],
      ]);
      if (product.photoFileId) {
        await sendPhoto(chatId, product.photoFileId, caption.slice(0, 1_000), markup);
      } else {
        await sendMessage(chatId, caption, markup);
      }
    }
  }
  if (adminMode) {
    await sendMessage(
      chatId,
      "Ürün yönetimi",
      keyboard([
        [{ text: "Yeni ürün ekle", callback_data: "adm:add-product" }],
        [{ text: "Yönetim menüsü", callback_data: "menu:admin" }],
      ]),
    );
  }
}

async function showPlans(chatId: number, adminMode = false): Promise<void> {
  const plans = await listPlans(!adminMode);
  if (plans.length === 0) {
    await sendMessage(
      chatId,
      adminMode
        ? "Henüz abonelik planı yok. Yeni plan ekleyebilirsiniz."
        : "Şu anda satışta abonelik planı bulunmuyor.",
      adminMode
        ? keyboard([[{ text: "Yeni plan ekle", callback_data: "adm:add-plan" }], [{ text: "Yönetim menüsü", callback_data: "menu:admin" }]])
        : customerMenu,
    );
    return;
  }

  for (const plan of plans) {
    const caption = `${plan.title}\n\n${plan.description}\n\nAylık ücret: ${plan.priceStars} Stars`;
    if (adminMode) {
      const status = plan.active ? "Satışta" : "Kapalı";
      await sendMessage(
        chatId,
        `${caption}\nDurum: ${status}`,
        keyboard([[{ text: "Plan ayarları", callback_data: `adm:plan:${plan.id}` }]]),
      );
    } else {
      await sendMessage(
        chatId,
        caption,
        keyboard([
          [{ text: "Aylık abone ol", callback_data: `buy:plan:${plan.id}` }],
          [{ text: "Ana menü", callback_data: "menu:home" }],
        ]),
      );
    }
  }
  if (adminMode) {
    await sendMessage(
      chatId,
      "Abonelik planı yönetimi",
      keyboard([
        [{ text: "Yeni plan ekle", callback_data: "adm:add-plan" }],
        [{ text: "Yönetim menüsü", callback_data: "menu:admin" }],
      ]),
    );
  }
}

async function sendProductSettings(chatId: number, id: number): Promise<void> {
  const product = await getProduct(id);
  if (!product) {
    await sendMessage(chatId, "Ürün bulunamadı.", adminMenu);
    return;
  }
  await sendMessage(
    chatId,
    `${product.title}\nFiyat: ${product.priceStars} Stars\nDurum: ${product.active ? "Satışta" : "Kapalı"}\n\nSatın alma sonrası mesaj:\n${product.postPurchaseMessage || "(boş)"}`,
    keyboard([
      [{ text: "Satın alma mesajını düzenle", callback_data: `adm:product-message:${id}` }],
      [{ text: product.active ? "Satıştan kaldır" : "Satışa aç", callback_data: `adm:product-toggle:${id}` }],
      [{ text: "Ürün listesi", callback_data: "adm:products" }],
    ]),
  );
}

async function sendPlanSettings(chatId: number, id: number): Promise<void> {
  const plan = await getPlan(id);
  if (!plan) {
    await sendMessage(chatId, "Abonelik planı bulunamadı.", adminMenu);
    return;
  }
  await sendMessage(
    chatId,
    `${plan.title}\nAylık ücret: ${plan.priceStars} Stars\nDurum: ${plan.active ? "Satışta" : "Kapalı"}\n\nÖdeme sonrası mesaj:\n${plan.postPurchaseMessage || "(boş)"}`,
    keyboard([
      [{ text: "Ödeme sonrası mesajı düzenle", callback_data: `adm:plan-message:${id}` }],
      [{ text: plan.active ? "Satıştan kaldır" : "Satışa aç", callback_data: `adm:plan-toggle:${id}` }],
      [{ text: "Plan listesi", callback_data: "adm:plans" }],
    ]),
  );
}

async function beginProductCreation(chatId: number, userId: number): Promise<void> {
  await saveSession(userId, "product-title", {});
  await sendMessage(chatId, "Yeni ürünün adını gönderin. İptal etmek için /cancel yazın.");
}

async function beginPlanCreation(chatId: number, userId: number): Promise<void> {
  await saveSession(userId, "plan-title", {});
  await sendMessage(chatId, "Yeni abonelik planının adını gönderin. İptal etmek için /cancel yazın.");
}

async function beginMessageEdit(
  chatId: number,
  userId: number,
  type: "product" | "plan",
  id: number,
): Promise<void> {
  await saveSession(userId, `${type}-message-edit`, { id });
  await sendMessage(
    chatId,
    "Satın alımdan sonra gönderilecek mesajı yazın. Boş mesaj için /skip, iptal için /cancel yazın.",
  );
}

async function showOrders(chatId: number): Promise<void> {
  const orders = await listRecentOrders();
  if (!orders.length) {
    await sendMessage(chatId, "Henüz sipariş yok.", adminMenu);
    return;
  }
  const lines = orders.map((order) => {
    const status = order.status === "paid" ? "Ödendi" : "Bekliyor";
    const date = new Date(order.createdAt).toLocaleString("tr-TR", {
      timeZone: "Europe/Istanbul",
    });
    return `#${order.userId} · ${order.itemTitle} · ${order.amountStars} Stars · ${status} · ${date}`;
  });
  await sendMessage(chatId, `Son siparişler:\n\n${lines.join("\n")}`, adminMenu);
}

async function showSubscriptions(chatId: number, adminMode: boolean, userId: number): Promise<void> {
  if (adminMode) {
    const subscriptions = await listActiveSubscriptions();
    if (!subscriptions.length) {
      await sendMessage(chatId, "Aktif abonelik yok.", adminMenu);
      return;
    }
    const lines = subscriptions.map((subscription) => {
      const date = new Date(subscription.expiresAt).toLocaleString("tr-TR", {
        timeZone: "Europe/Istanbul",
      });
      return `#${subscription.userId} · ${subscription.title} · ${date} tarihine kadar`;
    });
    await sendMessage(chatId, `Aktif abonelikler:\n\n${lines.join("\n")}`, adminMenu);
    return;
  }

  const subscriptions = await listUserSubscriptions(userId);
  if (!subscriptions.length) {
    await sendMessage(chatId, "Aktif aboneliğiniz bulunmuyor.", customerMenu);
    return;
  }
  const lines = subscriptions.map((subscription) => {
    const date = new Date(subscription.expiresAt).toLocaleString("tr-TR", {
      timeZone: "Europe/Istanbul",
    });
    return `${subscription.title} · ${date} tarihine kadar`;
  });
  await sendMessage(chatId, `Aktif abonelikleriniz:\n\n${lines.join("\n")}`, customerMenu);
}

async function showSupportSettings(chatId: number): Promise<void> {
  const supportUrl = await getSetting("support_url");
  await sendMessage(
    chatId,
    `Satın alanlara gösterilen yetkili bağlantısı: ${supportUrl || "Ayarlanmadı"}\n\nYeni bağlantı gönderebilir veya kapatmak için /clear yazabilirsiniz.`,
    keyboard([[{ text: "Yönetim menüsü", callback_data: "menu:admin" }]]),
  );
}

async function startPurchase(
  chatId: number,
  userId: number,
  itemType: "product" | "plan",
  itemId: number,
): Promise<void> {
  if (itemType === "product") {
    const product = await getProduct(itemId);
    if (!product?.active) {
      await sendMessage(chatId, "Bu ürün şu anda satışta değil.", customerMenu);
      return;
    }
    const payload = await createPendingOrder({
      userId,
      itemType,
      itemId,
      itemTitle: product.title,
      amountStars: product.priceStars,
    });
    await telegramCall<TelegramMessage>("sendInvoice", {
      chat_id: chatId,
      title: product.title.slice(0, 32),
      description: product.description.slice(0, 255) || product.title,
      payload,
      provider_token: "",
      currency: "XTR",
      prices: [{ label: product.title.slice(0, 32), amount: product.priceStars }],
    });
    return;
  }

  const plan = await getPlan(itemId);
  if (!plan?.active) {
    await sendMessage(chatId, "Bu abonelik planı şu anda satışta değil.", customerMenu);
    return;
  }
  const payload = await createPendingOrder({
    userId,
    itemType,
    itemId,
    itemTitle: plan.title,
    amountStars: plan.priceStars,
  });
  await telegramCall<TelegramMessage>("sendInvoice", {
    chat_id: chatId,
    title: plan.title.slice(0, 32),
    description: plan.description.slice(0, 255) || plan.title,
    payload,
    provider_token: "",
    currency: "XTR",
    prices: [{ label: plan.title.slice(0, 32), amount: plan.priceStars }],
    subscription_period: plan.periodSeconds || SUBSCRIPTION_PERIOD_SECONDS,
  });
}

async function handlePreCheckout(update: TelegramUpdate): Promise<void> {
  const query = update.pre_checkout_query;
  if (!query) return;
  const valid = await isValidPreCheckout({
    userId: query.from.id,
    payload: query.invoice_payload,
    currency: query.currency,
    totalAmount: query.total_amount,
  });
  await telegramCall<boolean>("answerPreCheckoutQuery", {
    pre_checkout_query_id: query.id,
    ok: valid,
    ...(valid ? {} : { error_message: "Sipariş bilgisi doğrulanamadı. Lütfen yeniden deneyin." }),
  });
}

async function handleSuccessfulPayment(message: TelegramMessage): Promise<void> {
  const payment = message.successful_payment;
  const userId = message.from?.id;
  if (!payment || !userId) return;

  const receipt = await completePayment({
    userId,
    payload: payment.invoice_payload,
    currency: payment.currency,
    totalAmount: payment.total_amount,
    chargeId: payment.telegram_payment_charge_id,
    ...(payment.subscription_expiration_date
      ? { subscriptionExpirationDate: payment.subscription_expiration_date }
      : {}),
  });

  if (!receipt) {
    logger.warn("Telegram payment could not be matched to a pending order.");
    await sendMessage(
      message.chat.id,
      "Ödemeniz alındı ancak sipariş bilgisi doğrulanamadı. Lütfen yetkiliyle iletişime geçin.",
      customerMenu,
    );
    const admin = adminId();
    if (admin) {
      await sendMessage(admin, "Eşleşmeyen Telegram Stars ödemesi var. Bot kayıtlarını kontrol edin.");
    }
    return;
  }

  const responseText =
    receipt.postPurchaseMessage.trim() || `${receipt.itemTitle} için ödemeniz alındı.`;
  const supportUrl = await getSetting("support_url");
  const markup =
    supportUrl && supportUrl.startsWith("https://")
      ? keyboard([[{ text: "Yetkiliyle iletişim", url: supportUrl }]])
      : undefined;
  await sendMessage(message.chat.id, responseText, markup);
}

async function handlePhotoInput(
  chatId: number,
  userId: number,
  message: TelegramMessage,
): Promise<void> {
  const session = await getSession(userId);
  if (!session || session.stage !== "product-photo") return;
  const photo = message.photo?.at(-1);
  if (!photo) {
    await sendMessage(chatId, "Lütfen ürün fotoğrafı gönderin veya aşağıdaki Atla düğmesini kullanın.");
    return;
  }
  await saveSession(userId, "product-message", {
    ...session.data,
    photoFileId: photo.file_id,
  });
  await sendMessage(chatId, "Satın alım sonrası gönderilecek mesajı yazın.");
}

async function handleAdminInput(
  chatId: number,
  userId: number,
  text: string,
): Promise<void> {
  const session = await getSession(userId);
  if (!session) return;

  const data = session.data;
  const value = text.trim();
  if (value.length > MAX_MESSAGE_LENGTH) {
    await sendMessage(chatId, `Metin çok uzun. En fazla ${MAX_MESSAGE_LENGTH} karakter gönderin.`);
    return;
  }

  if (session.stage === "product-title" || session.stage === "plan-title") {
    if (!value || value.length > 120) {
      await sendMessage(chatId, "Ad 1–120 karakter arasında olmalı. Yeniden gönderin.");
      return;
    }
    const isProduct = session.stage === "product-title";
    await saveSession(userId, isProduct ? "product-description" : "plan-description", {
      title: value,
    });
    await sendMessage(chatId, "Kısa açıklamayı gönderin (en fazla 800 karakter).");
    return;
  }

  if (session.stage === "product-description" || session.stage === "plan-description") {
    if (value.length > 800) {
      await sendMessage(chatId, "Açıklama en fazla 800 karakter olabilir.");
      return;
    }
    const isProduct = session.stage === "product-description";
    await saveSession(userId, isProduct ? "product-price" : "plan-price", {
      ...data,
      description: value,
    });
    await sendMessage(chatId, "Fiyatı tam sayı olarak Telegram Stars cinsinden gönderin.");
    return;
  }

  if (session.stage === "product-price" || session.stage === "plan-price") {
    const price = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(price) || price < 1 || price > 1_000_000_000) {
      await sendMessage(chatId, "Fiyat 1 ile 1.000.000.000 arasında tam sayı olmalı.");
      return;
    }
    if (session.stage === "product-price") {
      await saveSession(userId, "product-photo", { ...data, priceStars: price });
      await sendMessage(
        chatId,
        "Ürün fotoğrafını gönderin veya fotoğraf olmadan devam edin.",
        keyboard([[{ text: "Fotoğrafı atla", callback_data: "adm:photo-skip" }]]),
      );
    } else {
      await saveSession(userId, "plan-message", { ...data, priceStars: price });
      await sendMessage(chatId, "Abonelik satın alındıktan sonra gönderilecek mesajı yazın.");
    }
    return;
  }

  if (session.stage === "product-photo") {
    await sendMessage(
      chatId,
      "Bir ürün fotoğrafı gönderin veya fotoğraf olmadan devam etmek için Atla düğmesine basın.",
      keyboard([[{ text: "Fotoğrafı atla", callback_data: "adm:photo-skip" }]]),
    );
    return;
  }

  if (session.stage === "product-message") {
    const product = await createProduct({
      title: dataString(data, "title"),
      description: dataString(data, "description"),
      priceStars: dataNumber(data, "priceStars"),
      photoFileId: dataString(data, "photoFileId") || null,
      postPurchaseMessage: value === "/skip" ? "" : value,
    });
    await clearSession(userId);
    await sendMessage(chatId, `“${product.title}” ürünü eklendi.`, adminMenu);
    return;
  }

  if (session.stage === "plan-message") {
    const plan = await createPlan({
      title: dataString(data, "title"),
      description: dataString(data, "description"),
      priceStars: dataNumber(data, "priceStars"),
      postPurchaseMessage: value === "/skip" ? "" : value,
    });
    await clearSession(userId);
    await sendMessage(
      chatId,
      `“${plan.title}” planı eklendi. Telegram Stars abonelikleri aylık olarak yenilenir.`,
      adminMenu,
    );
    return;
  }

  if (session.stage === "product-message-edit" || session.stage === "plan-message-edit") {
    const id = dataNumber(data, "id");
    if (session.stage === "product-message-edit") {
      await setProductMessage(id, value === "/skip" ? "" : value);
      await sendProductSettings(chatId, id);
    } else {
      await setPlanMessage(id, value === "/skip" ? "" : value);
      await sendPlanSettings(chatId, id);
    }
    await clearSession(userId);
    return;
  }

  if (session.stage === "support-url") {
    if (value.toLowerCase() === "/clear" || value.toLowerCase() === "off") {
      await setSetting("support_url", "");
      await clearSession(userId);
      await sendMessage(chatId, "Yetkili bağlantısı kapatıldı.", adminMenu);
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      await sendMessage(chatId, "Geçerli bir bağlantı gönderin; bağlantı https:// ile başlamalı.");
      return;
    }
    if (parsed.protocol !== "https:") {
      await sendMessage(chatId, "Güvenlik için bağlantı https:// ile başlamalı.");
      return;
    }
    await setSetting("support_url", parsed.toString());
    await clearSession(userId);
    await sendMessage(chatId, "Yetkili bağlantısı kaydedildi.", adminMenu);
    return;
  }
}

async function handleMessage(message: TelegramMessage): Promise<void> {
  const userId = message.from?.id;
  const chatId = message.chat.id;
  if (!userId) return;

  if (message.successful_payment) {
    await handleSuccessfulPayment(message);
    return;
  }

  if (isAdmin(userId) && message.photo?.length) {
    await handlePhotoInput(chatId, userId, message);
    return;
  }

  const text = message.text?.trim();
  if (text === "/start" || text === "/admin") {
    await clearSession(userId);
    await showHome(chatId, userId);
    return;
  }

  if (isAdmin(userId) && text === "/cancel") {
    await clearSession(userId);
    await sendMessage(chatId, "İşlem iptal edildi.", adminMenu);
    return;
  }

  if (isAdmin(userId) && text) {
    const session = await getSession(userId);
    if (session) {
      await handleAdminInput(chatId, userId, text);
      return;
    }
  }

  await sendMessage(
    chatId,
    "Lütfen menüdeki butonlardan birini seçin. Menüye dönmek için /start yazın.",
    isAdmin(userId) ? adminMenu : customerMenu,
  );
}

async function handleCallback(update: TelegramUpdate): Promise<void> {
  const query = update.callback_query;
  if (!query?.data) return;
  const chatId = query.message?.chat.id ?? query.from.id;
  const userId = query.from.id;
  const data = query.data;

  if (data.startsWith("adm:") && !isAdmin(userId)) {
    await telegramCall<boolean>("answerCallbackQuery", {
      callback_query_id: query.id,
      text: "Bu işlem yöneticiye özeldir.",
      show_alert: true,
    });
    return;
  }
  await telegramCall<boolean>("answerCallbackQuery", { callback_query_id: query.id });

  if (data === "menu:home" || data === "menu:admin") {
    await showHome(chatId, userId);
    return;
  }
  if (data === "menu:store") {
    await sendMessage(chatId, "Mağaza menüsü", customerMenu);
    return;
  }
  if (data === "menu:products") {
    await showProducts(chatId);
    return;
  }
  if (data === "menu:plans") {
    await showPlans(chatId);
    return;
  }
  if (data === "menu:subscriptions") {
    await showSubscriptions(chatId, false, userId);
    return;
  }
  if (data.startsWith("buy:product:")) {
    const id = asId(data.slice("buy:product:".length));
    if (id) await startPurchase(chatId, userId, "product", id);
    return;
  }
  if (data.startsWith("buy:plan:")) {
    const id = asId(data.slice("buy:plan:".length));
    if (id) await startPurchase(chatId, userId, "plan", id);
    return;
  }

  if (data === "adm:products") {
    await showProducts(chatId, true);
  } else if (data === "adm:plans") {
    await showPlans(chatId, true);
  } else if (data === "adm:add-product") {
    await beginProductCreation(chatId, userId);
  } else if (data === "adm:add-plan") {
    await beginPlanCreation(chatId, userId);
  } else if (data === "adm:orders") {
    await showOrders(chatId);
  } else if (data === "adm:subscriptions") {
    await showSubscriptions(chatId, true, userId);
  } else if (data === "adm:support") {
    await saveSession(userId, "support-url", {});
    await showSupportSettings(chatId);
  } else if (data === "adm:photo-skip") {
    const session = await getSession(userId);
    if (session?.stage === "product-photo") {
      await saveSession(userId, "product-message", session.data);
      await sendMessage(chatId, "Satın alım sonrası gönderilecek mesajı yazın.");
    }
  } else if (data.startsWith("adm:product-message:")) {
    const id = asId(data.slice("adm:product-message:".length));
    if (id) await beginMessageEdit(chatId, userId, "product", id);
  } else if (data.startsWith("adm:plan-message:")) {
    const id = asId(data.slice("adm:plan-message:".length));
    if (id) await beginMessageEdit(chatId, userId, "plan", id);
  } else if (data.startsWith("adm:product-toggle:")) {
    const id = asId(data.slice("adm:product-toggle:".length));
    if (id) {
      await toggleProduct(id);
      await sendProductSettings(chatId, id);
    }
  } else if (data.startsWith("adm:plan-toggle:")) {
    const id = asId(data.slice("adm:plan-toggle:".length));
    if (id) {
      await togglePlan(id);
      await sendPlanSettings(chatId, id);
    }
  } else if (data.startsWith("adm:product:")) {
    const id = asId(data.slice("adm:product:".length));
    if (id) await sendProductSettings(chatId, id);
  } else if (data.startsWith("adm:plan:")) {
    const id = asId(data.slice("adm:plan:".length));
    if (id) await sendPlanSettings(chatId, id);
  }
}

async function handleUpdate(update: TelegramUpdate): Promise<void> {
  if (update.pre_checkout_query) {
    await handlePreCheckout(update);
  } else if (update.callback_query) {
    await handleCallback(update);
  } else if (update.message) {
    await handleMessage(update.message);
  }
}

async function pollTelegram(): Promise<never> {
  const admin = adminId();
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }
  if (!admin) {
    throw new Error("TELEGRAM_ADMIN_ID must be a positive Telegram user ID.");
  }

  let offset = 0;
  let retryDelay = 1_000;
  let initialized = false;
  while (true) {
    try {
      if (!initialized) {
        await telegramCall<boolean>("deleteWebhook", { drop_pending_updates: false });
        const bot = await telegramCall<{ username?: string }>("getMe");
        logger.info({ botUsername: bot.username }, "Telegram bot polling started");
        initialized = true;
      }
      const updates = await telegramCall<TelegramUpdate[]>("getUpdates", {
        offset,
        timeout: 25,
        allowed_updates: ["message", "callback_query", "pre_checkout_query"],
      });
      retryDelay = 1_000;
      for (const update of updates) {
        try {
          await handleUpdate(update);
          offset = update.update_id + 1;
        } catch (error) {
          logger.error({ err: error, updateId: update.update_id }, "Telegram update failed");
          await delay(1_500);
          break;
        }
      }
    } catch (error) {
      logger.error({ err: error }, "Telegram polling request failed");
      await delay(retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30_000);
    }
  }
}

export function startTelegramBot(): void {
  void pollTelegram().catch((error: unknown) => {
    logger.error({ err: error }, "Telegram bot stopped unexpectedly");
  });
}
