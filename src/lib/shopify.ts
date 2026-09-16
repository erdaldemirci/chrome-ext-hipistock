import type { CatalogVariant } from "./types";

export type ShopifyStoreMeta = {
  name: string;
  domain: string;
  myshopifyDomain: string;
  currency: string;
  url: string;
};

type PublicProduct = {
  id: number;
  title: string;
  handle: string;
  body_html: string | null;
  vendor: string | null;
  product_type: string | null;
  tags: string[] | string;
  images?: Array<{ src?: string }>;
  variants: Array<{
    id: number;
    title: string;
    sku: string | null;
    barcode?: string | null;
    available: boolean;
    price: string;
    compare_at_price: string | null;
    inventory_quantity?: number;
    option1?: string | null;
  }>;
};

function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function normalizeStoreUrl(input: string): string {
  const trimmed = input.trim().replace(/\/$/, "");
  if (!trimmed) {
    throw new Error("Shopify mağaza URL boş");
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

/** Katalog API çağrıları yalnızca *.myshopify.com üzerinden (host izni). */
function shopifyApiBase(storeUrl: string): string {
  const base = normalizeStoreUrl(storeUrl);
  let host = "";
  try {
    host = new URL(base).hostname.toLowerCase();
  } catch {
    throw new Error("Shopify mağaza URL geçersiz");
  }
  if (host.endsWith(".myshopify.com")) return base;
  throw new Error(
    "Shopify URL *.myshopify.com olmalı (örn. https://magaza.myshopify.com). Admin sekmesi açıksa eklenti bunu otomatik alır.",
  );
}

export async function fetchShopifyStoreMeta(
  storeUrl: string,
): Promise<ShopifyStoreMeta> {
  const base = shopifyApiBase(storeUrl);
  const res = await fetch(`${base}/meta.json`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Shopify meta.json okunamadı (${res.status})`);
  }
  const data = (await res.json()) as {
    name?: string;
    domain?: string;
    myshopify_domain?: string;
    currency?: string;
    url?: string;
  };
  return {
    name: data.name ?? "Shopify",
    domain: data.domain ?? base,
    myshopifyDomain: data.myshopify_domain ?? hostFromUrl(base),
    currency: data.currency ?? "USD",
    url: data.url ?? base,
  };
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

async function fetchPublicProductsPage(
  storeUrl: string,
  page: number,
): Promise<PublicProduct[]> {
  const base = shopifyApiBase(storeUrl);
  const res = await fetch(`${base}/products.json?limit=250&page=${page}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Shopify products.json hata: ${res.status}`);
  }
  const data = (await res.json()) as { products?: PublicProduct[] };
  return data.products ?? [];
}

async function fetchAdminInventoryByVariant(
  myshopifyDomain: string,
  adminToken: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!myshopifyDomain || !adminToken) return map;

  let nextUrl: string | null =
    `https://${myshopifyDomain}/admin/api/2024-10/products.json?limit=250`;
  let guard = 0;

  while (nextUrl && guard < 40) {
    guard += 1;
    const res: Response = await fetch(nextUrl, {
      headers: {
        "X-Shopify-Access-Token": adminToken,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Shopify Admin API hata (${res.status}): ${body.slice(0, 180)}`,
      );
    }

    const data = (await res.json()) as {
      products?: Array<{
        variants?: Array<{
          id: number;
          inventory_quantity?: number;
        }>;
      }>;
    };

    for (const product of data.products ?? []) {
      for (const variant of product.variants ?? []) {
        if (typeof variant.inventory_quantity === "number") {
          map.set(String(variant.id), variant.inventory_quantity);
        }
      }
    }

    const link: string = res.headers.get("link") ?? "";
    const match: RegExpMatchArray | null = link.match(
      /<([^>]+)>;\s*rel="next"/,
    );
    nextUrl = match?.[1] ?? null;
  }

  return map;
}

export async function fetchShopifyCatalog(options: {
  storeUrl: string;
  adminToken?: string;
  sessionInventoryByVariant?: Map<string, number>;
  sessionInventoryBySku?: Map<string, number>;
  /** true: public var/yok stokuna düşme; yalnızca session/token adedi */
  requireExactInventory?: boolean;
}): Promise<{
  meta: ShopifyStoreMeta;
  variants: CatalogVariant[];
  usedAdminInventory: boolean;
  inventorySource: "session" | "token" | "public";
}> {
  const meta = await fetchShopifyStoreMeta(options.storeUrl);
  let inventoryByVariant = new Map<string, number>();
  let usedAdminInventory = false;
  let inventorySource: "session" | "token" | "public" = "public";

  const sessionByVariant = options.sessionInventoryByVariant;
  const sessionBySku = options.sessionInventoryBySku;
  const sessionVariantCount = sessionByVariant?.size ?? 0;
  const sessionSkuCount = sessionBySku?.size ?? 0;

  if (sessionVariantCount > 0 || sessionSkuCount > 0) {
    inventoryByVariant = sessionByVariant ?? new Map();
    usedAdminInventory = true;
    inventorySource = "session";
  } else if (options.adminToken?.trim() && meta.myshopifyDomain) {
    inventoryByVariant = await fetchAdminInventoryByVariant(
      meta.myshopifyDomain,
      options.adminToken.trim(),
    );
    usedAdminInventory = inventoryByVariant.size > 0;
    if (usedAdminInventory) inventorySource = "token";
  }

  if (options.requireExactInventory && !usedAdminInventory) {
    throw new Error(
      "Kesin stok yok: Admin oturumu stok vermedi ve geçerli Admin API token yok",
    );
  }

  const variants: CatalogVariant[] = [];
  let page = 1;
  while (page <= 40) {
    const products = await fetchPublicProductsPage(options.storeUrl, page);
    if (products.length === 0) break;

    for (const product of products) {
      const tags = Array.isArray(product.tags)
        ? product.tags
        : String(product.tags ?? "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
      const images = (product.images ?? [])
        .map((img) => img.src)
        .filter((src): src is string => Boolean(src));
      const description = stripHtml(product.body_html);

      for (const variant of product.variants ?? []) {
        const sku =
          variant.sku?.trim() || `SHOPIFY-${product.id}-${variant.id}`;
        const variantTitle =
          variant.title && variant.title !== "Default Title"
            ? variant.title
            : variant.option1 && variant.option1 !== "Default Title"
              ? variant.option1
              : null;
        const name = variantTitle
          ? `${product.title} — ${variantTitle}`
          : product.title;

        const adminQty =
          inventoryByVariant.get(String(variant.id)) ??
          sessionBySku?.get(sku);

        let stock = 0;
        if (usedAdminInventory) {
          // Kesin kaynak: map’te yoksa 0 (public available=1 uydurması yok)
          stock =
            typeof adminQty === "number"
              ? Math.max(0, Math.floor(adminQty))
              : 0;
        } else if (typeof variant.inventory_quantity === "number") {
          stock = Math.max(0, Math.floor(variant.inventory_quantity));
        } else if (variant.available) {
          stock = 1;
        }

        variants.push({
          shopifyProductId: String(product.id),
          shopifyVariantId: String(variant.id),
          sku,
          name,
          barcode: variant.barcode ?? null,
          brand: product.vendor ?? "Loadingbag",
          category: product.product_type || null,
          variant: variantTitle,
          available: Boolean(variant.available),
          stock,
          price: Number(variant.price) || 0,
          priceTry: null,
          compareAtPrice: variant.compare_at_price
            ? Number(variant.compare_at_price)
            : null,
          currency: meta.currency || "USD",
          description,
          imageUrls: images.length ? images.join(";") : null,
          imageUrl: images[0] ?? null,
          tags,
          productType: product.product_type || null,
          handle: product.handle,
          hipiconCategoryId: null,
          hipiconCategoryPath: null,
          selected: false,
          pushedAt: null,
          pushedMode: null,
        });
      }
    }

    if (products.length < 250) break;
    page += 1;
  }

  return { meta, variants, usedAdminInventory, inventorySource };
}
