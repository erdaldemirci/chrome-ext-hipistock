import type { PushMode } from "../../lib/types";
import { HipiconSelectors } from "../../lib/hipicon-selectors";
import {
  base64ToBytes,
  isBlockedClickTarget,
  mainRoot,
  sleep,
  textOf,
} from "./dom";
import { findFileInput } from "./probe";

function scoreUploadCandidate(
  el: HTMLElement,
  needles: readonly string[],
  fileInput: HTMLInputElement | null,
): number {
  if (isBlockedClickTarget(el)) return -1;
  if (el instanceof HTMLButtonElement && el.disabled) return -1;

  const t = textOf(el);
  if (!t) return -1;

  let score = 0;
  for (let i = 0; i < needles.length; i += 1) {
    if (t.includes(needles[i])) {
      score += 100 - i * 5;
      break;
    }
  }
  if (score <= 0) return -1;

  if (el.tagName === "BUTTON") score += 25;
  if (fileInput) {
    const a = el.getBoundingClientRect();
    const b = fileInput.getBoundingClientRect();
    const dist = Math.hypot(a.top - b.top, a.left - b.left);
    if (dist < 320) score += 30;
  }
  return score;
}

export function clickLikelyUploadButton(mode: PushMode): boolean {
  const needles =
    mode === "price_stock"
      ? HipiconSelectors.priceStockButtonNeedles
      : HipiconSelectors.productEntryButtonNeedles;

  const fileInput = findFileInput();
  const nodes = Array.from(
    mainRoot().querySelectorAll<HTMLElement>(
      HipiconSelectors.uploadButtons.join(","),
    ),
  );

  let best: HTMLElement | null = null;
  let bestScore = 0;
  for (const el of nodes) {
    const score = scoreUploadCandidate(el, needles, fileInput);
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }

  if (!best || bestScore <= 0) return false;
  best.click();
  return true;
}

function isPriceStockConfirmButton(el: HTMLElement): boolean {
  if (isBlockedClickTarget(el)) return false;
  const t = textOf(el);
  if (!t) return false;
  if (t.includes("vazgeç") || t.includes("iptal") || t.includes("cancel")) {
    return false;
  }
  // "{{n}} ürünü güncelle" / "Update {{n}} product(s)"
  if (/\d+\s*ürünü güncelle/.test(t)) return true;
  if (/\d+\s*ürünleri güncelle/.test(t)) return true;
  if (/update\s+\d+\s+product/.test(t)) return true;
  if (t.includes("ürünü güncelle") || t.includes("ürünleri güncelle")) {
    return true;
  }
  return false;
}

function findPriceStockConfirmButton(): {
  button: HTMLButtonElement | HTMLElement | null;
  disabledZero: boolean;
} {
  const nodes = Array.from(
    mainRoot().querySelectorAll<HTMLElement>(
      HipiconSelectors.uploadButtons.join(","),
    ),
  );
  let disabledZero = false;
  for (const el of nodes) {
    if (!isPriceStockConfirmButton(el)) continue;
    const t = textOf(el);
    const disabled =
      (el instanceof HTMLButtonElement && el.disabled) ||
      el.getAttribute("aria-disabled") === "true" ||
      el.hasAttribute("disabled");
    if (disabled && (/^0\s/.test(t) || t.startsWith("0 "))) {
      disabledZero = true;
      continue;
    }
    if (disabled) continue;
    return { button: el, disabledZero: false };
  }
  return { button: null, disabledZero };
}

function pageText(): string {
  return (mainRoot() as HTMLElement).innerText?.toLocaleLowerCase("tr-TR") ?? "";
}

function detectImportFailure(): string | null {
  const body = pageText();
  if (body.includes("içe aktarma başarısız") || body.includes("import failed")) {
    return "Hipicon Excel içe aktarma başarısız — paneldeki hata mesajına bakın";
  }
  if (
    body.includes("hiçbir satır kaydedilmedi") ||
    body.includes("nothing was saved")
  ) {
    return "Hipicon satır hataları nedeniyle hiçbir şey kaydedilmedi";
  }
  if (
    body.includes("düzeltilmesi gereken satırlar") ||
    body.includes("rows that need fixing")
  ) {
    // Önizlemede hem diff hem skip olabilir; sadece skip + 0 güncelleme varsa fail
    if (
      body.includes("0 ürün güncellenecek") ||
      body.includes("0 product(s) will be updated") ||
      body.includes("0 ürünü güncelle")
    ) {
      return (
        "Hipicon stok kodlarını eşleştiremedi — ürünler yayımlı mı ve " +
        "Shopify SKU = Hipicon Stok Kodu olmalı (taslaklar fiyat/stok’a girmez)"
      );
    }
  }
  return null;
}

function detectImportSuccess(): boolean {
  const body = pageText();
  return (
    body.includes("işlem başarılı") ||
    body.includes("transaction successful") ||
    body.includes("içe aktarma tamamlandı") ||
    body.includes("import completed") ||
    body.includes("tüm satırlar kaydedildi") ||
    body.includes("import all saved")
  );
}

/** Panelde “Stok Kodu — 0 ürün” gibi uyarı (yayımlı katalog boş). */
export function hipiconPriceStockCatalogHint(): string | null {
  const body = pageText();
  if (
    /stok kodu\s*[—–-]\s*0\s*ürün/.test(body) ||
    /stock code\s*[—–-]\s*0\s*product/.test(body)
  ) {
    return (
      "Hipicon’da stok kodlu yayımlı ürün yok (Stok Kodu — 0 ürün). " +
      "Önce yeni ürün aktarıp taslakları yayımlayın; fiyat/stok yalnızca mevcut ürünleri günceller."
    );
  }
  return null;
}

/**
 * Fiyat/stok (PRODUCT_BULK_EDIT): yükleme sonrası Hipicon önizleme açar;
 * kaydetmek için “N ürünü güncelle” onayı gerekir.
 */
export async function confirmPriceStockPreview(
  timeoutMs = 90_000,
): Promise<{ ok: boolean; message: string }> {
  const deadline = Date.now() + timeoutMs;
  let sawPreview = false;
  let clickedApply = false;

  while (Date.now() < deadline) {
    const fail = detectImportFailure();
    if (fail) return { ok: false, message: fail };

    if (clickedApply && detectImportSuccess()) {
      return {
        ok: true,
        message: "Fiyat/stok önizlemesi onaylandı — Hipicon güncelledi",
      };
    }

    const { button, disabledZero } = findPriceStockConfirmButton();
    if (disabledZero) {
      return {
        ok: false,
        message:
          "Değişiklik bulunamadı (0 ürün) — stok kodları Hipicon’da yok veya fiyat/stok aynı",
      };
    }
    if (button) {
      sawPreview = true;
      if (!clickedApply) {
        button.click();
        clickedApply = true;
        await sleep(800);
        continue;
      }
    }

    const body = pageText();
    if (
      !sawPreview &&
      (body.includes("onaylayana kadar hiçbir şey kaydedilmez") ||
        body.includes("nothing is saved until you confirm") ||
        body.includes("ürün güncellenecek") ||
        body.includes("product(s) will be updated") ||
        body.includes("henüz kaydedilmedi") ||
        body.includes("önizleme") ||
        body.includes("preview"))
    ) {
      sawPreview = true;
    }

    await sleep(500);
  }

  if (clickedApply) {
    return {
      ok: true,
      message:
        "Onay tıklandı — panelde işlemin bittiğini kontrol edin (zaman aşımı)",
    };
  }
  if (sawPreview) {
    return {
      ok: false,
      message:
        "Önizleme göründü ama “ürünü güncelle” butonu bulunamadı / tıklanamadı",
    };
  }
  return {
    ok: false,
    message:
      "Fiyat/stok önizlemesi gelmedi — Excel yüklemesi başlamamış olabilir",
  };
}

export async function injectFile(
  input: HTMLInputElement,
  fileName: string,
  bytesBase64: string,
): Promise<void> {
  const bytes = base64ToBytes(bytesBase64);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const file = new File([copy], fileName, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const dt = new DataTransfer();
  dt.items.add(file);

  const proto = Object.getPrototypeOf(input) as HTMLInputElement;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "files");
  if (descriptor?.set) {
    descriptor.set.call(input, dt.files);
  } else {
    input.files = dt.files;
  }

  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
