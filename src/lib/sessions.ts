import { hipiconBulkUrl, hipiconOrigin } from "./constants";
import { fetchShopifyStoreMeta } from "./shopify";

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
};

const HIPICON_SKIP_SUBDOMAINS = new Set([
  "www",
  "api",
  "bo-api",
  "cdn",
  "static",
  "img",
  "images",
]);

function looksLikeLoginUrl(url: string): boolean {
  const u = url.toLowerCase();
  return (
    u.includes("/login") ||
    u.includes("accounts.shopify.com") ||
    u.includes("/signin") ||
    u.includes("/sign-in") ||
    u.includes("authenticate")
  );
}

export function isShopifyAdminStoreUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.hostname === "admin.shopify.com") {
      return /^\/store\/[^/]+/i.test(u.pathname);
    }
    if (u.hostname.endsWith(".myshopify.com")) {
      return u.pathname.startsWith("/admin") && !looksLikeLoginUrl(url);
    }
  } catch {
    return false;
  }
  return false;
}

function shopifyHandleFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "admin.shopify.com") {
      const m = u.pathname.match(/^\/store\/([^/]+)/i);
      return m?.[1]?.trim().toLowerCase() || null;
    }
    if (u.hostname.endsWith(".myshopify.com")) {
      return u.hostname.replace(/\.myshopify\.com$/i, "").toLowerCase() || null;
    }
  } catch {
    return null;
  }
  return null;
}

function hipiconSlugFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const m = u.hostname.match(/^([a-z0-9-]+)\.hipicon\.com$/i);
    if (!m) return null;
    const slug = m[1]!.toLowerCase();
    if (HIPICON_SKIP_SUBDOMAINS.has(slug)) return null;
    return slug;
  } catch {
    return null;
  }
}

async function findOpenTab(match: (url: string) => boolean): Promise<string | null> {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.url) continue;
    if (match(tab.url)) return tab.url;
  }
  return null;
}

async function fetchFinalUrl(url: string): Promise<string> {
  const res = await fetch(url, {
    credentials: "include",
    redirect: "follow",
    cache: "no-store",
    method: "GET",
  });
  return res.url || url;
}

/** Açık sekmelerden Shopify vitrin URL + Hipicon mağaza slug’ı çıkar. */
export async function detectStoresFromOpenTabs(): Promise<{
  shopifyStoreUrl: string | null;
  storeName: string | null;
}> {
  const tabs = await chrome.tabs.query({});
  let storeName: string | null = null;
  let shopifyHandle: string | null = null;

  for (const tab of tabs) {
    if (!tab.url) continue;
    if (!storeName) {
      const slug = hipiconSlugFromUrl(tab.url);
      if (slug) storeName = slug;
    }
    if (!shopifyHandle) {
      const handle = shopifyHandleFromUrl(tab.url);
      if (handle) shopifyHandle = handle;
    }
  }

  let shopifyStoreUrl: string | null = null;
  if (shopifyHandle) {
    // Katalog çekimi host izni için *.myshopify.com kullan (özel domain gerekmez)
    shopifyStoreUrl = `https://${shopifyHandle}.myshopify.com`;
  }

  return { shopifyStoreUrl, storeName };
}

function asMyshopifyHttps(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/$/, "");
  if (!trimmed) return null;
  try {
    const withScheme = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const host = new URL(withScheme).hostname.toLowerCase();
    if (host.endsWith(".myshopify.com")) return `https://${host}`;
    // yalnızca handle verilmişse (örn. 6153ea-2)
    if (/^[a-z0-9][a-z0-9-]*$/i.test(trimmed) && !trimmed.includes(".")) {
      return `https://${trimmed.toLowerCase()}.myshopify.com`;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Katalog API için *.myshopify.com URL’si.
 * Ayarlarda özel domain olsa bile açık Admin sekmesinden handle alınır
 * (örn. admin.shopify.com/store/6153ea-2 → 6153ea-2.myshopify.com).
 */
export async function resolveMyshopifyStoreUrl(
  preferredUrl: string,
  fallbackMyshopifyDomain?: string | null,
): Promise<string> {
  const fromPreferred = asMyshopifyHttps(preferredUrl);
  if (fromPreferred) return fromPreferred;

  const fromFallback = fallbackMyshopifyDomain
    ? asMyshopifyHttps(fallbackMyshopifyDomain)
    : null;
  if (fromFallback) return fromFallback;

  const detected = await detectStoresFromOpenTabs();
  if (detected.shopifyStoreUrl) return detected.shopifyStoreUrl;

  throw new Error(
    "Shopify *.myshopify.com adresi bulunamadı. Admin’de mağaza paneli açık olsun (admin.shopify.com/store/…) veya Ayarlar’a https://magaza.myshopify.com yazın.",
  );
}

export async function checkShopifySession(
  shopifyStoreUrl: string,
): Promise<SiteSession> {
  const loginUrl = "https://admin.shopify.com/";

  const openAdmin = await findOpenTab(isShopifyAdminStoreUrl);
  if (openAdmin) {
    return {
      ok: true,
      label: "Shopify Admin",
      detail: `Açık sekme: ${openAdmin.replace(/^https?:\/\//, "").slice(0, 64)}`,
      loginUrl: openAdmin,
    };
  }

  try {
    const finalAdmin = await fetchFinalUrl(loginUrl);
    if (isShopifyAdminStoreUrl(finalAdmin)) {
      return {
        ok: true,
        label: "Shopify Admin",
        detail: `Oturum açık (${new URL(finalAdmin).pathname})`,
        loginUrl: finalAdmin,
      };
    }
    if (looksLikeLoginUrl(finalAdmin)) {
      return {
        ok: false,
        label: "Shopify Admin",
        detail: "Oturum yok — admin.shopify.com’a giriş yapın",
        loginUrl,
      };
    }

    if (shopifyStoreUrl.trim()) {
      try {
        const meta = await fetchShopifyStoreMeta(shopifyStoreUrl);
        if (meta.myshopifyDomain) {
          const legacyAdmin = `https://${meta.myshopifyDomain}/admin`;
          const finalLegacy = await fetchFinalUrl(legacyAdmin);
          if (
            isShopifyAdminStoreUrl(finalLegacy) ||
            finalLegacy.includes("/admin")
          ) {
            if (!looksLikeLoginUrl(finalLegacy)) {
              return {
                ok: true,
                label: "Shopify Admin",
                detail: `${meta.myshopifyDomain} oturumu açık`,
                loginUrl: finalLegacy,
              };
            }
          }
        }
      } catch {
        /* özel domain / meta yok — admin sekmesi yeterli */
      }
    }

    return {
      ok: false,
      label: "Shopify Admin",
      detail:
        "Oturum bulunamadı — admin.shopify.com’da mağaza panelini açık tutun",
      loginUrl,
    };
  } catch (error) {
    return {
      ok: false,
      label: "Shopify Admin",
      detail:
        error instanceof Error
          ? error.message
          : "Shopify oturumu kontrol edilemedi",
      loginUrl,
    };
  }
}

export async function checkHipiconSession(
  storeName: string,
): Promise<SiteSession> {
  const slug = storeName.trim().toLowerCase().replace(/\.hipicon\.com$/i, "");

  const openHipicon = await findOpenTab((url) => {
    const found = hipiconSlugFromUrl(url);
    if (!found || looksLikeLoginUrl(url)) return false;
    if (!slug) return true;
    return found === slug;
  });

  if (openHipicon) {
    let host = "hipicon.com";
    try {
      host = new URL(openHipicon).hostname;
    } catch {
      /* ignore */
    }
    return {
      ok: true,
      label: "Hipicon",
      detail: `${host} oturumu açık`,
      loginUrl: openHipicon.includes("/products")
        ? openHipicon
        : slug
          ? hipiconBulkUrl(slug)
          : openHipicon,
    };
  }

  if (!slug) {
    return {
      ok: false,
      label: "Hipicon",
      detail:
        "Mağaza adı yok — Hipicon panelini açın veya Ayarlar’dan girin",
      loginUrl: "https://hipicon.com/",
    };
  }

  const bulkUrl = hipiconBulkUrl(slug);
  const origin = hipiconOrigin(slug);
  const host = (() => {
    try {
      return new URL(origin).hostname;
    } catch {
      return `${slug}.hipicon.com`;
    }
  })();

  try {
    const finalUrl = await fetchFinalUrl(bulkUrl);
    if (looksLikeLoginUrl(finalUrl)) {
      return {
        ok: false,
        label: "Hipicon",
        detail: "Oturum yok — Hipicon paneline giriş yapın",
        loginUrl: bulkUrl,
      };
    }

    let hostname = host;
    try {
      hostname = new URL(finalUrl).hostname;
    } catch {
      // keep host
    }

    if (hostname === host || hostname.endsWith(".hipicon.com")) {
      return {
        ok: true,
        label: "Hipicon",
        detail: `${hostname} oturumu açık`,
        loginUrl: bulkUrl,
      };
    }

    return {
      ok: false,
      label: "Hipicon",
      detail: "Oturum yok — Hipicon paneline giriş yapın",
      loginUrl: bulkUrl,
    };
  } catch (error) {
    return {
      ok: false,
      label: "Hipicon",
      detail:
        error instanceof Error
          ? error.message
          : "Hipicon oturumu kontrol edilemedi",
      loginUrl: bulkUrl,
    };
  }
}

export async function checkBothSessions(options: {
  shopifyStoreUrl: string;
  storeName: string;
}): Promise<SessionCheckResult> {
  const [shopify, hipicon] = await Promise.all([
    checkShopifySession(options.shopifyStoreUrl),
    checkHipiconSession(options.storeName),
  ]);
  return {
    checkedAt: new Date().toISOString(),
    shopify,
    hipicon,
    ready: shopify.ok && hipicon.ok,
  };
}
