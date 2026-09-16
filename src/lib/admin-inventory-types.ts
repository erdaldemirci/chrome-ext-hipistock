export type AdminInventoryMethod = "rest" | "graphql" | "table" | "none";

/** Admin oturumundan gelen varyant/SKU stok haritası. */
export type AdminInventoryResult = {
  ok: boolean;
  message: string;
  byVariantId: Record<string, number>;
  bySku: Record<string, number>;
  storeHandle: string | null;
  count: number;
  method: AdminInventoryMethod;
};

/** @deprecated Prefer AdminInventoryResult — aynı şekil. */
export type PageInventoryResult = AdminInventoryResult;

export function mapInventoryCount(
  byVariantId: Record<string, number>,
  bySku: Record<string, number>,
): number {
  return Math.max(
    Object.keys(byVariantId).length,
    Object.keys(bySku).length,
  );
}

export function emptyInventoryResult(
  message: string,
  storeHandle: string | null = null,
): AdminInventoryResult {
  return {
    ok: false,
    message,
    byVariantId: {},
    bySku: {},
    storeHandle,
    count: 0,
    method: "none",
  };
}

export function mergeInventoryQty(
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
