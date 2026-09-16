import { scrapeAdminInventoryInPage } from "../lib/admin-inventory-page";
import type { AdminInventoryResult } from "../lib/admin-inventory-types";
import { emptyInventoryResult } from "../lib/admin-inventory-types";
import { ensureShopifyAdminTab, sendToTab } from "./tabs-shopify";

export function isStrongInventory(inv: AdminInventoryResult): boolean {
  if (!inv.ok || inv.count <= 0) return false;
  const variantN = Object.keys(inv.byVariantId ?? {}).length;
  const skuN = Object.keys(inv.bySku ?? {}).length;
  if (variantN > 0) return true;
  // Table scrape: Available kolonundan gelen her SKU geçerli sayılır
  if (inv.method === "table") return skuN > 0;
  return skuN >= 10;
}

/** Service worker cookie ile Admin GraphQL (sayfa inject başarısızsa). */
export async function fetchInventoryFromServiceWorker(
  storeHandle: string,
): Promise<AdminInventoryResult> {
  const empty = (message: string) => emptyInventoryResult(message, storeHandle);

  const endpoints = [
    `https://admin.shopify.com/api/shopify/${storeHandle}/graphql`,
    `https://admin.shopify.com/api/shopify/${storeHandle}/graphql.json`,
  ];

  const query = `
    query HipistokInv($cursor: String) {
      productVariants(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            legacyResourceId
            sku
            inventoryQuantity
          }
        }
      }
    }`;

  let working: string | null = null;
  const errors: string[] = [];
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-shopify-web-force-proxy": "1",
          "x-requested-with": "XMLHttpRequest",
          "apollo-require-preflight": "true",
        },
        body: JSON.stringify({
          query: "query HipistokProbe { shop { name } }",
          operationName: "HipistokProbe",
        }),
      });
      if (!res.ok) {
        errors.push(`probe ${res.status}`);
        continue;
      }
      const json = (await res.json()) as {
        data?: { shop?: { name?: string } };
        errors?: Array<{ message?: string }>;
      };
      if (json.errors?.length || !json.data?.shop?.name) {
        errors.push(json.errors?.[0]?.message ?? "probe data yok");
        continue;
      }
      working = endpoint;
      break;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "SW probe hata");
    }
  }

  if (!working) {
    return empty(
      `SW GraphQL yok (${errors.slice(0, 2).join(" · ") || "cookie/endpoint"})`,
    );
  }

  const byVariantId: Record<string, number> = {};
  const bySku: Record<string, number> = {};
  let cursor: string | null = null;
  try {
    for (let i = 0; i < 80; i += 1) {
      const res = await fetch(working, {
        method: "POST",
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-shopify-web-force-proxy": "1",
          "x-requested-with": "XMLHttpRequest",
          "apollo-require-preflight": "true",
        },
        body: JSON.stringify({
          query,
          variables: { cursor },
          operationName: "HipistokInv",
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        data?: {
          productVariants: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            edges: Array<{
              node: {
                legacyResourceId?: string | number;
                sku?: string | null;
                inventoryQuantity?: number | null;
              };
            }>;
          };
        };
        errors?: Array<{ message?: string }>;
      };
      if (json.errors?.length) {
        throw new Error(json.errors.map((e) => e.message).join("; "));
      }
      const conn = json.data?.productVariants;
      if (!conn) throw new Error("productVariants yok");
      for (const edge of conn.edges) {
        const qty = edge.node.inventoryQuantity;
        if (typeof qty !== "number" || !Number.isFinite(qty)) continue;
        const n = Math.max(0, Math.floor(qty));
        if (edge.node.legacyResourceId != null) {
          byVariantId[String(edge.node.legacyResourceId)] = n;
        }
        const sku = edge.node.sku?.trim();
        if (sku) bySku[sku] = n;
      }
      if (!conn.pageInfo.hasNextPage) break;
      cursor = conn.pageInfo.endCursor;
      if (!cursor) break;
    }
  } catch (error) {
    return empty(
      `SW GraphQL stok hata: ${
        error instanceof Error ? error.message : "bilinmiyor"
      }`,
    );
  }

  const count = Math.max(
    Object.keys(byVariantId).length,
    Object.keys(bySku).length,
  );
  if (count === 0) {
    return empty("SW GraphQL yanıt verdi ama inventoryQuantity boş");
  }
  return {
    ok: true,
    message: `Admin SW GraphQL: ${count} varyant stoku`,
    byVariantId,
    bySku,
    storeHandle,
    count,
    method: "graphql",
  };
}

export async function fetchSessionInventory(): Promise<AdminInventoryResult> {
  const tab = await ensureShopifyAdminTab();
  if (!tab.id) throw new Error("Shopify Admin sekmesi yok");

  const handle = tab.url
    ? (() => {
        try {
          return (
            new URL(tab.url).pathname.match(/\/store\/([^/]+)/i)?.[1] ?? null
          );
        } catch {
          return null;
        }
      })()
    : null;
  if (!handle) {
    throw new Error("Admin store handle okunamadı (/store/...)");
  }

  // Inventory tablosu Polaris’te geç yüklenebilir
  await new Promise((r) => setTimeout(r, 2200));

  const notes: string[] = [];

  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: scrapeAdminInventoryInPage,
      args: [handle],
    });
    const pageResult = injected[0]?.result as AdminInventoryResult | undefined;
    if (pageResult && isStrongInventory(pageResult)) {
      return pageResult;
    }
    if (pageResult?.ok && pageResult.count > 0) {
      return pageResult;
    }
    if (pageResult?.message) notes.push(pageResult.message);
  } catch (error) {
    notes.push(error instanceof Error ? error.message : "MAIN inject hata");
  }

  try {
    const viaContent = await sendToTab<AdminInventoryResult>(
      tab.id,
      "content/shopify-admin.js",
      { type: "FETCH_ADMIN_INVENTORY" },
    );
    if (isStrongInventory(viaContent)) {
      return { ...viaContent, method: viaContent.method ?? "rest" };
    }
    if (viaContent.message) notes.push(viaContent.message);
  } catch (error) {
    notes.push(error instanceof Error ? error.message : "content stok hata");
  }

  try {
    const viaSw = await fetchInventoryFromServiceWorker(handle);
    if (isStrongInventory(viaSw)) return viaSw;
    if (viaSw.message) notes.push(viaSw.message);
  } catch (error) {
    notes.push(error instanceof Error ? error.message : "SW stok hata");
  }

  return emptyInventoryResult(
    notes.filter(Boolean).slice(0, 3).join(" · ") ||
      "Admin oturumundan stok okunamadı",
    handle,
  );
}
