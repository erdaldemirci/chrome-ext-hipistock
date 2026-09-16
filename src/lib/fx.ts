import { assertUsdTryRate, roundMoney } from "./currency";

export type FxQuote = {
  rate: number;
  source: string;
  fetchedAt: string;
};

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** TCMB bugünkü kur XML — USD Döviz Satış */
async function fetchFromTcmb(): Promise<FxQuote> {
  const xml = await fetchText("https://www.tcmb.gov.tr/kurlar/today.xml");
  const usdBlock = xml.match(
    /<Currency[^>]*CurrencyCode="USD"[^>]*>([\s\S]*?)<\/Currency>/i,
  );
  if (!usdBlock?.[1]) throw new Error("TCMB XML’de USD bulunamadı");

  const selling = usdBlock[1].match(/<ForexSelling>([\d.,]+)<\/ForexSelling>/i);
  const buying = usdBlock[1].match(/<ForexBuying>([\d.,]+)<\/ForexBuying>/i);
  const raw = selling?.[1] ?? buying?.[1];
  if (!raw) throw new Error("TCMB USD kur değeri yok");

  const rate = roundMoney(Number(raw.replace(",", ".")));
  assertUsdTryRate(rate);

  return {
    rate,
    source: selling
      ? "TCMB USD Döviz Satış"
      : "TCMB USD Döviz Alış",
    fetchedAt: new Date().toISOString(),
  };
}

/** ECB tabanlı ücretsiz API (yedek) */
async function fetchFromFrankfurter(): Promise<FxQuote> {
  const data = await fetchJson<{
    rates?: { TRY?: number };
    date?: string;
  }>("https://api.frankfurter.app/latest?from=USD&to=TRY");
  const rate = roundMoney(Number(data.rates?.TRY));
  assertUsdTryRate(rate);
  return {
    rate,
    source: `Frankfurter/ECB${data.date ? ` (${data.date})` : ""}`,
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchFromOpenErApi(): Promise<FxQuote> {
  const data = await fetchJson<{
    rates?: { TRY?: number };
    result?: string;
  }>("https://open.er-api.com/v6/latest/USD");
  if (data.result && data.result !== "success") {
    throw new Error("open.er-api başarısız");
  }
  const rate = roundMoney(Number(data.rates?.TRY));
  assertUsdTryRate(rate);
  return {
    rate,
    source: "open.er-api",
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchLiveUsdTryRate(): Promise<FxQuote> {
  const errors: string[] = [];
  for (const fn of [fetchFromTcmb, fetchFromFrankfurter, fetchFromOpenErApi]) {
    try {
      return await fn();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(
    `Canlı kur alınamadı: ${errors.slice(0, 2).join(" · ") || "bilinmeyen"}`,
  );
}

export function isFxStale(
  fetchedAt: string | null | undefined,
  maxAgeMs = 6 * 60 * 60 * 1000,
): boolean {
  if (!fetchedAt) return true;
  const t = Date.parse(fetchedAt);
  if (!Number.isFinite(t)) return true;
  return Date.now() - t > maxAgeMs;
}
