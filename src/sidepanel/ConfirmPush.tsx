import type {
  AppSettings,
  CatalogCache,
  CatalogVariant,
  PushMode,
} from "../lib/types";
import { hipiconPriceLabel } from "./format";
import { send } from "./messaging";

type Status = { tone: "ok" | "error"; text: string } | null;

type Props = {
  mode: PushMode;
  selectedCount: number;
  selectedVariantIds: string[];
  previewRows: CatalogVariant[];
  settings: AppSettings;
  busy: boolean;
  setConfirmPush: (mode: PushMode | null) => void;
  setStatus: (s: Status) => void;
  setCatalog: (c: CatalogCache | null) => void;
  run: (action: () => Promise<void>, label?: string) => Promise<void>;
};

export function ConfirmPush({
  mode,
  selectedCount,
  selectedVariantIds,
  previewRows,
  settings,
  busy,
  setConfirmPush,
  setStatus,
  setCatalog,
  run,
}: Props) {
  return (
    <div
      className="confirm-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div className="panel confirm-panel">
        <h2 id="confirm-title">
          {mode === "price_stock"
            ? "Fiyat/stok aktarımını onayla"
            : "Yeni ürün aktarımını onayla"}
        </h2>
        <p className="muted">
          {selectedCount} satır
          {mode === "product_entry" && settings.hipiconCategoryPath
            ? ` · ${settings.hipiconCategoryPath}`
            : ""}
          {mode === "price_stock"
            ? " · Hipicon’da yayımlı ürün + aynı stok kodu gerekir (taslaklar sayılmaz)"
            : ""}
        </p>
        <div className="table-wrap confirm-table">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Ürün</th>
                <th>Stok</th>
                <th>TRY</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((v) => (
                <tr key={`preview-${v.sku}`}>
                  <td className="sku">{v.sku}</td>
                  <td>{v.name}</td>
                  <td>{v.stock}</td>
                  <td>
                    {hipiconPriceLabel(
                      v.price,
                      v.currency,
                      settings.usdTryRate,
                      v.priceTry,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {selectedCount > previewRows.length && (
          <p className="muted">
            +{selectedCount - previewRows.length} satır daha
          </p>
        )}
        <div className="row">
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await send<{
                  ok: boolean;
                  message: string;
                  count: number;
                  catalog?: CatalogCache | null;
                }>({
                  type: "PUSH_HIPICON",
                  mode,
                  variantIds: selectedVariantIds,
                });
                if (result.catalog !== undefined) {
                  setCatalog(result.catalog);
                }
                setConfirmPush(null);
                setStatus({
                  tone: result.ok === false ? "error" : "ok",
                  text: result.message,
                });
              }, mode === "product_entry"
                ? "Yeni ürün Hipicon’a aktarılıyor…"
                : "Fiyat / stok Hipicon’a aktarılıyor…")
            }
          >
            Onayla ve aktar
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => setConfirmPush(null)}
          >
            Vazgeç
          </button>
        </div>
      </div>
    </div>
  );
}
