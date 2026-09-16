import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  categoryById,
  resolveHipiconCategory,
  searchBagCategories,
} from "../lib/hipicon-categories";
import { effectiveTryPrice } from "../lib/currency";
import type { AppSettings, CatalogCache, CatalogVariant } from "../lib/types";
import { money } from "./format";
import { send } from "./messaging";

type Status = { tone: "ok" | "error"; text: string } | null;

type Props = {
  catalog: CatalogCache | null;
  setCatalog: (c: CatalogCache | null) => void;
  settings: AppSettings;
  query: string;
  setQuery: (q: string) => void;
  filtered: CatalogVariant[];
  selectedCount: number;
  busy: boolean;
  setStatus: (s: Status) => void;
  setConfirmPush: (mode: "price_stock" | "product_entry") => void;
  setConfirmDeleteDrafts: (v: boolean) => void;
  loadWorkspace: () => Promise<void>;
  run: (action: () => Promise<void>, label?: string) => Promise<void>;
  categoriesEpoch: number;
};

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="btn-icon"
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

function IconDownload() {
  return (
    <Icon>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </Icon>
  );
}

function IconShopify() {
  return (
    <Icon>
      <path d="M6 8.5 8 20h8l2-11.5" />
      <path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" />
      <path d="M6 8.5h12" />
    </Icon>
  );
}

function IconHipicon() {
  return (
    <Icon>
      <path d="M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9.5Z" />
      <path d="M9 21V12h6v9" />
    </Icon>
  );
}

function IconNewProduct() {
  return (
    <Icon>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M12 8v8" />
      <path d="M8 12h8" />
    </Icon>
  );
}

function IconPriceStock() {
  return (
    <Icon>
      <path d="M12 3v18" />
      <path d="M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 3 4.5 3 4.5 1.3 4.5 3-2 3-4.5 3-4.5-1.3-4.5-3" />
    </Icon>
  );
}

function IconTrash() {
  return (
    <Icon>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M7 7l1 13h8l1-13" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </Icon>
  );
}

function IconSearch() {
  return (
    <Icon>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Icon>
  );
}

function resolvedCategory(v: CatalogVariant, settings: AppSettings) {
  if (v.hipiconCategoryId) {
    return (
      categoryById(v.hipiconCategoryId) ?? {
        id: v.hipiconCategoryId,
        path: v.hipiconCategoryPath || v.hipiconCategoryId,
      }
    );
  }
  return resolveHipiconCategory({
    defaultId: settings.hipiconCategoryId,
    rules: settings.categoryRules,
    productType: v.productType,
    title: v.name,
    handle: v.handle,
    tags: v.tags,
  });
}

function EditableNumber({
  value,
  disabled,
  step = 1,
  min = 0,
  onCommit,
}: {
  value: number;
  disabled: boolean;
  step?: number;
  min?: number;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);

  const display = focused ? draft : String(value);

  return (
    <input
      className="cell-edit"
      type="number"
      min={min}
      step={step}
      disabled={disabled}
      value={display}
      onFocus={() => {
        setFocused(true);
        setDraft(String(value));
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false);
        const n = Number(draft);
        if (!Number.isFinite(n) || n === value) {
          setDraft(String(value));
          return;
        }
        onCommit(n);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function SyncTab({
  catalog,
  setCatalog,
  settings,
  query,
  setQuery,
  filtered,
  selectedCount,
  busy,
  setStatus,
  setConfirmPush,
  setConfirmDeleteDrafts,
  loadWorkspace,
  run,
  categoriesEpoch,
}: Props) {
  const [listTab, setListTab] = useState<"active" | "passive" | "sent">(
    "active",
  );

  const pendingRows = useMemo(
    () => filtered.filter((v) => !v.pushedAt),
    [filtered],
  );
  const sentRows = useMemo(
    () => filtered.filter((v) => Boolean(v.pushedAt)),
    [filtered],
  );
  const activeRows = useMemo(
    () => pendingRows.filter((v) => v.stock > 0),
    [pendingRows],
  );
  const passiveRows = useMemo(
    () => pendingRows.filter((v) => v.stock <= 0),
    [pendingRows],
  );
  const listRows =
    listTab === "active"
      ? activeRows
      : listTab === "passive"
        ? passiveRows
        : sentRows;
  const listSelectedCount = useMemo(
    () => listRows.filter((v) => v.selected).length,
    [listRows],
  );
  const allListSelected =
    listRows.length > 0 && listSelectedCount === listRows.length;
  const someListSelected =
    listSelectedCount > 0 && listSelectedCount < listRows.length;

  const [bulkStock, setBulkStock] = useState("");
  const [bulkPriceTry, setBulkPriceTry] = useState("");
  const [bulkCategory, setBulkCategory] = useState<{
    id: string;
    path: string;
  } | null>(null);

  async function applyBulkUpdate() {
    if (selectedCount === 0) {
      setStatus({ tone: "error", text: "Önce ürün seçin" });
      return;
    }
    const patch: {
      type: "BULK_UPDATE_SELECTED";
      stock?: number;
      priceTry?: number;
      hipiconCategoryId?: string | null;
      hipiconCategoryPath?: string | null;
    } = { type: "BULK_UPDATE_SELECTED" };

    const stockRaw = bulkStock.trim();
    if (stockRaw !== "") {
      const n = Number(stockRaw);
      if (!Number.isFinite(n) || n < 0) {
        setStatus({ tone: "error", text: "Stok geçersiz" });
        return;
      }
      patch.stock = n;
    }
    const priceRaw = bulkPriceTry.trim();
    if (priceRaw !== "") {
      const n = Number(priceRaw);
      if (!Number.isFinite(n) || n < 0) {
        setStatus({ tone: "error", text: "Fiyat geçersiz" });
        return;
      }
      patch.priceTry = n;
    }
    if (bulkCategory) {
      patch.hipiconCategoryId = bulkCategory.id;
      patch.hipiconCategoryPath = bulkCategory.path;
    }
    if (
      patch.stock === undefined &&
      patch.priceTry === undefined &&
      patch.hipiconCategoryId === undefined
    ) {
      setStatus({
        tone: "error",
        text: "Stok, fiyat veya kategori girin",
      });
      return;
    }

    const result = await send<{ catalog: CatalogCache; updated: number }>(
      patch,
    );
    setCatalog(result.catalog);
    setBulkStock("");
    setBulkPriceTry("");
    setBulkCategory(null);
    const parts: string[] = [];
    if (patch.stock !== undefined) parts.push(`stok ${patch.stock}`);
    if (patch.priceTry !== undefined) parts.push(`TL ${patch.priceTry}`);
    if (bulkCategory) parts.push("kategori");
    setStatus({
      tone: "ok",
      text: `${result.updated} satır güncellendi · ${parts.join(" · ")}`,
    });
  }

  return (
    <>
      <div className="panel toolbar">
        <div className="actions-grid">
          <button
            className="actions-span"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await send<{
                  count: number;
                  added?: number;
                  updated?: number;
                  removed?: number;
                  usedAdminInventory: boolean;
                  inventorySource: "session" | "token" | "public";
                  storeName: string;
                  syncedAt: string;
                  note?: string;
                }>({ type: "SYNC_SHOPIFY" });
                await loadWorkspace();
                const source =
                  result.inventorySource === "session"
                    ? "Admin oturum stok"
                    : result.inventorySource === "token"
                      ? "API token stok"
                      : "public stok";
                setStatus({
                  tone: "ok",
                  text: `${result.storeName}: ${result.count} varyant · ${source}${
                    result.note ? ` — ${result.note}` : ""
                  }`,
                });
              }, settings.translateOnSync && settings.hasGeminiKey
                ? "Shopify çekiliyor + Gemini çeviri…"
                : "Shopify katalog ve stok çekiliyor…")
            }
          >
            <IconDownload />
            Shopify’dan çek
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await send({ type: "OPEN_LOGIN", site: "shopify" });
                setStatus({
                  tone: "ok",
                  text: "Shopify Admin sekmesi açıldı",
                });
              }, "Shopify Admin açılıyor…")
            }
          >
            <IconShopify />
            Shopify
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await send({ type: "OPEN_LOGIN", site: "hipicon" });
                setStatus({
                  tone: "ok",
                  text: "Hipicon sekmesi açıldı",
                });
              }, "Hipicon paneli açılıyor…")
            }
          >
            <IconHipicon />
            Hipicon
          </button>
        </div>

        <p className="meta-bar">
          {catalog ? (
            <>
              <strong>{catalog.storeName}</strong>
              <span aria-hidden="true">·</span>
              {new Date(catalog.syncedAt).toLocaleString("tr-TR")}
            </>
          ) : (
            "Mağaza henüz çekilmedi"
          )}
        </p>
      </div>

      <div className="panel list-panel">
        <div className="list-toolbar">
          <div className="list-toolbar-push">
            <button
              type="button"
              className="secondary"
              disabled={busy || selectedCount === 0}
              onClick={() => setConfirmPush("product_entry")}
            >
              <IconNewProduct />
              Yeni ürün aktar
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy || selectedCount === 0}
              onClick={() => setConfirmPush("price_stock")}
            >
              <IconPriceStock />
              Fiyat / stok aktar
            </button>
          </div>

          <div className="list-toolbar-tools">
            <div className="search-field">
              <IconSearch />
              <input
                type="search"
                value={query}
                placeholder="SKU veya ürün adı"
                aria-label="Ara"
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="secondary danger-outline list-clear-btn"
              disabled={busy || !catalog}
              title="Yerel katalog listesini temizle"
              onClick={() =>
                void run(async () => {
                  await send({ type: "CLEAR_CATALOG" });
                  setCatalog(null);
                  setStatus({ tone: "ok", text: "Liste silindi" });
                }, "Liste temizleniyor…")
              }
            >
              <IconTrash />
              Listeyi sil
            </button>
          </div>

          <div className="list-toolbar-select">
            <label className="select-all">
              <input
                type="checkbox"
                disabled={busy || listRows.length === 0}
                checked={allListSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someListSelected;
                }}
                onChange={(e) =>
                  void run(async () => {
                    const next = await send<CatalogCache>({
                      type: "SET_SELECTION",
                      variantIds: listRows.map((v) =>
                        String(v.shopifyVariantId),
                      ),
                      selected: e.target.checked,
                    });
                    setCatalog(next);
                  })
                }
              />
              <span>
                {listTab === "active"
                  ? "Aktifleri seç"
                  : listTab === "passive"
                    ? "Pasifleri seç"
                    : "Gönderilenleri seç"}
              </span>
            </label>
            <select
              className="bulk-select-input"
              disabled={busy || !catalog}
              value=""
              aria-label="Toplu işlemler"
              onChange={(e) => {
                const action = e.target.value;
                e.target.value = "";
                if (!action) return;
                void run(async () => {
                  if (action === "remove_selected") {
                    if (selectedCount === 0) {
                      setStatus({
                        tone: "error",
                        text: "Silinecek seçili ürün yok",
                      });
                      return;
                    }
                    const result = await send<{
                      catalog: CatalogCache | null;
                      removed: number;
                    }>({ type: "REMOVE_SELECTED" });
                    setCatalog(result.catalog);
                    const left = result.catalog?.variants.length ?? 0;
                    setStatus({
                      tone: "ok",
                      text:
                        left > 0
                          ? `${result.removed} satır listeden silindi · ${left} kaldı`
                          : `${result.removed} satır listeden silindi`,
                    });
                    return;
                  }
                  if (action === "unmark_pushed") {
                    if (selectedCount === 0) {
                      setStatus({
                        tone: "error",
                        text: "Geri alınacak seçili ürün yok",
                      });
                      return;
                    }
                    const result = await send<{
                      catalog: CatalogCache;
                      count: number;
                    }>({ type: "UNMARK_PUSHED" });
                    setCatalog(result.catalog);
                    setStatus({
                      tone: "ok",
                      text: `${result.count} satır ana listeye alındı`,
                    });
                    setListTab("active");
                  }
                });
              }}
            >
              <option value="" disabled>
                Toplu işlemler
              </option>
              <option value="remove_selected">Seçili olanları sil</option>
              <option value="unmark_pushed">
                Seçilileri gönderilenlerden çıkar
              </option>
            </select>
          </div>
        </div>

        {selectedCount > 0 && (
          <div className="bulk-edit-bar" aria-label="Seçili satırları güncelle">
            <div className="bulk-edit-row">
              <span className="bulk-edit-count">{selectedCount} seçili</span>
              <label className="bulk-edit-field">
                <span>Stok</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  placeholder="—"
                  disabled={busy}
                  value={bulkStock}
                  onChange={(e) => setBulkStock(e.target.value)}
                />
              </label>
              <label className="bulk-edit-field">
                <span>TL</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="decimal"
                  placeholder="—"
                  disabled={busy || !(settings.usdTryRate > 0)}
                  value={bulkPriceTry}
                  onChange={(e) => setBulkPriceTry(e.target.value)}
                />
              </label>
            </div>
            <div className="bulk-edit-row bulk-edit-row-cat">
              <div className="bulk-edit-cat">
                <CategoryPicker
                  path={bulkCategory?.path || "Kategori"}
                  disabled={busy}
                  categoriesEpoch={categoriesEpoch}
                  onPick={(picked) => setBulkCategory(picked)}
                />
              </div>
              <button
                type="button"
                className="secondary bulk-edit-apply"
                disabled={busy}
                onClick={() => void run(applyBulkUpdate, "Toplu güncelleme uygulanıyor…")}
              >
                Uygula
              </button>
            </div>
          </div>
        )}

        <div className="tabs list-tabs">
          <button
            type="button"
            className={listTab === "active" ? "active" : ""}
            onClick={() => setListTab("active")}
          >
            Aktif
            <span className="tab-count">{activeRows.length}</span>
          </button>
          <button
            type="button"
            className={listTab === "passive" ? "active" : ""}
            onClick={() => setListTab("passive")}
          >
            Pasif
            <span className="tab-count">{passiveRows.length}</span>
          </button>
          <button
            type="button"
            className={listTab === "sent" ? "active" : ""}
            onClick={() => setListTab("sent")}
          >
            Gönderilenler
            <span className="tab-count">{sentRows.length}</span>
          </button>
        </div>

        <div className="table-wrap">
          <CatalogSection
            tone={listTab === "sent" ? "sent" : listTab}
            rows={listRows}
            settings={settings}
            busy={busy}
            emptyLabel={
              !catalog
                ? "Katalog boş — Shopify’dan çekin"
                : listTab === "active"
                  ? "Aktif ürün yok (stok > 0)"
                  : listTab === "passive"
                    ? "Pasif ürün yok (stok 0)"
                    : "Henüz aktarılan ürün yok"
            }
            setCatalog={setCatalog}
            run={run}
            categoriesEpoch={categoriesEpoch}
          />
        </div>

        <button
          type="button"
          className="danger list-footer-danger"
          disabled={busy}
          onClick={() => setConfirmDeleteDrafts(true)}
        >
          <IconTrash />
          Hipicon'daki Tüm Taslakları Sil
        </button>
      </div>

    </>
  );
}

function CatalogSection({
  tone,
  rows,
  settings,
  busy,
  emptyLabel,
  setCatalog,
  run,
  categoriesEpoch,
}: {
  tone: "active" | "passive" | "sent";
  rows: CatalogVariant[];
  settings: AppSettings;
  busy: boolean;
  emptyLabel: string;
  setCatalog: (c: CatalogCache | null) => void;
  run: (action: () => Promise<void>, label?: string) => Promise<void>;
  categoriesEpoch: number;
}) {
  const [preview, setPreview] = useState<{
    url: string;
    name: string;
  } | null>(null);

  return (
    <div className={`catalog-section catalog-section-${tone}`}>
      <div className="catalog-list">
        {rows.map((v) => {
          const cat = resolvedCategory(v, settings);
          return (
            <article
              key={`${v.shopifyVariantId}-${v.sku}`}
              className="catalog-card"
            >
              <div className="catalog-card-main">
                <input
                  type="checkbox"
                  checked={v.selected}
                  aria-label={`${v.name} seç`}
                  onChange={(e) =>
                    void run(async () => {
                      const next = await send<CatalogCache>({
                        type: "SET_SELECTION",
                        variantIds: [String(v.shopifyVariantId)],
                        selected: e.target.checked,
                      });
                      setCatalog(next);
                    })
                  }
                />
                {v.imageUrl ? (
                  <button
                    type="button"
                    className="thumb-btn"
                    title="Büyüt"
                    onClick={() =>
                      setPreview({ url: v.imageUrl!, name: v.name })
                    }
                  >
                    <img
                      className="thumb"
                      src={v.imageUrl}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  </button>
                ) : (
                  <span className="thumb thumb-empty" aria-hidden="true" />
                )}
                <div className="product-cell">
                  <span className="product-name">{v.name}</span>
                  <span className="sku muted">{v.sku}</span>
                  {tone === "sent" && v.pushedAt ? (
                    <span className="muted sent-meta">
                      {v.pushedMode === "product_entry"
                        ? "Yeni ürün"
                        : v.pushedMode === "price_stock"
                          ? "Fiyat/stok"
                          : "Aktarıldı"}
                      {" · "}
                      {new Date(v.pushedAt).toLocaleString("tr-TR")}
                    </span>
                  ) : null}
                </div>
                <EditableNumber
                  value={v.stock}
                  disabled={busy}
                  step={1}
                  onCommit={(stock) =>
                    void run(async () => {
                      const next = await send<CatalogCache>({
                        type: "UPDATE_VARIANT",
                        sku: v.sku,
                        stock,
                      });
                      setCatalog(next);
                    })
                  }
                />
                <div className="price-cell">
                  <EditableNumber
                    value={(() => {
                      try {
                        return effectiveTryPrice(v, settings.usdTryRate);
                      } catch {
                        return 0;
                      }
                    })()}
                    disabled={busy || !(settings.usdTryRate > 0)}
                    step={1}
                    onCommit={(priceTry) =>
                      void run(async () => {
                        const next = await send<CatalogCache>({
                          type: "UPDATE_VARIANT",
                          sku: v.sku,
                          priceTry,
                        });
                        setCatalog(next);
                      })
                    }
                  />
                  <span
                    className="muted price-sub"
                    title="Manuel TL fiyatı (sonu 9 uygulanmaz)"
                  >
                    {(v.currency || "USD").toUpperCase() !== "TRY"
                      ? money(v.price, (v.currency || "USD").toUpperCase())
                      : "TL"}
                  </span>
                </div>
              </div>
              <div className="catalog-card-cat">
                <CategoryPicker
                  path={cat.path}
                  disabled={busy}
                  categoriesEpoch={categoriesEpoch}
                  onPick={(picked) =>
                    void run(async () => {
                      const next = await send<CatalogCache>({
                        type: "UPDATE_VARIANT",
                        sku: v.sku,
                        hipiconCategoryId: picked.id,
                        hipiconCategoryPath: picked.path,
                      });
                      setCatalog(next);
                    })
                  }
                />
              </div>
            </article>
          );
        })}
        {!rows.length && (
          <p className="muted catalog-empty">{emptyLabel}</p>
        )}
      </div>
      {preview && (
        <button
          type="button"
          className="thumb-preview"
          aria-label="Önizlemeyi kapat"
          onClick={() => setPreview(null)}
        >
          <img
            src={preview.url}
            alt={preview.name}
            referrerPolicy="no-referrer"
            onClick={(e) => e.stopPropagation()}
          />
          <span className="thumb-preview-caption">{preview.name}</span>
        </button>
      )}
    </div>
  );
}

function CategoryPicker({
  path,
  disabled,
  onPick,
  categoriesEpoch,
}: {
  path: string;
  disabled: boolean;
  onPick: (cat: { id: string; path: string }) => void;
  categoriesEpoch: number;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const hits = useMemo(
    () => searchBagCategories(q, 30),
    [q, categoriesEpoch],
  );

  return (
    <div className={`cat-picker${open ? " open" : ""}`}>
      <button
        type="button"
        className="cat-picker-btn"
        disabled={disabled}
        title={path}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="cat-picker-path">{path}</span>
        <span className="cat-picker-hint" aria-hidden="true">
          değiştir
        </span>
      </button>
      {open && (
        <div className="cat-picker-pop">
          <input
            type="search"
            autoFocus
            placeholder="Kategori ara…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <ul>
            {hits.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={c.path === path ? "selected" : undefined}
                  onClick={() => {
                    onPick(c);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  {c.path}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="secondary cat-picker-close"
            onClick={() => setOpen(false)}
          >
            Kapat
          </button>
        </div>
      )}
    </div>
  );
}
