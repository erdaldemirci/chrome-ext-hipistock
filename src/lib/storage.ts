import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type CatalogCache,
} from "./types";
import {
  applyLiveCategories,
  categoryById,
  DEFAULT_CATEGORY_RULES,
  DEFAULT_HIPICON_CATEGORY,
  getActiveCategories,
  type CategoryRule,
  type HipiconCategory,
} from "./hipicon-categories";
import { normalizeShopifyStoreUrl } from "./constants";

const KEYS = {
  settings: "settings",
  catalog: "catalog",
  adminToken: "adminToken",
  geminiApiKey: "geminiApiKey",
  hipiconCategories: "hipiconCategories",
} as const;

export type HipiconCategoriesCache = {
  fetchedAt: string;
  categories: HipiconCategory[];
};

type LegacySettings = Partial<AppSettings> & {
  storeUrl?: string;
  hipiconBaseUrl?: string;
  categoryPath?: string;
  categoryId?: string;
  /** Eski ayar adı */
  translateOnPush?: boolean;
};

function normalizeRules(raw: unknown): CategoryRule[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_CATEGORY_RULES.map((r) => ({ ...r }));
  }
  const out: CategoryRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const pattern = String((item as CategoryRule).pattern ?? "").trim();
    const categoryId = String((item as CategoryRule).categoryId ?? "").trim();
    if (!pattern || !categoryId) continue;
    out.push({ pattern, categoryId });
  }
  return out.length ? out : DEFAULT_CATEGORY_RULES.map((r) => ({ ...r }));
}

function normalizeSettings(raw: LegacySettings | undefined): AppSettings {
  const merged = { ...DEFAULT_SETTINGS, ...raw };
  let storeName = (merged.storeName || "").trim();
  let shopifyStoreUrl = (
    merged.shopifyStoreUrl ||
    raw?.storeUrl ||
    ""
  ).trim();

  if (!storeName && raw?.hipiconBaseUrl) {
    try {
      storeName = new URL(raw.hipiconBaseUrl).hostname.split(".")[0] || "";
    } catch {
      storeName = "";
    }
  }

  const rateRaw = Number(merged.usdTryRate);
  const usdTryRate =
    Number.isFinite(rateRaw) && rateRaw > 0
      ? rateRaw
      : DEFAULT_SETTINGS.usdTryRate;

  const vatRaw = Number(merged.vatRate);
  const vatRate =
    Number.isFinite(vatRaw) && vatRaw >= 0
      ? vatRaw
      : DEFAULT_SETTINGS.vatRate;

  const legacyId = String(
    merged.hipiconCategoryId || raw?.categoryId || "",
  ).trim();
  const legacyPath = String(
    merged.hipiconCategoryPath || raw?.categoryPath || "",
  ).trim();
  const cat =
    categoryById(legacyId) ??
    (legacyPath
      ? { id: legacyId || DEFAULT_HIPICON_CATEGORY.id, path: legacyPath }
      : DEFAULT_HIPICON_CATEGORY);

  return {
    shopifyStoreUrl: normalizeShopifyStoreUrl(shopifyStoreUrl),
    storeName,
    usdTryRate,
    usdTryRateSource:
      typeof merged.usdTryRateSource === "string" &&
      merged.usdTryRateSource.trim()
        ? merged.usdTryRateSource.trim()
        : null,
    usdTryRateFetchedAt:
      typeof merged.usdTryRateFetchedAt === "string" &&
      merged.usdTryRateFetchedAt.trim()
        ? merged.usdTryRateFetchedAt.trim()
        : null,
    hasAdminToken: false,
    hasGeminiKey: false,
    translateOnSync: (() => {
      if (typeof merged.translateOnSync === "boolean") {
        return merged.translateOnSync;
      }
      if (typeof raw?.translateOnPush === "boolean") {
        return raw.translateOnPush;
      }
      return DEFAULT_SETTINGS.translateOnSync;
    })(),
    vatRate,
    hipiconCategoryId: cat.id,
    hipiconCategoryPath: cat.path,
    categoryRules: normalizeRules(merged.categoryRules),
  };
}

export async function getSettings(): Promise<AppSettings> {
  const data = await chrome.storage.local.get(KEYS.settings);
  const settings = normalizeSettings(
    data[KEYS.settings] as LegacySettings | undefined,
  );
  const token = await getAdminToken();
  const gemini = await getGeminiApiKey();
  return {
    ...settings,
    hasAdminToken: Boolean(token),
    hasGeminiKey: Boolean(gemini),
  };
}

export async function saveSettings(
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  const current = await getSettings();
  const next = normalizeSettings({ ...current, ...patch });

  await chrome.storage.local.set({
    [KEYS.settings]: {
      shopifyStoreUrl: next.shopifyStoreUrl,
      storeName: next.storeName,
      usdTryRate: next.usdTryRate,
      usdTryRateSource: next.usdTryRateSource,
      usdTryRateFetchedAt: next.usdTryRateFetchedAt,
      vatRate: next.vatRate,
      translateOnSync: next.translateOnSync,
      hipiconCategoryId: next.hipiconCategoryId,
      hipiconCategoryPath: next.hipiconCategoryPath,
      categoryRules: next.categoryRules,
    },
  });
  return getSettings();
}

export async function getAdminToken(): Promise<string | null> {
  const data = await chrome.storage.local.get(KEYS.adminToken);
  const token = data[KEYS.adminToken];
  return typeof token === "string" && token.trim() ? token : null;
}

export async function setAdminToken(token: string | null): Promise<void> {
  if (!token?.trim()) {
    await chrome.storage.local.remove(KEYS.adminToken);
    return;
  }
  await chrome.storage.local.set({ [KEYS.adminToken]: token.trim() });
}

export async function getGeminiApiKey(): Promise<string | null> {
  const data = await chrome.storage.local.get(KEYS.geminiApiKey);
  const key = data[KEYS.geminiApiKey];
  return typeof key === "string" && key.trim() ? key.trim() : null;
}

export async function setGeminiApiKey(key: string | null): Promise<void> {
  if (!key?.trim()) {
    await chrome.storage.local.remove(KEYS.geminiApiKey);
    return;
  }
  await chrome.storage.local.set({ [KEYS.geminiApiKey]: key.trim() });
}

export async function getCatalog(): Promise<CatalogCache | null> {
  const data = await chrome.storage.local.get(KEYS.catalog);
  const raw = data[KEYS.catalog] as CatalogCache | undefined;
  if (!raw) return null;
  return {
    ...raw,
    inventorySource:
      raw.inventorySource ??
      (raw.usedAdminInventory ? "token" : "public"),
    variants: (raw.variants ?? []).map((v) => ({
      ...v,
      shopifyVariantId: String(v.shopifyVariantId ?? "").trim(),
      shopifyProductId: String(v.shopifyProductId ?? "").trim(),
      sku: String(v.sku ?? "").trim(),
      priceTry: v.priceTry ?? null,
      hipiconCategoryId: v.hipiconCategoryId ?? null,
      hipiconCategoryPath: v.hipiconCategoryPath ?? null,
      selected: Boolean(v.selected),
      pushedAt:
        typeof v.pushedAt === "string" && v.pushedAt.trim()
          ? v.pushedAt.trim()
          : null,
      pushedMode:
        v.pushedMode === "price_stock" || v.pushedMode === "product_entry"
          ? v.pushedMode
          : null,
    })),
  };
}

export async function setCatalog(catalog: CatalogCache | null): Promise<void> {
  if (!catalog) {
    await chrome.storage.local.remove(KEYS.catalog);
    return;
  }
  await chrome.storage.local.set({ [KEYS.catalog]: catalog });
}

function normalizeCategoryList(raw: unknown): HipiconCategory[] {
  if (!Array.isArray(raw)) return [];
  const out: HipiconCategory[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const id = String((item as HipiconCategory).id ?? "").trim();
    const path = String((item as HipiconCategory).path ?? "").trim();
    if (!id || !path || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, path });
  }
  return out;
}

export async function getHipiconCategoriesCache(): Promise<HipiconCategoriesCache | null> {
  const data = await chrome.storage.local.get(KEYS.hipiconCategories);
  const raw = data[KEYS.hipiconCategories] as HipiconCategoriesCache | undefined;
  if (!raw) return null;
  const categories = normalizeCategoryList(raw.categories);
  if (!categories.length) return null;
  return {
    fetchedAt:
      typeof raw.fetchedAt === "string" && raw.fetchedAt.trim()
        ? raw.fetchedAt
        : new Date(0).toISOString(),
    categories,
  };
}

export async function setHipiconCategoriesCache(
  cache: HipiconCategoriesCache | null,
): Promise<void> {
  if (!cache?.categories.length) {
    await chrome.storage.local.remove(KEYS.hipiconCategories);
    applyLiveCategories(null);
    return;
  }
  const categories = normalizeCategoryList(cache.categories);
  await chrome.storage.local.set({
    [KEYS.hipiconCategories]: {
      fetchedAt: cache.fetchedAt || new Date().toISOString(),
      categories,
    },
  });
  applyLiveCategories(categories);
}

/** Cache varsa aktif havuza uygular; yoksa bundled kalır. */
export async function hydrateHipiconCategories(): Promise<{
  categories: HipiconCategory[];
  fetchedAt: string | null;
  source: "live" | "bundled";
}> {
  const cache = await getHipiconCategoriesCache();
  if (cache) {
    applyLiveCategories(cache.categories);
    return {
      categories: getActiveCategories(),
      fetchedAt: cache.fetchedAt,
      source: "live",
    };
  }
  applyLiveCategories(null);
  return {
    categories: getActiveCategories(),
    fetchedAt: null,
    source: "bundled",
  };
}
