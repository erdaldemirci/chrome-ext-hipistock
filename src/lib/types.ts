import type { CategoryRule } from "./hipicon-categories";
import {
  DEFAULT_CATEGORY_RULES,
  DEFAULT_HIPICON_CATEGORY,
} from "./hipicon-categories";

export type DiscountType = "İndirim Yok" | "Oransal (%)" | "Tutar (TL)";
export type YesNo = "EVET" | "HAYIR";
export type ProductStatus = "active" | "passive";
export type PushMode = "price_stock" | "product_entry";

export type CatalogVariant = {
  shopifyProductId: string;
  shopifyVariantId: string;
  sku: string;
  name: string;
  barcode: string | null;
  brand: string | null;
  category: string | null;
  variant: string | null;
  available: boolean;
  stock: number;
  price: number;
  /**
   * Manuel Hipicon TL fiyatı. null ise Shopify fiyatı × kur (sonu 9) kullanılır.
   */
  priceTry: number | null;
  compareAtPrice: number | null;
  currency: string;
  description: string | null;
  imageUrls: string | null;
  imageUrl: string | null;
  tags: string[];
  productType: string | null;
  handle: string;
  /** Satır bazlı Hipicon kategori override */
  hipiconCategoryId: string | null;
  hipiconCategoryPath: string | null;
  selected: boolean;
  /**
   * Hipicon’a başarıyla aktarıldıysa ISO zaman; ana listeden “Gönderilenler”e taşınır.
   */
  pushedAt: string | null;
  /** Son başarılı aktarım tipi */
  pushedMode: PushMode | null;
};

export type AppSettings = {
  /** Shopify vitrin URL (açık Admin sekmesinden algılanabilir) */
  shopifyStoreUrl: string;
  /** Hipicon mağaza slug’ı (açık Hipicon sekmesinden algılanabilir) */
  storeName: string;
  /** 1 USD = ? TRY (Hipicon Excel fiyatları için) */
  usdTryRate: number;
  /** Son kur kaynağı, örn. TCMB USD Döviz Satış */
  usdTryRateSource: string | null;
  /** Son kur çekim zamanı (ISO) */
  usdTryRateFetchedAt: string | null;
  hasAdminToken: boolean;
  /** Gemini API anahtarı kayıtlı mı (değer UI’ye dönmez) */
  hasGeminiKey: boolean;
  /**
   * Shopify katalog çekerken ürün adı + açıklamayı Gemini ile TR’ye çevir.
   * Key yoksa yok sayılır.
   */
  translateOnSync: boolean;
  /** Hipicon Excel KDV oranı (%), örn. 10 */
  vatRate: number;
  /** Hipicon ana kategori (Excel Meta.categoryId) */
  hipiconCategoryId: string;
  hipiconCategoryPath: string;
  /**
   * Shopify product_type / title / tags / handle → Hipicon kategori.
   * İlk eşleşen kural kazanır; yoksa varsayılan kategori.
   */
  categoryRules: CategoryRule[];
};

export type SiteSession = {
  ok: boolean;
  label: string;
  detail: string;
  loginUrl: string;
};

export type SessionCheckResult = {
  checkedAt: string;
  shopify: SiteSession;
  hipicon: SiteSession;
  ready: boolean;
  /** Oturum kontrolünde boş alanlar sekmelerden doldurulduysa güncel ayarlar */
  settings?: AppSettings;
};

export type CatalogCache = {
  syncedAt: string;
  storeName: string;
  myshopifyDomain: string;
  usedAdminInventory: boolean;
  inventorySource: "session" | "token" | "public";
  variants: CatalogVariant[];
};

export type ExtensionMessage =
  | { type: "GET_SETTINGS" }
  | {
      type: "SAVE_SETTINGS";
      settings: Partial<AppSettings>;
      adminToken?: string;
      clearAdminToken?: boolean;
      geminiApiKey?: string;
      clearGeminiKey?: boolean;
    }
  | { type: "CHECK_SESSIONS" }
  | { type: "OPEN_LOGIN"; site: "shopify" | "hipicon" }
  | { type: "SYNC_SHOPIFY" }
  | { type: "GET_CATALOG" }
  | { type: "CLEAR_CATALOG" }
  | {
      type: "SET_SELECTION";
      selected: boolean;
      /** Tercih edilen kimlik */
      variantIds?: string[];
      /** Geriye uyumluluk */
      skus?: string[];
    }
  | { type: "SELECT_ALL"; selected: boolean }
  | {
      type: "UPDATE_VARIANT";
      sku: string;
      stock?: number;
      price?: number;
      priceTry?: number;
      hipiconCategoryId?: string | null;
      hipiconCategoryPath?: string | null;
    }
  | {
      type: "BULK_UPDATE_SELECTED";
      stock?: number;
      priceTry?: number;
      hipiconCategoryId?: string | null;
      hipiconCategoryPath?: string | null;
    }
  | { type: "REMOVE_SELECTED" }
  | { type: "UNMARK_PUSHED"; variantIds?: string[] }
  | { type: "PUSH_HIPICON"; mode: PushMode; variantIds?: string[] }
  | { type: "DOWNLOAD_EXCEL"; mode: PushMode; variantIds?: string[] }
  | { type: "PROBE_HIPICON" }
  | { type: "DELETE_HIPICON_DRAFTS" }
  | { type: "STOP_DELETE_HIPICON_DRAFTS" }
  | { type: "HIPICON_DELETE_DRAFTS_PAGE" }
  | { type: "HIPICON_ABORT_DELETE_DRAFTS"; active: boolean }
  | { type: "FETCH_USD_TRY_RATE" }
  | { type: "GET_HIPICON_CATEGORIES" }
  | { type: "FETCH_HIPICON_CATEGORIES"; force?: boolean }
  | { type: "FETCH_ADMIN_INVENTORY" }
  | {
      type: "HIPICON_FETCH_CATEGORIES";
    }
  | {
      type: "HIPICON_FETCH_PRODUCT_TEMPLATE";
      categoryId: string;
    }
  | { type: "HIPICON_FETCH_PRICE_STOCK_TEMPLATE" }
  | {
      type: "HIPICON_FETCH_CATEGORIES_RESULT";
      ok: boolean;
      message?: string;
      categories?: Array<{ id: string; path: string }>;
    }
  | {
      type: "HIPICON_STATUS";
      payload: {
        loggedIn: boolean | null;
        url: string;
        foundFileInput: boolean;
        hints: string[];
      };
    }
  | {
      type: "HIPICON_UPLOAD";
      mode: PushMode;
      fileName: string;
      bytesBase64: string;
    }
  | {
      type: "HIPICON_UPLOAD_RESULT";
      ok: boolean;
      message: string;
    }
  | {
      type: "ADMIN_INVENTORY_RESULT";
      ok: boolean;
      message: string;
      byVariantId: Record<string, number>;
      bySku: Record<string, number>;
      storeHandle: string | null;
      count: number;
    };

export const DEFAULT_SETTINGS: AppSettings = {
  shopifyStoreUrl: "",
  storeName: "",
  usdTryRate: 34,
  usdTryRateSource: null,
  usdTryRateFetchedAt: null,
  hasAdminToken: false,
  hasGeminiKey: false,
  translateOnSync: true,
  vatRate: 10,
  hipiconCategoryId: DEFAULT_HIPICON_CATEGORY.id,
  hipiconCategoryPath: DEFAULT_HIPICON_CATEGORY.path,
  categoryRules: DEFAULT_CATEGORY_RULES,
};
