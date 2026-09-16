import type { Dispatch, SetStateAction } from "react";
import type { AppSettings, SessionCheckResult } from "../lib/types";
import { BrandLogo } from "./BrandLogo";
import { send } from "./messaging";

type Status = { tone: "ok" | "error"; text: string } | null;

type Props = {
  sessions: SessionCheckResult | null;
  checkingSessions: boolean;
  busy: boolean;
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  status: Status;
  setStatus: (s: Status) => void;
  showSettings: boolean;
  onShowSettings: () => void;
  refreshSessions: () => Promise<SessionCheckResult>;
  run: (action: () => Promise<void>, label?: string) => Promise<void>;
};

export function SessionGate({
  sessions,
  checkingSessions,
  busy,
  settings,
  setSettings,
  status,
  setStatus,
  showSettings,
  onShowSettings,
  refreshSessions,
  run,
}: Props) {
  return (
    <div className="app">
      <div className="brand">
        <div className="brand-title">
          <BrandLogo className="brand-logo" />
          <h1>Hipistock</h1>
        </div>
        <p>Shopify → Hipicon paneli otomasyonu.</p>
      </div>

      <div className="panel">
        <strong>Oturum kontrolü</strong>
        <p className="muted">
          Eklenti Shopify Admin ve Hipicon designer office çerezlerini kullanır.
          İkisinde de giriş yapıp tekrar kontrol edin.
        </p>

        <div className={`session-row ${sessions?.shopify.ok ? "ok" : "bad"}`}>
          <div>
            <strong>Shopify Admin</strong>
            <p className="muted">
              {checkingSessions
                ? "Kontrol ediliyor…"
                : sessions?.shopify.detail || "—"}
            </p>
          </div>
          {!sessions?.shopify.ok && (
            <button
              className="secondary"
              disabled={busy || checkingSessions}
              onClick={() =>
                void run(async () => {
                  await send({ type: "OPEN_LOGIN", site: "shopify" });
                }, "Shopify Admin açılıyor…")
              }
            >
              Giriş aç
            </button>
          )}
        </div>

        <div className={`session-row ${sessions?.hipicon.ok ? "ok" : "bad"}`}>
          <div>
            <strong>Hipicon</strong>
            <p className="muted">
              {checkingSessions
                ? "Kontrol ediliyor…"
                : sessions?.hipicon.detail || "—"}
            </p>
          </div>
          {!sessions?.hipicon.ok && (
            <button
              className="secondary"
              disabled={busy || checkingSessions}
              onClick={() =>
                void run(async () => {
                  await send({ type: "OPEN_LOGIN", site: "hipicon" });
                }, "Hipicon paneli açılıyor…")
              }
            >
              Giriş aç
            </button>
          )}
        </div>

        <div className="row">
          <button
            disabled={busy || checkingSessions}
            onClick={() =>
              void run(async () => {
                const result = await refreshSessions();
                setStatus({
                  tone: result.ready ? "ok" : "error",
                  text: result.ready
                    ? "Oturumlar hazır"
                    : "Eksik oturum var — giriş yapıp tekrar deneyin",
                });
              }, "Oturum kontrol ediliyor…")
            }
          >
            {checkingSessions ? "Kontrol ediliyor…" : "Tekrar kontrol et"}
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={onShowSettings}
          >
            Ayarlar
          </button>
        </div>

        {status && (
          <div className={`status ${status.tone === "error" ? "error" : ""}`}>
            {status.text}
          </div>
        )}

        {showSettings && (
          <div className="panel" style={{ marginTop: 8 }}>
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
                : "Kaynak yok — ‘Kuru çek’"}
            </p>
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
                    },
                  });
                  setSettings(next);
                  await refreshSessions();
                  setStatus({ tone: "ok", text: "Ayarlar kaydedildi" });
                }, "Ayarlar kaydediliyor…")
              }
            >
              Kaydet
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
