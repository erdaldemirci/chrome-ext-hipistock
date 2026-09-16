import { bytesToBase64 } from "../lib/crypto";
import {
  categoryById,
  resolveHipiconCategory,
  type HipiconCategory,
} from "../lib/hipicon-categories";
import { buildHipiconWorkbook } from "../lib/hipicon-excel";
import { fetchLiveUsdTryRate, isFxStale } from "../lib/fx";
import {
  getCatalog,
  getSettings,
  hydrateHipiconCategories,
  saveSettings,
  setCatalog,
} from "../lib/storage";
import type { CatalogVariant, PushMode } from "../lib/types";
import { requireSessionsReady } from "./handlers-sessions";
import {
  ensureHipiconBulkTab,
  ensureHipiconDraftsTab,
  sendToHipiconTab,
} from "./tabs-hipicon";

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function fetchCategoryTemplateBytes(
  tabId: number,
  categoryId: string,
): Promise<ArrayBuffer> {
  const result = await sendToHipiconTab<{
    ok: boolean;
    message?: string;
    bytesBase64?: string;
  }>(tabId, {
    type: "HIPICON_FETCH_PRODUCT_TEMPLATE",
    categoryId,
  });
  if (!result?.ok || !result.bytesBase64) {
    throw new Error(
      result?.message ||
        `Kategori şablonu indirilemedi (cat ${categoryId})`,
    );
  }
  return base64ToArrayBuffer(result.bytesBase64);
}

async function fetchPriceStockTemplateBytes(
  tabId: number,
): Promise<ArrayBuffer> {
  const result = await sendToHipiconTab<{
    ok: boolean;
    message?: string;
    bytesBase64?: string;
  }>(tabId, { type: "HIPICON_FETCH_PRICE_STOCK_TEMPLATE" });
  if (!result?.ok || !result.bytesBase64) {
    throw new Error(
      result?.message || "Fiyat/stok şablonu indirilemedi",
    );
  }
  return base64ToArrayBuffer(result.bytesBase64);
}

let deleteDraftsAbortRequested = false;
let activeDeleteDraftsTabId: number | null = null;

export function requestStopDeleteHipiconDrafts() {
  deleteDraftsAbortRequested = true;
  const tabId = activeDeleteDraftsTabId;
  if (tabId != null) {
    void sendToHipiconTab(tabId, {
      type: "HIPICON_ABORT_DELETE_DRAFTS",
      active: true,
    }).catch(() => {
      /* sekme yoksa / content yoksa yoksay */
    });
  }
  return { ok: true as const };
}

export async function deleteAllHipiconDrafts() {
  deleteDraftsAbortRequested = false;
  activeDeleteDraftsTabId = null;

  await requireSessionsReady();
  const settings = await getSettings();

  let total = 0;
  const maxRounds = 200;

  try {
    for (let round = 0; round < maxRounds; round += 1) {
      if (deleteDraftsAbortRequested) {
        return {
          ok: true,
          message:
            total > 0
              ? `Durduruldu — ${total} taslak silindi`
              : "Durduruldu — henüz silinen yok",
          count: total,
          stopped: true,
        };
      }

      const forceReload = round === 0 || round % 10 === 0;
      const tab = await ensureHipiconDraftsTab(settings.storeName, {
        forceReload,
      });
      if (!tab.id) throw new Error("Hipicon taslak sekmesi yok");
      activeDeleteDraftsTabId = tab.id;

      if (round === 0) {
        await sendToHipiconTab(tab.id, {
          type: "HIPICON_ABORT_DELETE_DRAFTS",
          active: false,
        }).catch(() => {
          /* content henüz yoksa sonraki silmede bayrak zaten false */
        });
      }

      // İlk açılış / reload: content + taslak tablosu için daha uzun bekle
      await new Promise((r) =>
        setTimeout(r, forceReload ? 2800 : 450),
      );
      if (deleteDraftsAbortRequested) {
        return {
          ok: true,
          message:
            total > 0
              ? `Durduruldu — ${total} taslak silindi`
              : "Durduruldu — henüz silinen yok",
          count: total,
          stopped: true,
        };
      }

      const page = await sendToHipiconTab<{
        ok: boolean;
        message: string;
        deletedCount: number;
        empty: boolean;
        aborted?: boolean;
      }>(tab.id, { type: "HIPICON_DELETE_DRAFTS_PAGE" });

      if (!page.ok) {
        throw new Error(page.message || "Taslak silme başarısız");
      }

      total += page.deletedCount;

      if (page.aborted || deleteDraftsAbortRequested) {
        return {
          ok: true,
          message:
            total > 0
              ? `Durduruldu — ${total} taslak silindi`
              : "Durduruldu — henüz silinen yok",
          count: total,
          stopped: true,
        };
      }

      // İlk turda tablo henüz boş görünebilir — hemen “yok” deme, yeniden dene
      if ((page.empty || page.deletedCount === 0) && total === 0 && round < 4) {
        continue;
      }

      if (page.empty || page.deletedCount === 0) {
        return {
          ok: true,
          message:
            total > 0
              ? `${total} taslak silindi (Yönet → Sil → Onayla)`
              : "Silinecek taslak yok",
          count: total,
        };
      }
    }
    return {
      ok: true,
      message: `${total} taslak silindi (üst sınır) — kalan varsa tekrar çalıştırın`,
      count: total,
    };
  } finally {
    activeDeleteDraftsTabId = null;
    deleteDraftsAbortRequested = false;
  }
}

function resolveVariantCategory(
  item: CatalogVariant,
  defaultId: string,
  rules: { pattern: string; categoryId: string }[],
): HipiconCategory {
  if (item.hipiconCategoryId) {
    const hit = categoryById(item.hipiconCategoryId);
    if (hit) return hit;
    if (item.hipiconCategoryPath) {
      return { id: item.hipiconCategoryId, path: item.hipiconCategoryPath };
    }
  }
  return resolveHipiconCategory({
    defaultId,
    rules,
    productType: item.productType,
    title: item.name,
    handle: item.handle,
    tags: item.tags,
  });
}

function groupByCategory(
  variants: CatalogVariant[],
  defaultId: string,
  rules: { pattern: string; categoryId: string }[],
): Array<{ category: HipiconCategory; variants: CatalogVariant[] }> {
  const map = new Map<
    string,
    { category: HipiconCategory; variants: CatalogVariant[] }
  >();

  for (const item of variants) {
    const category = resolveVariantCategory(item, defaultId, rules);
    const existing = map.get(category.id);
    if (existing) {
      existing.variants.push(item);
    } else {
      map.set(category.id, { category, variants: [item] });
    }
  }

  return [...map.values()];
}

export async function pushOrDownload(
  mode: PushMode,
  downloadOnly: boolean,
  variantIds?: string[],
) {
  await requireSessionsReady();
  await hydrateHipiconCategories();
  let settings = await getSettings();

  if (isFxStale(settings.usdTryRateFetchedAt)) {
    try {
      const quote = await fetchLiveUsdTryRate();
      settings = await saveSettings({
        usdTryRate: quote.rate,
        usdTryRateSource: quote.source,
        usdTryRateFetchedAt: quote.fetchedAt,
      });
    } catch {
      if (!(settings.usdTryRate > 0)) {
        throw new Error(
          "Canlı kur alınamadı ve kayıtlı USD→TRY kuru yok — Ayarlar’dan ‘Kuru çek’",
        );
      }
    }
  }

  const catalog = await getCatalog();
  if (!catalog?.variants.length) {
    throw new Error("Önce Shopify kataloğunu çekin");
  }

  const variantKey = (v: CatalogVariant) =>
    String(v.shopifyVariantId ?? "").trim();

  const requestedIds = (variantIds ?? [])
    .map((id) => String(id).trim())
    .filter(Boolean);
  const idSet = requestedIds.length ? new Set(requestedIds) : null;

  // Yalnızca UI’den gelen seçim (veya storage’daki selected bayrağı) — asla tüm katalog
  const selected = idSet
    ? catalog.variants.filter((v) => idSet.has(variantKey(v)))
    : catalog.variants.filter((v) => v.selected);

  if (idSet && selected.length !== idSet.size) {
    const found = new Set(selected.map(variantKey));
    const missing = requestedIds.filter((id) => !found.has(id));
    if (missing.length) {
      throw new Error(
        `Seçili ${requestedIds.length} üründen ${selected.length} bulundu` +
          (missing.length <= 3
            ? ` (eksik: ${missing.join(", ")})`
            : ` (${missing.length} eksik)`),
      );
    }
  }

  if (!selected.length) throw new Error("En az bir ürün seçin");

  // UI’den gelen seçimi storage ile hizala (yalnızca bu aktarımın satırları seçili kalsın)
  if (idSet) {
    catalog.variants = catalog.variants.map((v) => ({
      ...v,
      selected: idSet.has(variantKey(v)),
    }));
    await setCatalog(catalog);
  }

  const groups =
    mode === "product_entry"
      ? groupByCategory(
          selected,
          settings.hipiconCategoryId,
          settings.categoryRules,
        )
      : [
          {
            category: {
              id: settings.hipiconCategoryId,
              path: settings.hipiconCategoryPath,
            },
            variants: selected,
          },
        ];

  let uploaded = 0;
  const messages: string[] = [];

  // Canlı şablon: yeni ürün kategoriye özel; fiyat/stok PRODUCT_BULK_EDIT
  let templateTabId: number | null = null;
  {
    const tab = await ensureHipiconBulkTab(settings.storeName);
    if (!tab.id) throw new Error("Hipicon sekmesi açılamadı");
    templateTabId = tab.id;
    await new Promise((r) => setTimeout(r, 800));
  }

  let sharedPriceStockTemplate: ArrayBuffer | undefined;
  if (mode === "price_stock") {
    try {
      sharedPriceStockTemplate =
        await fetchPriceStockTemplateBytes(templateTabId!);
    } catch (error) {
      // Eski paket şablonuna düş — aktarım yine denensin
      console.warn(
        "[hipistock] canlı fiyat/stok şablonu alınamadı, paket şablonu:",
        error,
      );
    }
  }

  for (const group of groups) {
    let templateBytes: ArrayBuffer | undefined;
    if (mode === "product_entry") {
      if (templateTabId == null) {
        throw new Error("Hipicon şablon sekmesi yok");
      }
      templateBytes = await fetchCategoryTemplateBytes(
        templateTabId,
        group.category.id,
      );
    } else {
      templateBytes = sharedPriceStockTemplate;
    }

    const workbook = await buildHipiconWorkbook({
      mode,
      variants: group.variants,
      usdTryRate: settings.usdTryRate,
      vatRate: settings.vatRate,
      categoryId:
        mode === "product_entry" ? group.category.id : undefined,
      categoryPath:
        mode === "product_entry" ? group.category.path : undefined,
      templateBytes,
    });

    if (downloadOnly) {
      const blob = new Blob([workbook.bytes.buffer as ArrayBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      await chrome.downloads.download({
        url,
        filename: workbook.fileName,
        saveAs: groups.length === 1,
      });
      uploaded += group.variants.length;
      if (mode === "product_entry") {
        messages.push(
          `${group.variants.length} → ${group.category.path}`,
        );
      }
      continue;
    }

    const tab = await ensureHipiconBulkTab(settings.storeName);
    if (!tab.id) throw new Error("Hipicon sekmesi açılamadı");

    await new Promise((r) => setTimeout(r, uploaded === 0 ? 600 : 800));

    const result = await sendToHipiconTab<{ ok: boolean; message: string }>(
      tab.id,
      {
        type: "HIPICON_UPLOAD",
        mode,
        fileName: workbook.fileName,
        bytesBase64: bytesToBase64(workbook.bytes),
      },
    );

    if (!result.ok) {
      throw new Error(
        groups.length > 1
          ? `${result.message} (kategori: ${group.category.path}; ${uploaded}/${selected.length} satır tamam)`
          : result.message,
      );
    }

    uploaded += group.variants.length;
    if (mode === "product_entry") {
      messages.push(`${group.variants.length} → ${group.category.path}`);
    } else if (result.message) {
      messages.push(result.message);
    }
  }

  const catNote =
    mode === "product_entry" && messages.length
      ? ` · ${groups.length} kategori: ${messages.join("; ")}`
      : mode === "price_stock" && messages.length
        ? ` · ${messages[messages.length - 1]}`
        : "";

  const latest = await getCatalog();
  if (!downloadOnly && latest?.variants.length) {
    const pushedIds = new Set(selected.map(variantKey));
    const stamped = new Date().toISOString();
    latest.variants = latest.variants.map((v) => {
      if (!pushedIds.has(variantKey(v))) return v;
      return {
        ...v,
        pushedAt: stamped,
        pushedMode: mode,
        selected: false,
      };
    });
    await setCatalog(latest);
  }

  return {
    ok: true,
    message: downloadOnly
      ? `${selected.length} satır Excel indirildi${catNote}`
      : `${selected.length} satır yüklendi · Gönderilenler’e taşındı${catNote}`,
    count: selected.length,
    catalog: downloadOnly ? undefined : await getCatalog(),
  };
}
