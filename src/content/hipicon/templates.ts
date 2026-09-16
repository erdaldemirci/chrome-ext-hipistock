function bytesToBase64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < arr.length; i += 1) {
    binary += String.fromCharCode(arr[i]!);
  }
  return btoa(binary);
}

const API_BASE = "https://bo-api.hipicon.com/designer-api/v1";

type TemplateField = {
  key?: string | null;
  label?: string | null;
  type?: string | null;
  required?: boolean | null;
  dependsOnKey?: string | null;
};

type ExcelTemplate = {
  type?: string | null;
  label?: string | null;
  downloadPath?: string | null;
  fields?: TemplateField[] | null;
  twoPhase?: boolean | null;
};

function authToken(): string {
  const token = localStorage.getItem("x-auth-token")?.trim();
  if (!token) {
    throw new Error("Hipicon oturumu yok — satıcı paneline giriş yapın");
  }
  return token;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = authToken();
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      "X-Channel": "WEB",
      "Content-Type": "application/json",
      "auth-token": token,
      ...(init?.headers ?? {}),
    },
  });
}

function unwrapData<T>(body: unknown): T {
  if (body && typeof body === "object" && "data" in body) {
    return (body as { data: T }).data;
  }
  return body as T;
}

function isNewProductTemplate(t: ExcelTemplate): boolean {
  const type = String(t.type ?? "").toUpperCase();
  const label = String(t.label ?? "").toLocaleLowerCase("tr-TR");
  if (type.includes("BULK_EDIT") || type.includes("BULKEDIT")) return false;
  if (type.includes("ENTRY") || type.includes("NEW_PRODUCT")) return true;
  if (label.includes("yeni ürün")) return true;
  return false;
}

function isPriceStockTemplate(t: ExcelTemplate): boolean {
  const type = String(t.type ?? "").toUpperCase();
  const label = String(t.label ?? "").toLocaleLowerCase("tr-TR");
  if (type.includes("BULK_EDIT") || type.includes("BULKEDIT")) return true;
  if (type.includes("PRICE") && type.includes("STOCK")) return true;
  if (label.includes("fiyat") && label.includes("stok")) return true;
  if (label.includes("fiyat / stok") || label.includes("fiyat/stok")) {
    return true;
  }
  return false;
}

async function listExcelTemplates(): Promise<ExcelTemplate[]> {
  const res = await apiFetch("/product-entry/excel/templates");
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = body as { error?: { message?: string } } | null;
    throw new Error(
      err?.error?.message || `Şablon listesi alınamadı (HTTP ${res.status})`,
    );
  }
  const data = unwrapData<unknown>(body);
  if (!Array.isArray(data)) {
    throw new Error("Şablon listesi beklenen formatta değil");
  }
  return data as ExcelTemplate[];
}

function pickNewProductTemplate(templates: ExcelTemplate[]): ExcelTemplate {
  const hit =
    templates.find(isNewProductTemplate) ??
    templates.find((t) => Boolean(t.downloadPath));
  if (!hit?.downloadPath) {
    throw new Error("Yeni ürün şablonu bulunamadı (Hipicon excel/templates)");
  }
  return hit;
}

function pickPriceStockTemplate(templates: ExcelTemplate[]): ExcelTemplate {
  const hit =
    templates.find(isPriceStockTemplate) ??
    templates.find((t) => {
      const type = String(t.type ?? "").toUpperCase();
      return type.includes("BULK");
    });
  if (!hit?.downloadPath) {
    throw new Error(
      "Fiyat/stok şablonu bulunamadı (Hipicon excel/templates)",
    );
  }
  return hit;
}

/**
 * Hipicon panelindeki “Şablonu indir” ile aynı kaynak:
 * GET /product-entry/excel/templates → downloadPath?categoryId=…
 */
export async function fetchHipiconProductEntryTemplate(
  categoryId: string,
): Promise<{ bytesBase64: string; fileName: string; label: string }> {
  const id = String(categoryId ?? "").trim();
  if (!id) throw new Error("Kategori ID gerekli");

  const template = pickNewProductTemplate(await listExcelTemplates());
  const params = new URLSearchParams();
  for (const field of template.fields ?? []) {
    const key = String(field.key ?? "").trim();
    if (!key) continue;
    const k = key.toLowerCase();
    if (k === "categoryid" || k === "category" || k.endsWith("categoryid")) {
      params.set(key, id);
    }
  }
  if (![...params.keys()].length) {
    params.set("categoryId", id);
  }

  const qs = params.toString();
  const path = `${template.downloadPath}${qs ? `?${qs}` : ""}`;
  const res = await apiFetch(path, {
    method: "GET",
    headers: { Accept: "*/*" },
  });

  if (!res.ok) {
    let message = `Şablon indirilemedi (HTTP ${res.status})`;
    try {
      const err = (await res.json()) as { error?: { message?: string } };
      if (err?.error?.message) message = err.error.message;
    } catch {
      /* blob hata gövdesi */
    }
    throw new Error(message);
  }

  const buf = await res.arrayBuffer();
  if (!buf.byteLength) throw new Error("İndirilen şablon boş");

  const label = String(template.label ?? "yeni-urun").trim() || "yeni-urun";
  const safeLabel = label
    .toLocaleLowerCase("tr-TR")
    .replace(/[^a-z0-9çğıöşü]+/gi, "-")
    .replace(/^-|-$/g, "");

  return {
    bytesBase64: bytesToBase64(buf),
    fileName: `${safeLabel || "yeni-urun"}-cat${id}.xlsx`,
    label,
  };
}

/**
 * Hipicon “Fiyat / stok güncelleme” şablonu (PRODUCT_BULK_EDIT).
 * Panel: şablon tipi + opsiyonel ürün durumu / satır kimliği.
 * Ürün durumu göndermiyoruz → aktif+pasif hepsi (UI’de “Aktif” daraltmasın).
 * Satır kimliği: stockCode (Meta.rowIdentifier ile aynı).
 * İnen satırlar temizlenip yalnızca seçilen Shopify SKU’ları yazılır.
 */
export async function fetchHipiconPriceStockTemplate(): Promise<{
  bytesBase64: string;
  fileName: string;
  label: string;
}> {
  const template = pickPriceStockTemplate(await listExcelTemplates());
  const downloadPath = String(template.downloadPath ?? "").trim();
  if (!downloadPath) {
    throw new Error("Fiyat/stok şablonunda downloadPath yok");
  }

  const params = new URLSearchParams();
  for (const field of template.fields ?? []) {
    const key = String(field.key ?? "").trim();
    if (!key) continue;
    const k = key.toLowerCase();
    const label = String(field.label ?? "").toLocaleLowerCase("tr-TR");
    const isRowId =
      k.includes("rowidentifier") ||
      k.includes("row_identifier") ||
      k === "identifier" ||
      label.includes("satır kimlik") ||
      label.includes("row identifier");
    if (isRowId) {
      params.set(key, "stockCode");
      continue;
    }
    // productStatus / ürün durumu: bilerek boş — tüm ürünlerin şablon iskeleti
  }

  const qs = params.toString();
  const path = `${downloadPath}${qs ? `?${qs}` : ""}`;
  const res = await apiFetch(path, {
    method: "GET",
    headers: { Accept: "*/*" },
  });

  if (!res.ok) {
    let message = `Fiyat/stok şablonu indirilemedi (HTTP ${res.status})`;
    try {
      const err = (await res.json()) as { error?: { message?: string } };
      if (err?.error?.message) message = err.error.message;
    } catch {
      /* blob hata gövdesi */
    }
    throw new Error(message);
  }

  const buf = await res.arrayBuffer();
  if (!buf.byteLength) throw new Error("İndirilen fiyat/stok şablonu boş");

  const label =
    String(template.label ?? "fiyat-stok").trim() || "fiyat-stok";
  const safeLabel = label
    .toLocaleLowerCase("tr-TR")
    .replace(/[^a-z0-9çğıöşü]+/gi, "-")
    .replace(/^-|-$/g, "");

  return {
    bytesBase64: bytesToBase64(buf),
    fileName: `${safeLabel || "fiyat-stok"}.xlsx`,
    label,
  };
}
