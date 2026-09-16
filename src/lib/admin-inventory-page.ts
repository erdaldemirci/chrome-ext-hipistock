/**
 * Admin sayfa MAIN world içinde çalışır (import yok — executeScript serialize eder).
 * Oturum cookie + sayfa fetch ile kesin stok; API 403 olursa Inventory tablosunu tarar.
 */
import type { PageInventoryResult } from "./admin-inventory-types";

export type { PageInventoryResult, AdminInventoryResult } from "./admin-inventory-types";

export async function scrapeAdminInventoryInPage(
  storeHandle: string,
): Promise<PageInventoryResult> {
  const empty = (
    message: string,
    method: PageInventoryResult["method"] = "none",
  ): PageInventoryResult => ({
    ok: false,
    message,
    byVariantId: {},
    bySku: {},
    storeHandle,
    count: 0,
    method,
  });

  const merge = (
    byVariantId: Record<string, number>,
    bySku: Record<string, number>,
    variantId: unknown,
    sku: unknown,
    qty: unknown,
  ) => {
    if (typeof qty !== "number" || !Number.isFinite(qty)) return;
    const n = Math.max(0, Math.floor(qty));
    if (variantId != null && variantId !== "") {
      byVariantId[String(variantId)] = n;
    }
    if (typeof sku === "string" && sku.trim()) {
      bySku[sku.trim()] = n;
    }
  };

  const mapCount = (
    byVariantId: Record<string, number>,
    bySku: Record<string, number>,
  ) =>
    Math.max(Object.keys(byVariantId).length, Object.keys(bySku).length);

  const jsonHeaders = (forPost: boolean): Record<string, string> => {
    const h: Record<string, string> = {
      accept: "application/json",
      "x-shopify-web-force-proxy": "1",
      "x-requested-with": "XMLHttpRequest",
    };
    if (forPost) {
      h["content-type"] = "application/json";
      h["apollo-require-preflight"] = "true";
    }
    const meta = document.querySelector(
      'meta[name="csrf-token"], meta[name="csrf_token"]',
    );
    let csrf = meta?.getAttribute("content")?.trim() ?? "";
    if (!csrf) {
      const m = document.cookie.match(
        /(?:^|;\s*)(?:csrf_token|XSRF-TOKEN|_csrf)=([^;]+)/i,
      );
      if (m?.[1]) {
        try {
          csrf = decodeURIComponent(m[1]);
        } catch {
          csrf = m[1];
        }
      }
    }
    if (csrf) {
      h["x-csrf-token"] = csrf;
      h["x-shopify-csrf"] = csrf;
    }
    return h;
  };

  const notes: string[] = [];

  // 1) Session REST
  const restBases = [
    `${location.origin}/api/shopify/${storeHandle}`,
    `${location.origin}/store/${storeHandle}`,
  ];
  for (const base of restBases) {
    const byVariantId: Record<string, number> = {};
    const bySku: Record<string, number> = {};
    let page = 1;
    let sawProducts = false;
    try {
      while (page <= 40) {
        const res = await fetch(
          `${base}/products.json?limit=250&page=${page}`,
          {
            credentials: "include",
            headers: jsonHeaders(false),
            cache: "no-store",
          },
        );
        if (!res.ok) break;
        const ct = res.headers.get("content-type") ?? "";
        if (!ct.includes("json")) break;
        const json = (await res.json()) as {
          products?: Array<{
            variants?: Array<{
              id?: number | string;
              sku?: string | null;
              inventory_quantity?: number | null;
            }>;
          }>;
        };
        const products = json.products ?? [];
        if (!products.length) break;
        sawProducts = true;
        for (const p of products) {
          for (const v of p.variants ?? []) {
            merge(
              byVariantId,
              bySku,
              v.id,
              v.sku,
              v.inventory_quantity,
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
    if (sawProducts && count > 0) {
      return {
        ok: true,
        message: `Admin oturum REST: ${count} varyant stoku`,
        byVariantId,
        bySku,
        storeHandle,
        count,
        method: "rest",
      };
    }
  }

  // 2) Web Admin GraphQL
  const endpoints = [
    `${location.origin}/api/shopify/${storeHandle}/graphql`,
    `${location.origin}/api/shopify/${storeHandle}/graphql.json`,
    `${location.origin}/store/${storeHandle}/internal/web/graphql/core`,
    `${location.origin}/store/${storeHandle}/api/2025-01/graphql.json`,
    `${location.origin}/store/${storeHandle}/api/2024-10/graphql.json`,
  ];

  const gql = async <T,>(
    endpoint: string,
    query: string,
    variables?: Record<string, unknown>,
    operationName?: string,
  ): Promise<T> => {
    const body: Record<string, unknown> = { query, variables };
    if (operationName) body.operationName = operationName;
    const res = await fetch(endpoint, {
      method: "POST",
      credentials: "include",
      headers: jsonHeaders(true),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as {
      data?: T;
      errors?: Array<{ message?: string }>;
    };
    if (json.errors?.length) {
      throw new Error(json.errors.map((e) => e.message).join("; "));
    }
    if (!json.data) throw new Error("data boş");
    return json.data;
  };

  let working: string | null = null;
  const gqlErrors: string[] = [];
  for (const endpoint of endpoints) {
    try {
      await gql<{ shop: { name: string } }>(
        endpoint,
        "query HipistokProbe { shop { name } }",
        undefined,
        "HipistokProbe",
      );
      working = endpoint;
      break;
    } catch (error) {
      gqlErrors.push(
        `${endpoint.split("/").slice(-2).join("/")}: ${
          error instanceof Error ? error.message : "fail"
        }`,
      );
    }
  }

  if (working) {
    const byVariantId: Record<string, number> = {};
    const bySku: Record<string, number> = {};

    type VariantsPayload = {
      productVariants: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        edges: Array<{
          node: {
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
        }>;
      };
    };

    const variantsQuery = `
      query HipistokInv($cursor: String) {
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
      }`;

    const qtyFromNode = (
      node: VariantsPayload["productVariants"]["edges"][0]["node"],
    ) => {
      if (typeof node.inventoryQuantity === "number") {
        return node.inventoryQuantity;
      }
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
    };

    try {
      let cursor: string | null = null;
      for (let i = 0; i < 80; i += 1) {
        const data: VariantsPayload = await gql<VariantsPayload>(
          working,
          variantsQuery,
          { cursor },
          "HipistokInv",
        );
        for (const edge of data.productVariants.edges) {
          merge(
            byVariantId,
            bySku,
            edge.node.legacyResourceId,
            edge.node.sku,
            qtyFromNode(edge.node),
          );
        }
        if (!data.productVariants.pageInfo.hasNextPage) break;
        cursor = data.productVariants.pageInfo.endCursor;
        if (!cursor) break;
      }
      const count = mapCount(byVariantId, bySku);
      if (count > 0) {
        return {
          ok: true,
          message: `Admin oturum GraphQL: ${count} varyant stoku`,
          byVariantId,
          bySku,
          storeHandle,
          count,
          method: "graphql",
        };
      }
      notes.push("GraphQL yanıt verdi ama inventoryQuantity boş");
    } catch (error) {
      notes.push(
        `GraphQL stok: ${
          error instanceof Error ? error.message : "hata"
        }`,
      );
    }
  } else {
    notes.push(
      `Admin oturum API yok. REST/GraphQL reddedildi. (${
        gqlErrors.slice(0, 2).join(" · ") || "endpoint yok"
      })`,
    );
  }

  // 3) Inventory tablosu (Available kolonu) — API 403 olsa bile çalışır
  const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
  const parseQty = (raw: string): number | null => {
    const cleaned = raw.replace(/,/g, "").trim();
    if (!cleaned || cleaned === "—" || cleaned === "-" || cleaned === "–") {
      return null;
    }
    const m = cleaned.match(/-?\d+/);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
  };
  const cellText = (row: Element, index: number) =>
    (
      [...row.querySelectorAll(':scope > td, :scope > [role="cell"]')][index]
        ?.textContent ?? ""
    )
      .replace(/\s+/g, " ")
      .trim();

  const detectColumns = (
    table: Element,
  ): { sku: number; available: number } | null => {
    const headers = [
      ...table.querySelectorAll(
        'thead th, [role="columnheader"], thead [role="cell"]',
      ),
    ];
    if (!headers.length) return null;
    let sku = -1;
    let available = -1;
    headers.forEach((cell, index) => {
      const label = norm(cell.textContent ?? "");
      if (!label) return;
      if (sku < 0 && (label === "sku" || label.startsWith("sku "))) sku = index;
      if (
        available < 0 &&
        (label === "available" || label.startsWith("available "))
      ) {
        available = index;
      }
    });
    if (sku < 0 || available < 0) return null;
    return { sku, available };
  };

  const scrapeVisible = (into: Record<string, number>) => {
    const tables = [
      ...document.querySelectorAll(
        'table, [role="table"], .Polaris-IndexTable, [class*="IndexTable"]',
      ),
    ];
    for (const table of tables) {
      const cols = detectColumns(table);
      if (!cols) continue;
      const rows = [
        ...table.querySelectorAll(
          'tbody tr, [role="row"]:not([class*="Header"])',
        ),
      ];
      for (const row of rows) {
        const sku = cellText(row, cols.sku);
        if (!sku || sku === "—" || sku === "-" || /^no sku$/i.test(sku)) {
          continue;
        }
        if (/^sku$/i.test(sku)) continue;
        const qty = parseQty(cellText(row, cols.available));
        if (qty != null) into[sku] = qty;
      }
    }
    if (Object.keys(into).length > 0) return;
    for (const row of document.querySelectorAll('[role="row"]')) {
      const skuCell = row.querySelector(
        '[role="cell"][aria-colindex="4"]',
      );
      const availCell = row.querySelector(
        '[role="cell"][aria-colindex="7"]',
      );
      if (!skuCell || !availCell) continue;
      const sku = (skuCell.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!sku || sku === "—" || /^sku$/i.test(sku)) continue;
      const qty = parseQty(availCell.textContent ?? "");
      if (qty != null) into[sku] = qty;
    }
  };

  const isDisabled = (el: HTMLElement) =>
    el.hasAttribute("disabled") ||
    el.getAttribute("aria-disabled") === "true" ||
    el.classList.contains("Polaris-Button--disabled");

  const findNext = (): HTMLElement | null => {
    const byId = document.getElementById("nextURL");
    if (byId instanceof HTMLElement && !isDisabled(byId)) return byId;

    const needles = ["next", "next page", "sonraki", "ileri"];
    for (const el of document.querySelectorAll("button, a")) {
      if (!(el instanceof HTMLElement) || isDisabled(el)) continue;
      const label = (
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        ""
      )
        .toLowerCase()
        .trim();
      if (needles.some((n) => label === n || label.startsWith(`${n} `))) {
        return el;
      }
    }

    for (const nav of document.querySelectorAll(
      'nav[aria-label*="Pagination" i], nav[aria-label*="Sayfa" i], .Polaris-Pagination, [class*="Pagination"]',
    )) {
      const enabled = [...nav.querySelectorAll("button, a")].filter(
        (el): el is HTMLElement =>
          el instanceof HTMLElement && !isDisabled(el),
      );
      if (enabled.length >= 2) return enabled[enabled.length - 1]!;
      if (enabled.length === 1) {
        const all = [...nav.querySelectorAll("button, a")];
        if (all.length >= 2 && all[all.length - 1] === enabled[0]) {
          return enabled[0]!;
        }
      }
    }
    return null;
  };

  const bySku: Record<string, number> = {};
  scrapeVisible(bySku);
  for (let i = 0; i < 120; i += 1) {
    const next = findNext();
    if (!next) break;
    const before = Object.keys(bySku).length;
    next.click();
    const start = Date.now();
    let grew = false;
    while (Date.now() - start < 6000) {
      await new Promise((r) => setTimeout(r, 350));
      scrapeVisible(bySku);
      if (Object.keys(bySku).length > before) {
        grew = true;
        break;
      }
    }
    if (!grew) {
      scrapeVisible(bySku);
      if (Object.keys(bySku).length <= before) break;
    }
  }

  const tableCount = Object.keys(bySku).length;
  if (tableCount > 0) {
    return {
      ok: true,
      message: `Inventory tablosu (Available): ${tableCount} SKU`,
      byVariantId: {},
      bySku,
      storeHandle,
      count: tableCount,
      method: "table",
    };
  }

  notes.push(
    /\/products\/inventory/i.test(location.pathname)
      ? "Inventory tablosunda SKU/Available satırı bulunamadı"
      : "Products → Inventory sayfası açık değil",
  );

  return empty(notes.filter(Boolean).slice(0, 3).join(" · ") || "Stok yok");
}
