import { effectiveTryPrice } from "../lib/currency";

export function money(value: number, currency = "TRY") {
  try {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: currency === "USD" ? "USD" : "TRY",
      maximumFractionDigits: currency === "USD" ? 2 : 0,
    }).format(value);
  } catch {
    return String(value);
  }
}

export function hipiconPriceLabel(
  price: number,
  currency: string,
  usdTryRate: number,
  priceTry?: number | null,
): string {
  try {
    const tryPrice = effectiveTryPrice(
      { price, currency, priceTry },
      usdTryRate,
    );
    const code = (currency || "USD").toUpperCase();
    if (code === "TRY" || code === "TL") return money(tryPrice, "TRY");
    return `${money(tryPrice, "TRY")} ← ${money(price, code)}`;
  } catch {
    return money(price, currency);
  }
}
