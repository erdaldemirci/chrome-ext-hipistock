import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  categoryById,
  searchBagCategories,
  type CategoryRule,
  type HipiconCategory,
} from "../lib/hipicon-categories";
import type { AppSettings } from "../lib/types";
import { send } from "./messaging";

type Status = { tone: "ok" | "error"; text: string } | null;

type CategoriesMeta = {
  categories: HipiconCategory[];
  bagCount: number;
  fetchedAt: string | null;
  source: "live" | "bundled";
};

type Props = {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  busy: boolean;
  setStatus: (s: Status) => void;
  refreshSessions: () => Promise<unknown>;
  run: (action: () => Promise<void>, label?: string) => Promise<void>;
  categoriesMeta: CategoriesMeta | null;
  categoriesEpoch: number;
  onCategories: (data: CategoriesMeta) => void;
  onSaved?: () => void;
};

export function SettingsTab({
  settings,
  setSettings,
  busy,
  setStatus,
  refreshSessions,
  run,
  categoriesMeta,
  categoriesEpoch,
  onCategories,
  onSaved,
}: Props) {
  const [catQuery, setCatQuery] = useState("");
  const [geminiKeyDraft, setGeminiKeyDraft] = useState("");
  const catHits = useMemo(
    () => searchBagCategories(catQuery, 24),
    [catQuery, categoriesEpoch],
  );

  function updateRule(index: number, patch: Partial<CategoryRule>) {
    setSettings((s) => ({
      ...s,
      categoryRules: s.categoryRules.map((r, i) =>
        i === index ? { ...r, ...patch } : r,
      ),
    }));
  }

  function removeRule(index: number) {
    setSettings((s) => ({
      ...s,
      categoryRules: s.categoryRules.filter((_, i) => i !== index),
    }));
  }

  return (
    <div className="panel">
      <label>
        Shopify mağaza URL
        <input
          type="text"
          value={settings.shopifyStoreUrl}
          placeholder="https://magazaniz.myshopify.com"
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              shopifyStoreUrl: e.target.value,
            }))
          }
        />
      </label>
      <label>
        Hipicon mağaza adı
        <input
          type="text"
          value={settings.storeName}
          placeholder="magaza-adi"
          onChange={(e) =>
            setSettings((s) => ({ ...s, storeName: e.target.value }))
          }
        />
      </label>
      <p className="muted">
        Toplu yükleme:{" "}
        <code>
          https://{settings.storeName.trim() || "magaza-adi"}
          .hipicon.com/products/bulk
        </code>
      </p>
      <label>
        USD → TRY kuru
        <input
          type="number"
          min={0.01}
          step={0.01}
          value={settings.usdTryRate}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              usdTryRate: Number(e.target.value) || 0,
              usdTryRateSource: "manuel",
              usdTryRateFetchedAt: new Date().toISOString(),
            }))
          }
        />
      </label>
      <div className="row">
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const data = await send<{
                rate: number;
                source: string;
                fetchedAt: string;
                settings: AppSettings;
              }>({ type: "FETCH_USD_TRY_RATE" });
              setSettings(data.settings);
              setStatus({
                tone: "ok",
                text: `Kur: ${data.rate} TRY (${data.source})`,
              });
            }, "Kur güncelleniyor…")
          }
        >
          Kuru çek
        </button>
      </div>
      <p className="muted">
        {settings.usdTryRateSource
          ? `${settings.usdTryRateSource}${
              settings.usdTryRateFetchedAt
                ? ` · ${new Date(settings.usdTryRateFetchedAt).toLocaleString("tr-TR")}`
                : ""
            }`
          : "Önce ‘Kuru çek’"}
      </p>
      <label>
        KDV (%)
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          value={settings.vatRate}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              vatRate: Math.max(0, Number(e.target.value) || 0),
            }))
          }
        />
      </label>
      <p className="muted">
        Excel’e yazılan KDV oranı. Varsayılan %10.
      </p>

      <hr className="sep" />
      <h3 className="section-title">Gemini çeviri</h3>
      <p className="muted">
        Shopify’dan katalog çekerken ürün adı ve açıklamayı Türkçe’ye çevirir.
        Anahtar yalnızca bu cihazda saklanır (
        <a
          href="https://aistudio.google.com/apikey"
          target="_blank"
          rel="noreferrer"
        >
          Google AI Studio
        </a>
        ).
      </p>
      <label>
        Gemini API key
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={geminiKeyDraft}
          placeholder={
            settings.hasGeminiKey
              ? "Kayıtlı key var — değiştirmek için yeni key yazın"
              : "AIza…"
          }
          onChange={(e) => setGeminiKeyDraft(e.target.value)}
        />
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={settings.translateOnSync}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              translateOnSync: e.target.checked,
            }))
          }
        />
        Shopify’dan çekerken çevir (key gerekli)
      </label>
      <div className="row">
        <button
          type="button"
          className="secondary"
          disabled={busy || (!geminiKeyDraft.trim() && !settings.hasGeminiKey)}
          onClick={() =>
            void run(async () => {
              const next = await send<AppSettings>({
                type: "SAVE_SETTINGS",
                settings: { translateOnSync: settings.translateOnSync },
                ...(geminiKeyDraft.trim()
                  ? { geminiApiKey: geminiKeyDraft.trim() }
                  : {}),
              });
              setSettings(next);
              setGeminiKeyDraft("");
              setStatus({
                tone: "ok",
                text: next.hasGeminiKey
                  ? "Gemini key kaydedildi"
                  : "Çeviri ayarı kaydedildi",
              });
            }, "Gemini ayarı kaydediliyor…")
          }
        >
          Key’i kaydet
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy || !settings.hasGeminiKey}
          onClick={() =>
            void run(async () => {
              const next = await send<AppSettings>({
                type: "SAVE_SETTINGS",
                settings: { translateOnSync: settings.translateOnSync },
                clearGeminiKey: true,
              });
              setSettings(next);
              setGeminiKeyDraft("");
              setStatus({ tone: "ok", text: "Gemini key silindi" });
            }, "Gemini key siliniyor…")
          }
        >
          Key’i sil
        </button>
      </div>
      <p className="muted">
        {settings.hasGeminiKey
          ? settings.translateOnSync
            ? "Çeviri açık · key kayıtlı (Shopify’dan çekince)"
            : "Key kayıtlı · çeviri kapalı"
          : "Key yok — çeviri atlanır"}
      </p>

      <hr className="sep" />
      <h3 className="section-title">Hipicon kategori eşleme</h3>
      <p className="muted">
        Shopify’da collection var; Hipicon Excel her dosyada tek{" "}
        <code>categoryId</code> ister. Eşleme:{" "}
        <strong>product_type / başlık / tag / handle</strong> kuralları → yoksa
        varsayılan kategori. Farklı kategorilere düşen ürünler ayrı Excel
        dosyalarına bölünür.
      </p>
      <div className="row" style={{ alignItems: "center", gap: 8 }}>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const data = await send<CategoriesMeta>({
                type: "FETCH_HIPICON_CATEGORIES",
                force: true,
              });
              onCategories(data);
              setStatus({
                tone: "ok",
                text: `Hipicon kategorileri: ${data.categories.length} (çanta ${data.bagCount})`,
              });
            }, "Hipicon kategorileri çekiliyor…")
          }
        >
          Hipicon’dan kategorileri çek
        </button>
      </div>
      <p className="muted">
        Kaynak:{" "}
        {categoriesMeta?.source === "live"
          ? `Hipicon API · ${categoriesMeta.categories.length} kategori · çanta ${categoriesMeta.bagCount}`
          : "paketlenmiş liste (Hipicon oturumuyla yenileyin)"}
        {categoriesMeta?.fetchedAt
          ? ` · ${new Date(categoriesMeta.fetchedAt).toLocaleString("tr-TR")}`
          : ""}
      </p>
      <p className="cat-selected">
        Varsayılan:{" "}
        <strong>{settings.hipiconCategoryPath}</strong>{" "}
        <span className="muted">(id {settings.hipiconCategoryId})</span>
      </p>
      <label>
        Kategori ara
        <input
          type="search"
          value={catQuery}
          placeholder="ör. sırt çanta, kemer, laptop…"
          onChange={(e) => setCatQuery(e.target.value)}
        />
      </label>
      <ul className="cat-list">
        {catHits.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className={
                c.id === settings.hipiconCategoryId
                  ? "cat-item selected"
                  : "cat-item"
              }
              disabled={busy}
              onClick={() =>
                setSettings((s) => ({
                  ...s,
                  hipiconCategoryId: c.id,
                  hipiconCategoryPath: c.path,
                }))
              }
            >
              <span className="cat-path">{c.path}</span>
              <span className="muted">{c.id}</span>
            </button>
          </li>
        ))}
      </ul>

      <h4 className="section-title">Kurallar (ilk eşleşen kazanır)</h4>
      <p className="muted">
        Pattern: regex veya düz metin. Kaynak: product_type + ürün adı + handle
        + tags.
      </p>
      {settings.categoryRules.map((rule, index) => {
        const cat = categoryById(rule.categoryId);
        return (
          <div className="rule-row" key={`rule-${index}`}>
            <input
              type="text"
              value={rule.pattern}
              placeholder="backpack|sırt"
              aria-label="Eşleme pattern"
              onChange={(e) => updateRule(index, { pattern: e.target.value })}
            />
            <input
              type="text"
              value={rule.categoryId}
              placeholder="571"
              aria-label="Hipicon category id"
              className="rule-id"
              onChange={(e) =>
                updateRule(index, { categoryId: e.target.value.trim() })
              }
            />
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => removeRule(index)}
            >
              Sil
            </button>
            <p className="muted rule-hint">
              {cat ? cat.path : "bilinmeyen id — listeden seçin"}
            </p>
          </div>
        );
      })}
      <div className="row">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() =>
            setSettings((s) => ({
              ...s,
              categoryRules: [
                ...s.categoryRules,
                {
                  pattern: "",
                  categoryId: s.hipiconCategoryId,
                },
              ],
            }))
          }
        >
          Kural ekle
        </button>
      </div>

      <hr className="sep" />
      <div className="row">
        <button
          disabled={
            busy ||
            !settings.storeName.trim() ||
            !settings.shopifyStoreUrl.trim() ||
            !(settings.usdTryRate > 0)
          }
          onClick={() =>
            void run(async () => {
              const next = await send<AppSettings>({
                type: "SAVE_SETTINGS",
                settings: {
                  shopifyStoreUrl: settings.shopifyStoreUrl.trim(),
                  storeName: settings.storeName.trim(),
                  usdTryRate: settings.usdTryRate,
                  usdTryRateSource: settings.usdTryRateSource,
                  usdTryRateFetchedAt: settings.usdTryRateFetchedAt,
                  vatRate: settings.vatRate,
                  translateOnSync: settings.translateOnSync,
                  hipiconCategoryId: settings.hipiconCategoryId,
                  hipiconCategoryPath: settings.hipiconCategoryPath,
                  categoryRules: settings.categoryRules,
                },
                ...(geminiKeyDraft.trim()
                  ? { geminiApiKey: geminiKeyDraft.trim() }
                  : {}),
              });
              setSettings(next);
              setGeminiKeyDraft("");
              await refreshSessions();
              setStatus({ tone: "ok", text: "Ayarlar kaydedildi" });
              onSaved?.();
            }, "Ayarlar kaydediliyor…")
          }
        >
          Kaydet
        </button>
      </div>
    </div>
  );
}
