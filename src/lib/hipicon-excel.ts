import * as XLSX from "xlsx";
import { assertUsdTryRate, effectiveTryPrice } from "./currency";
import type { CatalogVariant, PushMode } from "./types";

function formatVat(rate: number): string {
  return `%${rate}`;
}

async function loadBundledTemplate(mode: PushMode): Promise<ArrayBuffer> {
  const file =
    mode === "price_stock"
      ? "templates/hipicon-fiyat-stok-v2.xlsx"
      : "templates/hipicon-yeni-urun-v2.xlsx";
  const url = chrome.runtime.getURL(file);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Şablon yüklenemedi: ${file}`);
  return res.arrayBuffer();
}

function clearDataRows(sheet: XLSX.WorkSheet) {
  const ref = sheet["!ref"];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  for (let r = 2; r <= range.e.r; r += 1) {
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      delete sheet[XLSX.utils.encode_cell({ r, c })];
    }
  }
  range.e.r = Math.max(range.e.r, 1);
  sheet["!ref"] = XLSX.utils.encode_range(range);
}

function setMeta(
  workbook: XLSX.WorkBook,
  entries: Array<[string, string | number]>,
) {
  const sheet = workbook.Sheets.Meta;
  if (!sheet) return;
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: null,
  });
  const map = new Map<string, number>();
  rows.forEach((row, index) => {
    if (row?.[0] != null) map.set(String(row[0]), index);
  });
  for (const [key, value] of entries) {
    const idx = map.get(key);
    if (idx == null) continue;
    const cell = XLSX.utils.encode_cell({ r: idx, c: 1 });
    sheet[cell] = { t: typeof value === "number" ? "n" : "s", v: value };
  }
}

function headerKey(raw: string): string {
  return raw
    .replace(/\s*\*\s*$/u, "")
    .trim()
    .toLocaleLowerCase("tr-TR");
}

function readHeaders(sheet: XLSX.WorkSheet): string[] {
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: null,
  });
  const headerRow = (rows[1] ?? []) as Array<string | number | null>;
  return headerRow.map((cell) =>
    cell == null ? "" : String(cell).trim(),
  );
}

function productEntryCell(
  header: string,
  item: CatalogVariant,
  tryPrice: number,
  vatRate: number,
): string | number | "" {
  const key = headerKey(header);
  switch (key) {
    case "varyant grup":
      return item.handle || item.sku;
    case "stok kodu":
      return item.sku;
    case "barkod":
      return item.barcode ?? "";
    case "ürün adı":
      return item.name;
    case "stok miktarı":
      return item.stock;
    case "ürün fiyatı (kdv dahil)":
    case "yurt dışı fiyatı":
      return tryPrice;
    case "kdv oranı":
      return formatVat(vatRate);
    case "indirim tipi":
      return "İndirim Yok";
    case "teslimat zamanı (iş günü)":
    case "teslimat süresi (gün)":
      return 5;
    case "desi":
      return 1;
    case "hediye kutusu":
    case "yalnızca i̇stanbul i̇çi teslimat":
    case "yalnızca istanbul içi teslimat":
    case "farklı fiyat":
      return "HAYIR";
    case "yurt dışına satış":
      return "EVET";
    case "ürün açıklaması":
      return item.description ?? item.name;
    case "resim url'leri (;)":
    case "resim urlleri (;)":
      return item.imageUrls ?? item.imageUrl ?? "";
    default:
      return "";
  }
}

function priceStockCell(
  header: string,
  item: CatalogVariant,
  tryPrice: number,
  vatRate: number,
): string | number | "" {
  const key = headerKey(header);
  switch (key) {
    case "ürün adı":
      return item.name;
    case "stok kodu":
      return item.sku;
    case "varyant":
      return item.variant ?? "";
    case "barkod":
      return item.barcode ?? "";
    case "stok miktarı":
      return item.stock;
    case "ürün fiyatı (kdv dahil)":
    case "yurt dışı fiyatı":
      return tryPrice;
    case "indirim tipi":
      return "İndirim Yok";
    case "kdv oranı":
      return formatVat(vatRate);
    case "teslimat süresi (gün)":
    case "teslimat zamanı (iş günü)":
      return 5;
    default:
      return "";
  }
}

export async function buildHipiconWorkbook(options: {
  mode: PushMode;
  variants: CatalogVariant[];
  /** 1 USD = ? TRY */
  usdTryRate: number;
  /** KDV oranı %, varsayılan 10 */
  vatRate?: number;
  /** PRODUCT_ENTRY Meta — dosya başına tek ana kategori */
  categoryId?: string;
  categoryPath?: string;
  /**
   * Hipicon’dan indirilen kategoriye özel şablon.
   * Yoksa eklenti içindeki sabit şablon kullanılır.
   */
  templateBytes?: ArrayBuffer;
}): Promise<{ bytes: Uint8Array; fileName: string; rateUsed: number }> {
  const rate = assertUsdTryRate(options.usdTryRate);
  const vatRate =
    typeof options.vatRate === "number" &&
    Number.isFinite(options.vatRate) &&
    options.vatRate >= 0
      ? options.vatRate
      : 10;

  const source =
    options.templateBytes ?? (await loadBundledTemplate(options.mode));
  const workbook = XLSX.read(source, {
    type: "array",
    cellStyles: true,
  });
  const sheet = workbook.Sheets["Ürünler"];
  if (!sheet) throw new Error("Hipicon şablonunda Ürünler sayfası yok");

  const headers = readHeaders(sheet);
  if (!headers.some(Boolean)) {
    throw new Error("Hipicon şablonunda başlık satırı yok");
  }

  clearDataRows(sheet);

  const rows: Array<Array<string | number>> = options.variants.map((item) => {
    const tryPrice = effectiveTryPrice(item, rate);
    return headers.map((header) => {
      if (!header) return "";
      return options.mode === "price_stock"
        ? priceStockCell(header, item, tryPrice, vatRate)
        : productEntryCell(header, item, tryPrice, vatRate);
    });
  });

  XLSX.utils.sheet_add_aoa(sheet, rows, { origin: "A3" });

  if (options.mode === "price_stock") {
    // Canlı şablonda Meta genelde doğru; yine de tip/identifier’ı sabitle.
    setMeta(workbook, [
      ["type", "PRODUCT_BULK_EDIT"],
      ["templateVersion", "2"],
      ["rowIdentifier", "stockCode"],
    ]);
  } else if (!options.templateBytes) {
    // Canlı şablonda Meta zaten kategoriye özel; yalnızca yedek şablonda yaz.
    const meta: Array<[string, string | number]> = [["type", "PRODUCT_ENTRY"]];
    if (options.categoryId) meta.push(["categoryId", options.categoryId]);
    if (options.categoryPath) {
      meta.push(["categoryPath", options.categoryPath]);
    }
    setMeta(workbook, meta);
  }

  const out = XLSX.write(workbook, {
    type: "array",
    bookType: "xlsx",
  }) as number[];
  const bytes = new Uint8Array(out);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const catSlug = options.categoryId ? `-cat${options.categoryId}` : "";
  const fileName =
    options.mode === "price_stock"
      ? `hipicon-fiyat-stok-${stamp}.xlsx`
      : `hipicon-yeni-urun${catSlug}-${stamp}.xlsx`;
  return { bytes, fileName, rateUsed: rate };
}
