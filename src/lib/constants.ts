/** Hipicon designer office → toplu ürün / Excel işlemleri. */
export function hipiconBulkUrl(storeName: string): string {
  const slug = storeName.trim().toLowerCase().replace(/\.hipicon\.com$/i, "");
  if (!slug) return "https://hipicon.com/";
  return `https://${slug}.hipicon.com/products/bulk`;
}

/** Taslaklar listesi (toplu silme). */
export function hipiconDraftsUrl(storeName: string): string {
  const slug = storeName.trim().toLowerCase().replace(/\.hipicon\.com$/i, "");
  if (!slug) return "https://hipicon.com/";
  return `https://${slug}.hipicon.com/products/bulk?page=1&page-size=1000&type=drafts`;
}

export function hipiconOrigin(storeName: string): string {
  const slug = storeName.trim().toLowerCase().replace(/\.hipicon\.com$/i, "");
  if (!slug) return "https://hipicon.com";
  return `https://${slug}.hipicon.com`;
}

export function normalizeShopifyStoreUrl(input: string): string {
  const trimmed = input.trim().replace(/\/$/, "");
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

export function shopifyOriginPattern(storeUrl: string): string {
  const normalized = normalizeShopifyStoreUrl(storeUrl);
  if (!normalized) return "";
  try {
    return `${new URL(normalized).origin}/*`;
  } catch {
    return "";
  }
}
