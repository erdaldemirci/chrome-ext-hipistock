import type { CatalogVariant } from "./types";

const GEMINI_MODEL = "gemini-3.6-flash";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const BATCH_SIZE = 12;

type TranslateItem = {
  id: string;
  name: string;
  description: string;
};

function looksTurkish(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  // Basit sezgi: Türkçe karakter veya yaygın TR kelime
  if (/[çğıöşüÇĞİÖŞÜ]/.test(t)) return true;
  const lower = t.toLocaleLowerCase("tr-TR");
  return /\b(ve|ile|için|ürün|çanta|deri|renk|beden)\b/.test(lower);
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence?.[1]?.trim() || trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Gemini yanıtında JSON yok");
  }
  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}

async function callGemini(
  apiKey: string,
  items: TranslateItem[],
): Promise<Map<string, { name: string; description: string }>> {
  const prompt = [
    "Shopify ürün metinlerini Türkçe’ye çevir.",
    "Kurallar:",
    "- Yalnızca JSON döndür: {\"items\":[{\"id\":\"...\",\"name\":\"...\",\"description\":\"...\"}]}",
    "- Marka adlarını, model kodlarını, SKU’yu ve ölçü birimlerini (cm, L, XL) koru.",
    "- HTML yok; düz metin. description’da satır sonları \\n olabilir.",
    "- Zaten Türkçe ise anlamı bozmadan hafifçe düzenle veya olduğu gibi bırak.",
    "- items sırası ve id’ler aynı kalsın.",
    "",
    JSON.stringify({ items }),
  ].join("\n");

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    }),
  });

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const err = body as {
      error?: { message?: string };
    } | null;
    throw new Error(
      err?.error?.message || `Gemini API hata (HTTP ${res.status})`,
    );
  }

  const text = (
    body as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    }
  )?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("")
    .trim();

  if (!text) throw new Error("Gemini boş yanıt döndü");

  const parsed = extractJsonObject(text) as {
    items?: Array<{ id?: string; name?: string; description?: string }>;
  };
  const map = new Map<string, { name: string; description: string }>();
  for (const item of parsed.items ?? []) {
    const id = String(item.id ?? "").trim();
    if (!id) continue;
    map.set(id, {
      name: String(item.name ?? "").trim(),
      description: String(item.description ?? "").trim(),
    });
  }
  return map;
}

/**
 * Seçili varyantların ad + açıklamasını Gemini ile TR’ye çevirir.
 * Aynı shopifyProductId paylaşan varyantlar tek metin olarak çevrilir.
 */
export async function translateVariantsForHipicon(
  variants: CatalogVariant[],
  apiKey: string,
): Promise<CatalogVariant[]> {
  const key = apiKey.trim();
  if (!key) return variants;

  const byProduct = new Map<
    string,
    { name: string; description: string; needs: boolean }
  >();

  for (const v of variants) {
    const pid = String(v.shopifyProductId || v.sku).trim();
    if (!pid || byProduct.has(pid)) continue;
    const name = (v.name ?? "").trim();
    const description = stripHtml(v.description ?? v.name ?? "");
    const needs = !looksTurkish(name) || !looksTurkish(description);
    byProduct.set(pid, { name, description, needs });
  }

  const todo = [...byProduct.entries()]
    .filter(([, meta]) => meta.needs)
    .map(([id, meta]) => ({
      id,
      name: meta.name,
      description: meta.description,
    }));

  if (!todo.length) return variants;

  const translated = new Map<string, { name: string; description: string }>();

  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE);
    const map = await callGemini(key, batch);
    for (const [id, value] of map) {
      if (value.name || value.description) translated.set(id, value);
    }
  }

  if (!translated.size) {
    throw new Error("Gemini çeviri sonucu boş — API key / kota kontrol edin");
  }

  return variants.map((v) => {
    const pid = String(v.shopifyProductId || v.sku).trim();
    const hit = translated.get(pid);
    if (!hit) return v;
    return {
      ...v,
      name: hit.name || v.name,
      description: hit.description || v.description,
    };
  });
}
