import type { AdminInventoryResult } from "../../lib/admin-inventory-types";
import { scrapeInventoryTable } from "./scrape";
import { graphql, pickWorkingEndpoint, sessionHeaders } from "./session";

function mapCount(
  byVariantId: Record<string, number>,
  bySku: Record<string, number>,
) {
  return Math.max(
    Object.keys(byVariantId).length,
    Object.keys(bySku).length,
  );
}

function mergeQty(
  byVariantId: Record<string, number>,
  bySku: Record<string, number>,
  variantId: string | number | undefined | null,
  sku: string | null | undefined,
  qty: number | null | undefined,
) {
  if (typeof qty !== "number" || !Number.isFinite(qty)) return;
  const n = Math.max(0, Math.floor(qty));
  if (variantId != null && variantId !== "") {
    byVariantId[String(variantId)] = n;
  }
  const trimmed = sku?.trim();
  if (trimmed) bySku[trimmed] = n;
}

const VARIANTS_QUERY = `
query HipistokInventory($cursor: String) {
  productVariants(first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        legacyResourceId
        sku
        inventoryQuantity
        inventoryItem {
          inventoryLevels(first: 10) {
            nodes {
              quantities(names: ["available"]) { name quantity }
            }
          }
        }
      }
    }
  }
}
`;

const PRODUCTS_QUERY = `
query HipistokInventory($cursor: String) {
  products(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        variants(first: 100) {
          edges {
            node {
              legacyResourceId
              sku
              inventoryQuantity
            }
          }
        }
      }
    }
  }
}
`;

type VariantNode = {
  legacyResourceId?: string | number;
  sku?: string | null;
  inventoryQuantity?: number | null;
  inventoryItem?: {
    inventoryLevels?: {
      nodes?: Array<{
        quantities?: Array<{ name?: string; quantity?: number }>;
      }>;
    };
  };
};

type VariantsData = {
  productVariants: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: VariantNode }>;
  };
};

type ProductsData = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{
      node: {
        variants: {
          edges: Array<{
            node: {
              legacyResourceId?: string | number;
              sku?: string | null;
              inventoryQuantity?: number | null;
            };
          }>;
        };
      };
    }>;
  };
};

type RestProduct = {
  variants?: Array<{
    id?: number | string;
    sku?: string | null;
    inventory_quantity?: number | null;
  }>;
};

function qtyFromVariantNode(node: VariantNode): number | null {
  if (typeof node.inventoryQuantity === "number") return node.inventoryQuantity;
  let sum = 0;
  let saw = false;
  for (const level of node.inventoryItem?.inventoryLevels?.nodes ?? []) {
    for (const q of level.quantities ?? []) {
      if (q.name === "available" && typeof q.quantity === "number") {
        sum += q.quantity;
        saw = true;
      }
    }
  }
  return saw ? sum : null;
}

async function fetchViaRest(
  storeHandle: string,
): Promise<AdminInventoryResult | null> {
  const byVariantId: Record<string, number> = {};
  const bySku: Record<string, number> = {};
  const bases = [
    `${location.origin}/api/shopify/${storeHandle}`,
    `${location.origin}/store/${storeHandle}`,
  ];

  for (const base of bases) {
    let page = 1;
    let gotAny = false;
    try {
      while (page <= 40) {
        const url = `${base}/products.json?limit=250&page=${page}`;
        const res = await fetch(url, {
          credentials: "include",
          headers: sessionHeaders(false),
          cache: "no-store",
        });
        if (!res.ok) break;
        const ct = res.headers.get("content-type") ?? "";
        if (!ct.includes("json")) break;
        const json = (await res.json()) as { products?: RestProduct[] };
        const products = json.products ?? [];
        if (!products.length) break;
        gotAny = true;
        for (const product of products) {
          for (const variant of product.variants ?? []) {
            mergeQty(
              byVariantId,
              bySku,
              variant.id,
              variant.sku,
              variant.inventory_quantity,
            );
          }
        }
        if (products.length < 250) break;
        page += 1;
      }
    } catch {
      continue;
    }
    const count = mapCount(byVariantId, bySku);
    if (gotAny && count > 0) {
      return {
        ok: true,
        message: `Inventory (REST): ${count} varyant`,
        byVariantId,
        bySku,
        storeHandle,
        count,
        method: "rest",
      };
    }
  }
  return null;
}

async function fetchViaVariantsGraphql(
  endpoint: string,
  storeHandle: string,
): Promise<AdminInventoryResult> {
  const byVariantId: Record<string, number> = {};
  const bySku: Record<string, number> = {};
  let cursor: string | null = null;

  for (let guard = 0; guard < 80; guard += 1) {
    const data: VariantsData = await graphql<VariantsData>(
      endpoint,
      VARIANTS_QUERY,
      { cursor },
      "HipistokInventory",
    );
    for (const edge of data.productVariants.edges) {
      mergeQty(
        byVariantId,
        bySku,
        edge.node.legacyResourceId,
        edge.node.sku,
        qtyFromVariantNode(edge.node),
      );
    }
    if (!data.productVariants.pageInfo.hasNextPage) break;
    cursor = data.productVariants.pageInfo.endCursor;
    if (!cursor) break;
  }

  const count = mapCount(byVariantId, bySku);
  return {
    ok: count > 0,
    message:
      count > 0
        ? `Inventory (GraphQL variants): ${count} varyant`
        : "productVariants stok boş",
    byVariantId,
    bySku,
    storeHandle,
    count,
    method: count > 0 ? "graphql" : "none",
  };
}

async function fetchViaProductsGraphql(
  endpoint: string,
  storeHandle: string,
): Promise<AdminInventoryResult> {
  const byVariantId: Record<string, number> = {};
  const bySku: Record<string, number> = {};
  let cursor: string | null = null;

  for (let guard = 0; guard < 80; guard += 1) {
    const data: ProductsData = await graphql<ProductsData>(
      endpoint,
      PRODUCTS_QUERY,
      { cursor },
      "HipistokInventory",
    );
    for (const edge of data.products.edges) {
      for (const variantEdge of edge.node.variants.edges) {
        mergeQty(
          byVariantId,
          bySku,
          variantEdge.node.legacyResourceId,
          variantEdge.node.sku,
          variantEdge.node.inventoryQuantity,
        );
      }
    }
    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
    if (!cursor) break;
  }

  const count = mapCount(byVariantId, bySku);
  return {
    ok: count > 0,
    message:
      count > 0
        ? `Inventory (GraphQL products): ${count} varyant`
        : "products stok boş",
    byVariantId,
    bySku,
    storeHandle,
    count,
    method: count > 0 ? "graphql" : "none",
  };
}

export async function fetchAllInventory(
  storeHandle: string,
): Promise<AdminInventoryResult> {
  const errors: string[] = [];
  const onInventoryPage = /\/products\/inventory/i.test(location.pathname);

  // Inventory açıksa DOM önce — session GraphQL çoğu mağazada 403
  if (onInventoryPage) {
    const scraped = await scrapeInventoryTable();
    if (scraped?.ok) return scraped;
    if (scraped?.message) errors.push(scraped.message);
  }

  try {
    const rest = await fetchViaRest(storeHandle);
    if (rest?.ok) return rest;
    if (rest) errors.push(rest.message);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "REST hata");
  }

  try {
    const endpoint = await pickWorkingEndpoint(storeHandle);
    try {
      const viaVariants = await fetchViaVariantsGraphql(endpoint, storeHandle);
      if (viaVariants.ok) return viaVariants;
      errors.push(viaVariants.message);
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : "variants GraphQL hata",
      );
    }
    try {
      const viaProducts = await fetchViaProductsGraphql(endpoint, storeHandle);
      if (viaProducts.ok) return viaProducts;
      errors.push(viaProducts.message);
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : "products GraphQL hata",
      );
    }
  } catch (error) {
    errors.push(
      error instanceof Error ? error.message : "GraphQL endpoint yok",
    );
  }

  if (!onInventoryPage) {
    const scraped = await scrapeInventoryTable();
    if (scraped?.ok) return scraped;
    if (scraped?.message) errors.push(scraped.message);
  }

  return {
    ok: false,
    message:
      errors.filter(Boolean).slice(0, 3).join(" · ") ||
      "Products → Inventory stoku okunamadı",
    byVariantId: {},
    bySku: {},
    storeHandle,
    count: 0,
    method: "none",
  };
}
