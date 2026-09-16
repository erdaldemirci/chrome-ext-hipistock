import {
  applyLiveCategories,
  getActiveCategories,
  type HipiconCategory,
} from "../lib/hipicon-categories";
import { roundMoney } from "../lib/currency";
import { fetchLiveUsdTryRate } from "../lib/fx";
import { translateVariantsForHipicon } from "../lib/gemini-translate";
import {
  checkBothSessions,
  detectStoresFromOpenTabs,
  resolveMyshopifyStoreUrl,
} from "../lib/sessions";
import { fetchShopifyCatalog } from "../lib/shopify";
import {
  getAdminToken,
  getCatalog,
  getGeminiApiKey,
  getSettings,
  hydrateHipiconCategories,
  saveSettings,
  setAdminToken,
  setCatalog,
  setGeminiApiKey,
  setHipiconCategoriesCache,
} from "../lib/storage";
import type { AppSettings, ExtensionMessage } from "../lib/types";
import {
  inventorySourceLabel,
  requireSessionsReady,
} from "./handlers-sessions";
import {
  deleteAllHipiconDrafts,
  pushOrDownload,
  requestStopDeleteHipiconDrafts,
} from "./push-hipicon";
import { fetchSessionInventory } from "./session-inventory";

/** Eski sürümlerdeki sabit varsayılanlar — bir kez boşaltılır, sekmelerden algılanır. */
const LEGACY_DEFAULT_SHOPIFY = "https://www.loadingbag.com";
const LEGACY_DEFAULT_HIPICON = "designeroffice";

async function bootstrapStoreSettings(): Promise<AppSettings> {
  let settings = await getSettings();
  const { storeDefaultsCleared } = await chrome.storage.local.get(
    "storeDefaultsCleared",
  );

  if (!storeDefaultsCleared) {
    const patch: Partial<AppSettings> = {};
    if (settings.shopifyStoreUrl.trim() === LEGACY_DEFAULT_SHOPIFY) {
      patch.shopifyStoreUrl = "";
    }
    if (settings.storeName.trim() === LEGACY_DEFAULT_HIPICON) {
      patch.storeName = "";
    }
    await chrome.storage.local.set({ storeDefaultsCleared: true });
    if (Object.keys(patch).length > 0) {
      settings = await saveSettings(patch);
    }
  }

  const needShopify = !settings.shopifyStoreUrl.trim();
  const needHipicon = !settings.storeName.trim();
  if (!needShopify && !needHipicon) return settings;

  const detected = await detectStoresFromOpenTabs();
  const patch: Partial<AppSettings> = {};
  if (needShopify && detected.shopifyStoreUrl) {
    patch.shopifyStoreUrl = detected.shopifyStoreUrl;
  }
  if (needHipicon && detected.storeName) {
    patch.storeName = detected.storeName;
  }
  if (Object.keys(patch).length === 0) return settings;

  return saveSettings(patch);
}
import {
  ensureHipiconBulkTab,
  ensureHipiconSessionTab,
  sendToHipiconTab,
} from "./tabs-hipicon";

const CATEGORY_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type HipiconCategoriesPayload = {
  categories: HipiconCategory[];
  bagCount: number;
  fetchedAt: string | null;
  source: "live" | "bundled";
};

async function categoriesPayload(
  source: "live" | "bundled",
  fetchedAt: string | null,
): Promise<HipiconCategoriesPayload> {
  const categories = getActiveCategories();
  return {
    categories,
    bagCount: categories.filter((c) => /çanta/i.test(c.path)).length,
    fetchedAt,
    source,
  };
}

async function fetchAndCacheHipiconCategories(): Promise<HipiconCategoriesPayload> {
  const settings = await getSettings();
  const tab = await ensureHipiconSessionTab(settings.storeName);
  if (!tab.id) throw new Error("Hipicon sekmesi yok");
  await new Promise((r) => setTimeout(r, 600));

  const result = await sendToHipiconTab<{
    ok: boolean;
    message?: string;
    categories?: HipiconCategory[];
  }>(tab.id, { type: "HIPICON_FETCH_CATEGORIES" });

  if (!result?.ok || !result.categories?.length) {
    throw new Error(result?.message || "Hipicon kategorileri alınamadı");
  }

  const fetchedAt = new Date().toISOString();
  await setHipiconCategoriesCache({
    fetchedAt,
    categories: result.categories,
  });
  applyLiveCategories(result.categories);
  return categoriesPayload("live", fetchedAt);
}

type SendResponse = (response: unknown) => void;

export async function handleMessage(
  message: ExtensionMessage,
  sendResponse: SendResponse,
): Promise<void> {
  switch (message.type) {
    case "GET_SETTINGS":
      sendResponse({ ok: true, data: await getSettings() });
      return;
    case "SAVE_SETTINGS": {
      if (message.clearAdminToken) {
        await setAdminToken(null);
      } else if (
        typeof message.adminToken === "string" &&
        message.adminToken.trim()
      ) {
        await setAdminToken(message.adminToken.trim());
      }
      if (message.clearGeminiKey) {
        await setGeminiApiKey(null);
      } else if (
        typeof message.geminiApiKey === "string" &&
        message.geminiApiKey.trim()
      ) {
        await setGeminiApiKey(message.geminiApiKey.trim());
      }
      const settings = await saveSettings(message.settings);
      sendResponse({ ok: true, data: settings });
      return;
    }
    case "CHECK_SESSIONS": {
      const settings = await bootstrapStoreSettings();
      const sessions = await checkBothSessions({
        shopifyStoreUrl: settings.shopifyStoreUrl,
        storeName: settings.storeName,
      });
      sendResponse({
        ok: true,
        data: { ...sessions, settings },
      });
      return;
    }
    case "OPEN_LOGIN": {
      const settings = await getSettings();
      const sessions = await checkBothSessions({
        shopifyStoreUrl: settings.shopifyStoreUrl,
        storeName: settings.storeName,
      });
      const target =
        message.site === "shopify"
          ? sessions.shopify.loginUrl
          : sessions.hipicon.loginUrl;
      await chrome.tabs.create({ url: target, active: true });
      sendResponse({ ok: true, data: { url: target } });
      return;
    }
    case "SYNC_SHOPIFY": {
      await requireSessionsReady();
      const settings = await getSettings();
      const adminToken = (await getAdminToken()) ?? undefined;

      let sessionByVariant: Map<string, number> | undefined;
      let sessionBySku: Map<string, number> | undefined;
      let sessionNote = "";
      let sessionOk = false;

      try {
        const inv = await fetchSessionInventory();
        sessionNote = inv.message;
        const variantN = Object.keys(inv.byVariantId ?? {}).length;
        const skuN = Object.keys(inv.bySku ?? {}).length;
        const strong =
          inv.ok && inv.count > 0 && (variantN > 0 || skuN >= 10);
        if (strong) {
          sessionByVariant = new Map(Object.entries(inv.byVariantId));
          sessionBySku = new Map(Object.entries(inv.bySku));
          sessionOk = true;
        }
      } catch (error) {
        sessionNote =
          error instanceof Error
            ? error.message
            : "Admin oturum stoku alınamadı";
      }

      if (!sessionOk && !adminToken?.trim()) {
        throw new Error(
          `Kesin stok alınamadı (Admin oturum). ${sessionNote} ` +
            "Admin → Products → Inventory açık olsun; veya Ayarlar’a custom app token (shpat_…, read_products + read_inventory) ekleyin.",
        );
      }

      let catalog;
      let previousForMerge = await getCatalog();
      try {
        const storeUrl = await resolveMyshopifyStoreUrl(
          settings.shopifyStoreUrl,
          previousForMerge?.myshopifyDomain,
        );
        if (storeUrl !== settings.shopifyStoreUrl.trim().replace(/\/$/, "")) {
          await saveSettings({ shopifyStoreUrl: storeUrl });
        }
        catalog = await fetchShopifyCatalog({
          storeUrl,
          adminToken,
          sessionInventoryByVariant: sessionByVariant,
          sessionInventoryBySku: sessionBySku,
          requireExactInventory: true,
        });
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : "stok birleştirilemedi";
        throw new Error(
          `Kesin stok yok. Oturum: ${sessionNote || "yok"}. ${detail}`,
        );
      }

      if (
        catalog.inventorySource !== "session" &&
        catalog.inventorySource !== "token"
      ) {
        throw new Error(
          `Stok kaynağı public’e düştü — bu artık engelleniyor. Oturum: ${sessionNote}`,
        );
      }

      const previous = previousForMerge;
      const prevBySku = new Map(
        (previous?.variants ?? []).map((v) => [v.sku, v]),
      );
      const freshSkus = new Set(catalog.variants.map((v) => v.sku));
      let added = 0;
      let updated = 0;
      const removed = (previous?.variants ?? []).filter(
        (v) => !freshSkus.has(v.sku),
      ).length;

      const variants = catalog.variants.map((v) => {
        const prev = prevBySku.get(v.sku);
        if (prev) {
          updated += 1;
          const usdChanged = prev.price !== v.price;
          return {
            ...v,
            selected: prev.selected,
            priceTry: usdChanged ? null : (prev.priceTry ?? null),
            hipiconCategoryId: prev.hipiconCategoryId ?? null,
            hipiconCategoryPath: prev.hipiconCategoryPath ?? null,
            pushedAt: prev.pushedAt ?? null,
            pushedMode: prev.pushedMode ?? null,
          };
        }
        added += 1;
        return {
          ...v,
          selected: false,
          priceTry: null,
          hipiconCategoryId: null,
          hipiconCategoryPath: null,
          pushedAt: null,
          pushedMode: null,
        };
      });

      let finalVariants = variants;
      let translateNote = "";
      if (settings.translateOnSync) {
        const geminiKey = await getGeminiApiKey();
        if (geminiKey) {
          finalVariants = await translateVariantsForHipicon(
            variants,
            geminiKey,
          );
          translateNote = " · Gemini TR çeviri";
        }
      }

      const payload = {
        syncedAt: new Date().toISOString(),
        storeName: catalog.meta.name,
        myshopifyDomain: catalog.meta.myshopifyDomain,
        usedAdminInventory: catalog.usedAdminInventory,
        inventorySource: catalog.inventorySource,
        variants: finalVariants,
      };
      await setCatalog(payload);

      const delta = [
        added ? `+${added}` : null,
        updated ? `↻${updated}` : null,
        removed ? `−${removed}` : null,
      ]
        .filter(Boolean)
        .join(" ");

      sendResponse({
        ok: true,
        data: {
          count: payload.variants.length,
          added,
          updated,
          removed,
          usedAdminInventory: payload.usedAdminInventory,
          inventorySource: payload.inventorySource,
          storeName: payload.storeName,
          syncedAt: payload.syncedAt,
          note:
            (sessionNote || inventorySourceLabel(payload.inventorySource)) +
            (delta ? ` · ${delta}` : "") +
            translateNote,
        },
      });
      return;
    }
    case "GET_CATALOG":
      sendResponse({ ok: true, data: await getCatalog() });
      return;
    case "CLEAR_CATALOG":
      await setCatalog(null);
      sendResponse({ ok: true, data: null });
      return;
    case "SET_SELECTION": {
      const catalog = await getCatalog();
      if (!catalog) throw new Error("Katalog yok");
      const variantIds = (message.variantIds ?? [])
        .map((id) => String(id).trim())
        .filter(Boolean);
      const skus = (message.skus ?? [])
        .map((sku) => String(sku).trim())
        .filter(Boolean);
      if (!variantIds.length && !skus.length) {
        throw new Error("Seçim için varyant veya SKU gerekli");
      }
      const idSet = new Set(variantIds);
      const skuSet = new Set(skus);
      catalog.variants = catalog.variants.map((v) => {
        const match = idSet.size
          ? idSet.has(String(v.shopifyVariantId ?? "").trim())
          : skuSet.has(String(v.sku ?? "").trim());
        return match ? { ...v, selected: message.selected } : v;
      });
      await setCatalog(catalog);
      sendResponse({ ok: true, data: catalog });
      return;
    }
    case "SELECT_ALL": {
      const catalog = await getCatalog();
      if (!catalog) throw new Error("Katalog yok");
      catalog.variants = catalog.variants.map((v) => ({
        ...v,
        selected: message.selected,
      }));
      await setCatalog(catalog);
      sendResponse({ ok: true, data: catalog });
      return;
    }
    case "REMOVE_SELECTED": {
      const catalog = await getCatalog();
      if (!catalog) throw new Error("Katalog yok");
      const before = catalog.variants.length;
      const remaining = catalog.variants.filter((v) => !v.selected);
      const removed = before - remaining.length;
      if (!removed) throw new Error("Silinecek seçili ürün yok");
      if (!remaining.length) {
        await setCatalog(null);
        sendResponse({
          ok: true,
          data: { catalog: null, removed },
        });
        return;
      }
      const next = { ...catalog, variants: remaining };
      await setCatalog(next);
      sendResponse({ ok: true, data: { catalog: next, removed } });
      return;
    }
    case "UNMARK_PUSHED": {
      const catalog = await getCatalog();
      if (!catalog) throw new Error("Katalog yok");
      const ids = (message.variantIds ?? [])
        .map((id) => String(id).trim())
        .filter(Boolean);
      const idSet = ids.length
        ? new Set(ids)
        : new Set(
            catalog.variants
              .filter((v) => v.selected)
              .map((v) => String(v.shopifyVariantId ?? "").trim())
              .filter(Boolean),
          );
      if (!idSet.size) throw new Error("Geri alınacak ürün yok");
      let count = 0;
      catalog.variants = catalog.variants.map((v) => {
        const id = String(v.shopifyVariantId ?? "").trim();
        if (!idSet.has(id) || !v.pushedAt) return v;
        count += 1;
        return { ...v, pushedAt: null, pushedMode: null, selected: false };
      });
      if (!count) throw new Error("Seçili gönderilen ürün yok");
      await setCatalog(catalog);
      sendResponse({ ok: true, data: { catalog, count } });
      return;
    }
    case "UPDATE_VARIANT": {
      const catalog = await getCatalog();
      if (!catalog) throw new Error("Katalog yok");
      const sku = message.sku.trim();
      if (!sku) throw new Error("SKU gerekli");
      let found = false;
      catalog.variants = catalog.variants.map((v) => {
        if (v.sku !== sku) return v;
        found = true;
        const next = { ...v };
        if (typeof message.stock === "number" && Number.isFinite(message.stock)) {
          next.stock = Math.max(0, Math.round(message.stock));
          next.available = next.stock > 0;
        }
        if (typeof message.price === "number" && Number.isFinite(message.price)) {
          next.price = Math.max(0, message.price);
        }
        if (
          typeof message.priceTry === "number" &&
          Number.isFinite(message.priceTry)
        ) {
          const n = Math.max(0, message.priceTry);
          next.priceTry = n > 0 ? roundMoney(n) : null;
        }
        if (message.hipiconCategoryId !== undefined) {
          next.hipiconCategoryId = message.hipiconCategoryId;
          next.hipiconCategoryPath = message.hipiconCategoryPath ?? null;
        }
        return next;
      });
      if (!found) throw new Error(`SKU bulunamadı: ${sku}`);
      await setCatalog(catalog);
      sendResponse({ ok: true, data: catalog });
      return;
    }
    case "BULK_UPDATE_SELECTED": {
      const catalog = await getCatalog();
      if (!catalog) throw new Error("Katalog yok");
      const hasStock =
        typeof message.stock === "number" && Number.isFinite(message.stock);
      const hasPriceTry =
        typeof message.priceTry === "number" &&
        Number.isFinite(message.priceTry);
      const hasCategory = message.hipiconCategoryId !== undefined;
      if (!hasStock && !hasPriceTry && !hasCategory) {
        throw new Error("Güncellenecek alan yok");
      }

      let updated = 0;
      catalog.variants = catalog.variants.map((v) => {
        if (!v.selected) return v;
        updated += 1;
        const next = { ...v };
        if (hasStock) {
          next.stock = Math.max(0, Math.round(message.stock!));
          next.available = next.stock > 0;
        }
        if (hasPriceTry) {
          const n = Math.max(0, message.priceTry!);
          next.priceTry = n > 0 ? roundMoney(n) : null;
        }
        if (hasCategory) {
          next.hipiconCategoryId = message.hipiconCategoryId ?? null;
          next.hipiconCategoryPath = message.hipiconCategoryPath ?? null;
        }
        return next;
      });
      if (!updated) throw new Error("Seçili ürün yok");
      await setCatalog(catalog);
      sendResponse({ ok: true, data: { catalog, updated } });
      return;
    }
    case "DOWNLOAD_EXCEL":
      sendResponse({
        ok: true,
        data: await pushOrDownload(
          message.mode,
          true,
          message.variantIds,
        ),
      });
      return;
    case "PUSH_HIPICON":
      sendResponse({
        ok: true,
        data: await pushOrDownload(
          message.mode,
          false,
          message.variantIds,
        ),
      });
      return;
    case "DELETE_HIPICON_DRAFTS":
      sendResponse({
        ok: true,
        data: await deleteAllHipiconDrafts(),
      });
      return;
    case "STOP_DELETE_HIPICON_DRAFTS":
      sendResponse({
        ok: true,
        data: requestStopDeleteHipiconDrafts(),
      });
      return;
    case "PROBE_HIPICON": {
      await requireSessionsReady();
      const settings = await getSettings();
      const tab = await ensureHipiconBulkTab(settings.storeName);
      if (!tab.id) throw new Error("Hipicon sekmesi yok");
      await new Promise((r) => setTimeout(r, 1000));
      const probe = await sendToHipiconTab<{
        loggedIn: boolean | null;
        url: string;
        foundFileInput: boolean;
        hints: string[];
      }>(tab.id, { type: "PROBE_HIPICON" });
      sendResponse({ ok: true, data: probe });
      return;
    }
    case "FETCH_USD_TRY_RATE": {
      const quote = await fetchLiveUsdTryRate();
      const settings = await saveSettings({
        usdTryRate: quote.rate,
        usdTryRateSource: quote.source,
        usdTryRateFetchedAt: quote.fetchedAt,
      });
      sendResponse({
        ok: true,
        data: {
          rate: quote.rate,
          source: quote.source,
          fetchedAt: quote.fetchedAt,
          settings,
        },
      });
      return;
    }
    case "GET_HIPICON_CATEGORIES": {
      const hydrated = await hydrateHipiconCategories();
      sendResponse({
        ok: true,
        data: await categoriesPayload(hydrated.source, hydrated.fetchedAt),
      });
      return;
    }
    case "FETCH_HIPICON_CATEGORIES": {
      const hydrated = await hydrateHipiconCategories();
      const ageMs = hydrated.fetchedAt
        ? Date.now() - Date.parse(hydrated.fetchedAt)
        : Number.POSITIVE_INFINITY;
      const fresh =
        hydrated.source === "live" &&
        Number.isFinite(ageMs) &&
        ageMs < CATEGORY_CACHE_MAX_AGE_MS;
      if (!message.force && fresh) {
        sendResponse({
          ok: true,
          data: await categoriesPayload("live", hydrated.fetchedAt),
        });
        return;
      }
      try {
        sendResponse({
          ok: true,
          data: await fetchAndCacheHipiconCategories(),
        });
      } catch (error) {
        if (hydrated.source === "live" && hydrated.categories.length) {
          sendResponse({
            ok: true,
            data: await categoriesPayload("live", hydrated.fetchedAt),
          });
          return;
        }
        throw error;
      }
      return;
    }
    case "FETCH_ADMIN_INVENTORY":
    case "ADMIN_INVENTORY_RESULT":
    case "HIPICON_STATUS":
    case "HIPICON_UPLOAD":
    case "HIPICON_UPLOAD_RESULT":
    case "HIPICON_DELETE_DRAFTS_PAGE":
    case "HIPICON_ABORT_DELETE_DRAFTS":
    case "HIPICON_FETCH_CATEGORIES":
    case "HIPICON_FETCH_PRODUCT_TEMPLATE":
    case "HIPICON_FETCH_PRICE_STOCK_TEMPLATE":
    case "HIPICON_FETCH_CATEGORIES_RESULT":
      sendResponse({ ok: false, error: "Bu mesaj content script içindir" });
      return;
    default: {
      const _exhaustive: never = message;
      void _exhaustive;
      sendResponse({ ok: false, error: "Bilinmeyen mesaj" });
    }
  }
}
