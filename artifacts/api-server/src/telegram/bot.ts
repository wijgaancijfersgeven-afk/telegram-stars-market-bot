import { logger } from "../lib/logger";
import {
  downloadTelegramDocument,
  sendMessage,
  sendPhoto,
  sendJsonDocument,
  telegramCall,
  type InlineKeyboard,
  type TelegramMessage,
  type TelegramUpdate,
} from "./api";
import { parseTelegramBackup } from "./backup";
import {
  clearSession,
  completePayment,
  createBackupSnapshot,
  createPendingOrder,
  createProduct,
  getProduct,
  getSession,
  getSetting,
  isValidPreCheckout,
  listProducts,
  listRecentOrders,
  restoreBackup,
  saveSession,
  setProductMessage,
  setSetting,
  toggleProduct,
} from "./store";

const MAX_MESSAGE_LENGTH = 3_500;
const MAX_BACKUP_BYTES = 8 * 1024 * 1024;

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
  [{ text: "🛍️ ÜRÜN KATALOĞU", callback_data: "menu:products" }],
]);

const adminMenu = keyboard([
  [
    { text: "📦 ÜRÜNLERİ YÖNET", callback_data: "adm:products" },
    { text: "🧾 SON SİPARİŞLER", callback_data: "adm:orders" },
  ],
  [{ text: "🛍️ MAĞAZAYI GÖR", callback_data: "menu:store" }],
  [
    { text: "💬 DESTEK BAĞLANTISI", callback_data: "adm:support" },
    { text: "💾 YEDEK AL", callback_data: "adm:backup-export" },
  ],
  [
    { text: "📥 YEDEĞİ GERİ YÜKLE", callback_data: "adm:backup-import" },
    { text: "🏠 MAĞAZA MENÜSÜ", callback_data: "menu:home" },
  ],
]);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acknowledgeCallback(
  queryId: string,
  options?: { text: string; show_alert?: boolean },
): Promise<boolean> {
  try {
    await telegramCall<boolean>("answerCallbackQuery", {
      callback_query_id: queryId,
      ...(options ?? {}),
    });
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes("(400)")) {
      logger.warn({ err: error }, "Ignoring an expired Telegram button callback");
      return false;
    }
    throw error;
  }
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
    await sendMessage(chatId, "⚙️ YÖNETİM PANELİ\n\nBir işlem seçin:", adminMenu);
    return;
  }
  await sendMessage(
    chatId,
    "✨ MAĞAZAMIZA HOŞ GELDİNİZ\n\nÜrünleri aşağıdaki düğmeden inceleyebilirsiniz.",
    customerMenu,
  );
}

async function showProducts(chatId: number, adminMode = false): Promise<void> {
  const products = await listProducts(!adminMode);
  if (products.length === 0) {
    await sendMessage(
      chatId,
      adminMode
        ? "📦 HENÜZ ÜRÜN YOK\n\nYeni ürün ekleyebilirsiniz."
        : "🛍️ ŞU ANDA SATIŞTA ÜRÜN BULUNMUYOR.",
      adminMode
        ? keyboard([[{ text: "➕ YENİ ÜRÜN EKLE", callback_data: "adm:add-product" }], [{ text: "⚙️ YÖNETİM MENÜSÜ", callback_data: "menu:admin" }]])
        : customerMenu,
    );
    return;
  }

  for (const product of products) {
    const caption = `🛍️ ${product.title.toLocaleUpperCase("tr-TR")}\n\n${product.description}\n\n⭐ FİYAT: ${product.priceStars} Stars`;
    if (adminMode) {
      const status = product.active ? "🟢 SATIŞTA" : "⚪ KAPALI";
      await sendMessage(
        chatId,
        `${caption}\n📊 DURUM: ${status}`,
        keyboard([[{ text: "⚙️ ÜRÜN AYARLARI", callback_data: `adm:product:${product.id}` }]]),
      );
    } else {
      const markup = keyboard([
        [{ text: "⭐ SATIN AL", callback_data: `buy:product:${product.id}` }],
        [{ text: "🏠 ANA MENÜ", callback_data: "menu:home" }],
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
      "📦 ÜRÜN YÖNETİMİ",
      keyboard([
        [{ text: "➕ YENİ ÜRÜN EKLE", callback_data: "adm:add-product" }],
        [{ text: "⚙️ YÖNETİM MENÜSÜ", callback_data: "menu:admin" }],
      ]),
    );
  }
}

async function sendProductSettings(chatId: number, id: number): Promise<void> {
  const product = await getProduct(id);
  if (!product) {
    await sendMessage(chatId, "⚠️ ÜRÜN BULUNAMADI.", adminMenu);
    return;
  }
  await sendMessage(
    chatId,
    `📦 ${product.title.toLocaleUpperCase("tr-TR")}\n⭐ FİYAT: ${product.priceStars} Stars\n💳 ÖDEME: TEK SEFERLİK\n📊 DURUM: ${product.active ? "🟢 SATIŞTA" : "⚪ KAPALI"}\n\n✉️ SATIN ALMA SONRASI MESAJ:\n${product.postPurchaseMessage || "(boş)"}`,
    keyboard([
      [{ text: "✉️ MESAJI DÜZENLE", callback_data: `adm:product-message:${id}` }],
      [{ text: product.active ? "⏸️ SATIŞTAN KALDIR" : "🟢 SATIŞA AÇ", callback_data: `adm:product-toggle:${id}` }],
      [{ text: "📦 ÜRÜN LİSTESİ", callback_data: "adm:products" }],
    ]),
  );
}

async function beginProductCreation(chatId: number, userId: number): Promise<void> {
  await saveSession(userId, "product-title", {});
  await sendMessage(chatId, "➕ YENİ ÜRÜNÜN ADINI GÖNDERİN.\n\nİptal etmek için /cancel yazın.");
}

async function beginMessageEdit(
  chatId: number,
  userId: number,
  type: "product",
  id: number,
): Promise<void> {
  await saveSession(userId, `${type}-message-edit`, { id });
  await sendMessage(
    chatId,
    "✉️ SATIN ALIMDAN SONRA GÖNDERİLECEK MESAJI YAZIN.\n\nBoş mesaj için /skip, iptal için /cancel yazın.",
  );
}

async function showOrders(chatId: number): Promise<void> {
  const orders = await listRecentOrders();
  if (!orders.length) {
    await sendMessage(chatId, "🧾 HENÜZ SİPARİŞ YOK.", adminMenu);
    return;
  }
  const lines = orders.map((order) => {
    const status = order.status === "paid" ? "✅ ÖDENDİ" : "⏳ BEKLİYOR";
    const date = new Date(order.createdAt).toLocaleString("tr-TR", {
      timeZone: "Europe/Istanbul",
    });
    return `#${order.userId} · ${order.itemTitle} · ${order.amountStars} Stars · ${status} · ${date}`;
  });
  await sendMessage(chatId, `🧾 SON SİPARİŞLER\n\n${lines.join("\n")}`, adminMenu);
}

async function showSupportSettings(chatId: number): Promise<void> {
  const supportUrl = await getSetting("support_url");
  await sendMessage(
    chatId,
    `💬 DESTEK BAĞLANTISI\n\nSatın alanlara gösterilen bağlantı: ${supportUrl || "Ayarlanmadı"}\n\nYeni bir HTTPS bağlantısı gönderin. Kapatmak için /clear yazın.`,
    keyboard([[{ text: "⚙️ YÖNETİM MENÜSÜ", callback_data: "menu:admin" }]]),
  );
}

async function exportBackup(chatId: number): Promise<void> {
  const snapshot = await createBackupSnapshot();
  const content = JSON.stringify(snapshot, null, 2);
  if (Buffer.byteLength(content, "utf8") > MAX_BACKUP_BYTES) {
    await sendMessage(
      chatId,
      "⚠️ YEDEK DOSYASI 8 MB SINIRINI AŞIYOR. Sipariş geçmişini arşivleyip yeniden deneyin.",
      adminMenu,
    );
    return;
  }
  const suffix = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
  await sendJsonDocument(
    chatId,
    `telegram-backup-${suffix}.json`,
    content,
    "💾 TELEGRAM BOT YEDEĞİ\n\nÜrünler, siparişler ve ayarlar bu dosyadadır.",
  );
}

async function handleBackupDocument(message: TelegramMessage): Promise<void> {
  const userId = message.from?.id;
  const document = message.document;
  if (!userId || !document) return;
  const session = await getSession(userId);
  if (session?.stage !== "backup-await-file") {
    await sendMessage(
      message.chat.id,
      "📥 ÖNCE YÖNETİM MENÜSÜNDEN “YEDEĞİ GERİ YÜKLE” SEÇENEĞİNE BASIN.",
      adminMenu,
    );
    return;
  }
  if (!document.file_name?.toLowerCase().endsWith(".json")) {
    await sendMessage(message.chat.id, "📄 LÜTFEN .JSON YEDEK DOSYASINI GÖNDERİN.");
    return;
  }
  if (document.file_size != null && document.file_size > MAX_BACKUP_BYTES) {
    await sendMessage(message.chat.id, "⚠️ YEDEK DOSYASI EN FAZLA 8 MB OLABİLİR.");
    return;
  }

  try {
    const contents = await downloadTelegramDocument(document.file_id, MAX_BACKUP_BYTES);
    const parsed: unknown = JSON.parse(contents);
    const snapshot = parseTelegramBackup(parsed);
    await saveSession(userId, "backup-confirm", { snapshot });
    const legacyNote = snapshot.legacyConversion
      ? `\n\nℹ️ Eski yedekteki ${snapshot.legacyConversion.convertedPlans} plan tek seferlik ürüne çevrilecek; ${snapshot.legacyConversion.ignoredSubscriptions} abonelik kaydı alınmayacak.`
      : "";
    await sendMessage(
      message.chat.id,
      `✅ YEDEK DOĞRULANDI\n\n📦 ${snapshot.products.length} ürün · 🧾 ${snapshot.orders.length} sipariş\n\nOnaylarsanız mevcut ürünler, siparişler ve ayarlar bu yedekteki verilerle tamamen değişir.${legacyNote}`,
      keyboard([
        [{ text: "⚠️ YEDEĞİ GERİ YÜKLE", callback_data: "backup:confirm" }],
        [{ text: "❌ İPTAL ET", callback_data: "backup:cancel" }],
      ]),
    );
  } catch (error) {
    logger.warn({ err: error }, "Invalid Telegram backup upload");
    await sendMessage(
      message.chat.id,
      "⚠️ YEDEK OKUNAMADI. Bu botun oluşturduğu geçerli bir JSON yedeği gönderin.",
    );
  }
}

async function startPurchase(
  chatId: number,
  userId: number,
  itemId: number,
): Promise<void> {
  const product = await getProduct(itemId);
  if (!product?.active) {
    await sendMessage(chatId, "⚠️ BU ÜRÜN ŞU ANDA SATIŞTA DEĞİL.", customerMenu);
    return;
  }
  const payload = await createPendingOrder({
    userId,
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
    ...(valid ? {} : { error_message: "⚠️ SİPARİŞ DOĞRULANAMADI. Yeniden deneyin." }),
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
  });

  if (!receipt) {
    logger.warn("Telegram payment could not be matched to a pending order.");
    await sendMessage(
      message.chat.id,
      "⚠️ ÖDEME ALINDI ANCAK SİPARİŞ DOĞRULANAMADI.\n\nLütfen yetkiliyle iletişime geçin.",
      customerMenu,
    );
    const admin = adminId();
    if (admin) {
      await sendMessage(admin, "⚠️ EŞLEŞMEYEN TELEGRAM STARS ÖDEMESİ VAR.\n\nBot kayıtlarını kontrol edin.");
    }
    return;
  }

  const responseText = `✨ ÖDEME TAMAMLANDI\n\n${
    receipt.postPurchaseMessage.trim() ||
    `“${receipt.itemTitle}” için ödemeniz alındı.`
  }`;
  const supportUrl = await getSetting("support_url");
  const markup =
    supportUrl && supportUrl.startsWith("https://")
      ? keyboard([[{ text: "💬 YETKİLİYLE İLETİŞİM", url: supportUrl }]])
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
    await sendMessage(chatId, "📸 LÜTFEN ÜRÜN FOTOĞRAFI GÖNDERİN VEYA ATLA DÜĞMESİNİ KULLANIN.");
    return;
  }
  await saveSession(userId, "product-message", {
    ...session.data,
    photoFileId: photo.file_id,
  });
  await sendMessage(chatId, "✉️ SATIN ALIM SONRASI GÖNDERİLECEK MESAJI YAZIN.\n\nMesaj istemiyorsanız /skip yazın.");
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
    await sendMessage(chatId, `⚠️ METİN ÇOK UZUN. En fazla ${MAX_MESSAGE_LENGTH} karakter gönderin.`);
    return;
  }

  if (session.stage === "product-title") {
    if (!value || value.length > 120) {
      await sendMessage(chatId, "⚠️ ÜRÜN ADI 1–120 KARAKTER OLMALI. Yeniden gönderin.");
      return;
    }
    await saveSession(userId, "product-description", { title: value });
    await sendMessage(chatId, "📝 KISA AÇIKLAMAYI GÖNDERİN (EN FAZLA 800 KARAKTER).");
    return;
  }

  if (session.stage === "product-description") {
    if (value.length > 800) {
      await sendMessage(chatId, "⚠️ AÇIKLAMA EN FAZLA 800 KARAKTER OLABİLİR.");
      return;
    }
    await saveSession(userId, "product-price", {
      ...data,
      description: value,
    });
    await sendMessage(chatId, "⭐ FİYATI TAM SAYI OLARAK TELEGRAM STARS CİNSİNDEN GÖNDERİN.");
    return;
  }

  if (session.stage === "product-price") {
    const price = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(price) || price < 1 || price > 1_000_000_000) {
      await sendMessage(chatId, "⚠️ FİYAT 1 İLE 1.000.000.000 ARASINDA TAM SAYI OLMALI.");
      return;
    }
    await saveSession(userId, "product-photo", { ...data, priceStars: price });
    await sendMessage(
      chatId,
      "📸 ÜRÜN FOTOĞRAFINI GÖNDERİN VEYA FOTOĞRAFSIZ DEVAM ETMEK İÇİN ATLA DÜĞMESİNE BASIN.",
      keyboard([[{ text: "⏭️ FOTOĞRAFI ATLA", callback_data: "adm:photo-skip" }]]),
    );
    return;
  }

  if (session.stage === "product-photo") {
    await sendMessage(
      chatId,
      "📸 ÜRÜN FOTOĞRAFINI GÖNDERİN VEYA FOTOĞRAFSIZ DEVAM ETMEK İÇİN ATLA DÜĞMESİNE BASIN.",
      keyboard([[{ text: "⏭️ FOTOĞRAFI ATLA", callback_data: "adm:photo-skip" }]]),
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
    await sendMessage(chatId, `✅ “${product.title}” ÜRÜNÜ EKLENDİ.`, adminMenu);
    return;
  }

  if (session.stage === "product-message-edit") {
    const id = dataNumber(data, "id");
    await setProductMessage(id, value === "/skip" ? "" : value);
    await sendProductSettings(chatId, id);
    await clearSession(userId);
    return;
  }

  if (session.stage === "support-url") {
    if (value.toLowerCase() === "/clear" || value.toLowerCase() === "off") {
      await setSetting("support_url", "");
      await clearSession(userId);
      await sendMessage(chatId, "✅ YETKİLİ BAĞLANTISI KAPATILDI.", adminMenu);
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      await sendMessage(chatId, "⚠️ GEÇERLİ BİR BAĞLANTI GÖNDERİN. HTTPS:// İLE BAŞLAMALI.");
      return;
    }
    if (parsed.protocol !== "https:") {
      await sendMessage(chatId, "🔒 GÜVENLİK İÇİN BAĞLANTI HTTPS:// İLE BAŞLAMALI.");
      return;
    }
    await setSetting("support_url", parsed.toString());
    await clearSession(userId);
    await sendMessage(chatId, "✅ YETKİLİ BAĞLANTISI KAYDEDİLDİ.", adminMenu);
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

  if (isAdmin(userId) && message.document) {
    await handleBackupDocument(message);
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
    await sendMessage(chatId, "❌ İŞLEM İPTAL EDİLDİ.", adminMenu);
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
    "👇 LÜTFEN MENÜDEKİ BUTONLARDAN BİRİNİ SEÇİN.\n\nAna menüye dönmek için /start yazın.",
    isAdmin(userId) ? adminMenu : customerMenu,
  );
}

async function handleCallback(update: TelegramUpdate): Promise<void> {
  const query = update.callback_query;
  if (!query?.data) return;
  const chatId = query.message?.chat.id ?? query.from.id;
  const userId = query.from.id;
  const data = query.data;

  if ((data.startsWith("adm:") || data.startsWith("backup:")) && !isAdmin(userId)) {
    await acknowledgeCallback(query.id, {
      text: "🔒 BU İŞLEM YÖNETİCİYE ÖZELDİR.",
      show_alert: true,
    });
    return;
  }
  if (!(await acknowledgeCallback(query.id))) return;

  if (data === "menu:home" || data === "menu:admin") {
    await showHome(chatId, userId);
    return;
  }
  if (data === "menu:store") {
    await sendMessage(chatId, "🛍️ MAĞAZA MENÜSÜ", customerMenu);
    return;
  }
  if (data === "menu:products") {
    await showProducts(chatId);
    return;
  }
  if (data === "backup:cancel") {
    await clearSession(userId);
    await sendMessage(chatId, "✅ GERİ YÜKLEME İPTAL EDİLDİ. Mevcut veriler değiştirilmedi.", adminMenu);
    return;
  }
  if (data === "backup:confirm") {
    const session = await getSession(userId);
    if (session?.stage !== "backup-confirm") {
      await sendMessage(chatId, "⚠️ ONAYLANACAK YEDEK BULUNAMADI. Dosyayı yeniden yükleyin.", adminMenu);
      return;
    }
    try {
      const snapshot = parseTelegramBackup(session.data.snapshot);
      await restoreBackup(snapshot);
      await clearSession(userId);
      await sendMessage(
        chatId,
        `✅ YEDEK GERİ YÜKLENDİ\n\n📦 ${snapshot.products.length} ürün · 🧾 ${snapshot.orders.length} sipariş`,
        adminMenu,
      );
    } catch (error) {
      logger.error({ err: error }, "Telegram backup restore failed");
      await sendMessage(
        chatId,
        "⚠️ GERİ YÜKLEME TAMAMLANAMADI. İşlem geri alındı; mevcut veriler değiştirilmedi. Yedeği kontrol edip yeniden deneyin.",
        adminMenu,
      );
    }
    return;
  }
  if (data.startsWith("buy:product:")) {
    const id = asId(data.slice("buy:product:".length));
    if (id) await startPurchase(chatId, userId, id);
    return;
  }

  if (data === "adm:products") {
    await showProducts(chatId, true);
  } else if (data === "adm:add-product") {
    await beginProductCreation(chatId, userId);
  } else if (data === "adm:orders") {
    await showOrders(chatId);
  } else if (data === "adm:support") {
    await saveSession(userId, "support-url", {});
    await showSupportSettings(chatId);
  } else if (data === "adm:backup-export") {
    await exportBackup(chatId);
  } else if (data === "adm:backup-import") {
    await saveSession(userId, "backup-await-file", {});
    await sendMessage(
      chatId,
      "📄 GERİ YÜKLENECEK .JSON YEDEK DOSYASINI GÖNDERİN. Dosya doğrulanınca ayrıca onay isteyeceğim.",
      keyboard([[{ text: "❌ İPTAL ET", callback_data: "backup:cancel" }]]),
    );
  } else if (data === "adm:photo-skip") {
    const session = await getSession(userId);
    if (session?.stage === "product-photo") {
      await saveSession(userId, "product-message", session.data);
        await sendMessage(chatId, "✉️ SATIN ALIM SONRASI GÖNDERİLECEK MESAJI YAZIN.\n\nMesaj istemiyorsanız /skip yazın.");
    }
  } else if (data.startsWith("adm:product-message:")) {
    const id = asId(data.slice("adm:product-message:".length));
    if (id) await beginMessageEdit(chatId, userId, "product", id);
  } else if (data.startsWith("adm:product-toggle:")) {
    const id = asId(data.slice("adm:product-toggle:".length));
    if (id) {
      await toggleProduct(id);
      await sendProductSettings(chatId, id);
    }
  } else if (data.startsWith("adm:product:")) {
    const id = asId(data.slice("adm:product:".length));
    if (id) await sendProductSettings(chatId, id);
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
