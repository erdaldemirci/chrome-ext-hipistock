/** Shopify fiyatını Hipicon TRY’ye çevir (…9 psikolojik fiyat). */

export function normalizeCurrency(code: string | null | undefined): string {
  return (code || "USD").trim().toUpperCase();
}

export function priceToTry(
  amount: number,
  currency: string | null | undefined,
  usdTryRate: number,
): number {
  const code = normalizeCurrency(currency);
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return 0;

  if (code === "TRY" || code === "TL") {
    return roundUpEndingNine(n);
  }
  if (code === "USD") {
    if (!(usdTryRate > 0)) {
      throw new Error("USD→TRY kuru ayarlanmamış (Ayarlar)");
    }
    return roundUpEndingNine(n * usdTryRate);
  }
  throw new Error(
    `Desteklenmeyen para birimi: ${code}. Şimdilik USD→TRY veya TRY.`,
  );
}

/** Liste / Excel için efektif TL (manuel override veya kurdan). */
export function effectiveTryPrice(
  item: {
    price: number;
    currency: string;
    priceTry?: number | null;
  },
  usdTryRate: number,
): number {
  if (
    typeof item.priceTry === "number" &&
    Number.isFinite(item.priceTry) &&
    item.priceTry > 0
  ) {
    // Manuel giriş: kullanıcı değeri olduğu gibi (sonu-9 yok)
    return roundMoney(item.priceTry);
  }
  return priceToTry(item.price, item.currency, usdTryRate);
}

/**
 * En küçük tam TL ≥ value ve 9 ile biter.
 * Örn. 486.2 → 489, 490 → 499, 489 → 489
 */
export function roundUpEndingNine(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const base = Math.ceil(value);
  const last = base % 10;
  if (last === 9) return base;
  return base + (9 - last);
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function assertUsdTryRate(rate: number): number {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("USD→TRY kuru 0’dan büyük olmalı");
  }
  return n;
}
