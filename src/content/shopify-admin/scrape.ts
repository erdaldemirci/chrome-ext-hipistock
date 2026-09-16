import type { AdminInventoryResult } from "../../lib/admin-inventory-types";
import { storeHandleFromLocation } from "./session";

/** Lokal tut — content bundle paylaşılan chunk import etmesin. */
function mapInventoryCount(bySku: Record<string, number>): number {
  return Object.keys(bySku).length;
}

type ColumnMap = {
  sku: number;
  available: number;
};

function normalizeHeader(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Polaris Inventory tablosu: SKU + Available kolon indekslerini başlıktan bul. */
function detectColumns(table: Element): ColumnMap | null {
  const headers = [
    ...table.querySelectorAll(
      'thead th, [role="columnheader"], thead [role="cell"]',
    ),
  ];
  if (!headers.length) return null;

  let sku = -1;
  let available = -1;
  headers.forEach((cell, index) => {
    const label = normalizeHeader(cell.textContent ?? "");
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
}

function cellText(row: Element, index: number): string {
  const cells = [
    ...row.querySelectorAll(':scope > td, :scope > [role="cell"]'),
  ];
  return (cells[index]?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function parseQty(text: string): number | null {
  const cleaned = text.replace(/,/g, "").trim();
  if (!cleaned || cleaned === "—" || cleaned === "-" || cleaned === "–") {
    return null;
  }
  const match = cleaned.match(/-?\d+/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
}

function isInventoryDataRow(text: string): boolean {
  if (!text || text.length < 2) return false;
  if (/^SKU\b|Available|On hand|Committed|Unavailable|Incoming/i.test(text) && text.length < 100) {
    return false;
  }
  return true;
}

/**
 * Inventory sayfası tablosundan SKU → Available (satılabilir stok).
 * Eski mantık son rakamı alıyordu (Incoming); artık Available kolonu hedeflenir.
 */
function scrapeVisibleSkuRows(into: Record<string, number>) {
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
      const text = (row.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!isInventoryDataRow(text)) continue;

      const skuRaw = cellText(row, cols.sku);
      const sku =
        skuRaw &&
        skuRaw !== "—" &&
        skuRaw !== "-" &&
        skuRaw !== "–" &&
        !/^no sku$/i.test(skuRaw)
          ? skuRaw
          : null;
      if (!sku) continue;

      const qty = parseQty(cellText(row, cols.available));
      if (qty == null) continue;
      into[sku] = qty;
    }
  }

  // Başlık bulunamadıysa: aria-colindex (Shopify Inventory varsayılanı)
  // 4=SKU, 7=Available — HTML dump ile doğrulandı.
  if (Object.keys(into).length === 0) {
    for (const row of document.querySelectorAll('[role="row"]')) {
      const skuEl = row.querySelector('[role="cell"][aria-colindex="4"]');
      const availEl = row.querySelector('[role="cell"][aria-colindex="7"]');
      if (!skuEl || !availEl) continue;
      const sku = (skuEl.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!sku || sku === "—" || sku === "-" || /^sku$/i.test(sku)) continue;
      const qty = parseQty(availEl.textContent ?? "");
      if (qty == null) continue;
      into[sku] = qty;
    }
  }
}

function isDisabledControl(el: HTMLElement): boolean {
  if (el.hasAttribute("disabled")) return true;
  if (el.getAttribute("aria-disabled") === "true") return true;
  if (el.classList.contains("Polaris-Button--disabled")) return true;
  if (el.getAttribute("tabindex") === "-1" && el.tagName === "A") {
    /* some polaris links */
  }
  return false;
}

function findNextPageButton(): HTMLElement | null {
  const byId = document.getElementById("nextURL");
  if (byId instanceof HTMLElement && !isDisabledControl(byId)) {
    return byId;
  }

  const labelNeedles = ["next", "next page", "sonraki", "ileri"];
  for (const el of document.querySelectorAll("button, a")) {
    if (!(el instanceof HTMLElement) || isDisabledControl(el)) continue;
    const label = (
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      ""
    )
      .toLowerCase()
      .trim();
    if (labelNeedles.some((n) => label === n || label.startsWith(`${n} `))) {
      return el;
    }
  }

  // Polaris pagination: genelde [önceki, sonraki] — sonraki son enabled kontrol
  const navs = [
    ...document.querySelectorAll(
      'nav[aria-label*="Pagination" i], nav[aria-label*="Sayfa" i], .Polaris-Pagination, [class*="Pagination"]',
    ),
  ];
  for (const nav of navs) {
    const controls = [...nav.querySelectorAll("button, a")].filter(
      (el): el is HTMLElement =>
        el instanceof HTMLElement && !isDisabledControl(el),
    );
    if (controls.length >= 2) return controls[controls.length - 1]!;
    if (controls.length === 1) {
      // tek aktif = genelde sonraki (önceki disabled)
      const all = [...nav.querySelectorAll("button, a")];
      if (all.length >= 2 && all[all.length - 1] === controls[0]) {
        return controls[0]!;
      }
    }
  }

  return null;
}

async function waitForSkuGrowth(
  bySku: Record<string, number>,
  beforeCount: number,
  timeoutMs = 6000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    scrapeVisibleSkuRows(bySku);
    if (Object.keys(bySku).length > beforeCount) return true;
    await new Promise((r) => setTimeout(r, 350));
  }
  scrapeVisibleSkuRows(bySku);
  return Object.keys(bySku).length > beforeCount;
}

export async function scrapeInventoryTable(): Promise<AdminInventoryResult | null> {
  const bySku: Record<string, number> = {};
  const maxPages = 120;

  scrapeVisibleSkuRows(bySku);

  for (let page = 0; page < maxPages; page += 1) {
    const next = findNextPageButton();
    if (!next) break;

    const before = Object.keys(bySku).length;
    next.click();
    const grew = await waitForSkuGrowth(bySku, before);
    if (!grew) break;
  }

  const count = mapInventoryCount(bySku);
  if (!count) return null;

  return {
    ok: true,
    message: `Inventory tablosu (Available): ${count} SKU`,
    byVariantId: {},
    bySku,
    storeHandle: storeHandleFromLocation(),
    count,
    method: "table",
  };
}
