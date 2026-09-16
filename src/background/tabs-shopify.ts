import { isShopifyAdminStoreUrl } from "../lib/sessions";
import type { ExtensionMessage } from "../lib/types";

export function storeHandleFromAdminUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/\/store\/([^/]+)/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function inventoryUrlForHandle(handle: string): string {
  return `https://admin.shopify.com/store/${handle}/products/inventory`;
}

export async function waitForAdminTab(
  tabId: number,
  predicate: (url: string) => boolean,
  attempts = 40,
): Promise<chrome.tabs.Tab> {
  for (let i = 0; i < attempts; i += 1) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url && predicate(tab.url) && tab.status === "complete") {
      return tab;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return chrome.tabs.get(tabId);
}

export async function findShopifyAdminTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({});
  return (
    tabs.find((tab) => tab.url && isShopifyAdminStoreUrl(tab.url)) ?? null
  );
}

/** Products → Inventory sayfasını aç / oraya geç (sayfa 1, cursor yok). */
export async function ensureShopifyAdminTab(): Promise<chrome.tabs.Tab> {
  const existing = await findShopifyAdminTab();
  if (existing?.id && existing.url) {
    const handle = storeHandleFromAdminUrl(existing.url);
    if (handle) {
      const target = inventoryUrlForHandle(handle);
      // after=/start= cursor’ları stok taramasını ortada bırakır — her zaman temiz URL
      await chrome.tabs.update(existing.id, { url: target, active: true });
      return waitForAdminTab(
        existing.id,
        (url) =>
          isShopifyAdminStoreUrl(url) && /\/products\/inventory/i.test(url),
      );
    }
  }

  const tab = await chrome.tabs.create({
    url: "https://admin.shopify.com/",
    active: true,
  });
  if (tab.id == null) {
    throw new Error("Shopify Admin sekmesi açılamadı");
  }

  const landed = await waitForAdminTab(tab.id, isShopifyAdminStoreUrl);
  const handle = landed.url ? storeHandleFromAdminUrl(landed.url) : null;
  if (!handle) {
    throw new Error(
      "Shopify Admin mağaza sayfası açılmadı — admin.shopify.com/store/... sekmesini açık tutun",
    );
  }

  const target = inventoryUrlForHandle(handle);
  await chrome.tabs.update(tab.id, { url: target, active: true });
  return waitForAdminTab(
    tab.id,
    (url) => isShopifyAdminStoreUrl(url) && /\/products\/inventory/i.test(url),
  );
}

export async function sendToTab<T>(
  tabId: number,
  file: string,
  message: ExtensionMessage,
): Promise<T> {
  const trySend = async () =>
    (await chrome.tabs.sendMessage(tabId, message)) as T;

  // Navigasyon sonrası content script’in ayağa kalkmasını bekle
  for (let i = 0; i < 20; i += 1) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") break;
    } catch {
      /* sekme kapandı */
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  try {
    return await trySend();
  } catch {
    /* inject / retry below */
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [file],
    });
  } catch {
    // ES module content script programatik inject edilemeyebilir —
    // manifest match ile yüklenmesini bekleriz.
  }

  let lastError: unknown = null;
  for (let i = 0; i < 16; i += 1) {
    await new Promise((r) => setTimeout(r, 300 + i * 80));
    try {
      return await trySend();
    } catch (error) {
      lastError = error;
    }
  }

  const detail =
    lastError instanceof Error ? lastError.message : "bağlantı yok";
  throw new Error(
    `Hipicon/Shopify sekmesine bağlanılamadı (${detail}). ` +
      "İlgili sekmeyi açık tutup sayfayı yenileyin, sonra tekrar deneyin.",
  );
}
