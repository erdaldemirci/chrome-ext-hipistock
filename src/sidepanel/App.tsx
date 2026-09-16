import { useCallback, useEffect, useMemo, useState } from "react";
import { BrandLogo } from "./BrandLogo";
import {
  applyLiveCategories,
  type HipiconCategory,
} from "../lib/hipicon-categories";
import type {
  AppSettings,
  CatalogCache,
  PushMode,
  SessionCheckResult,
} from "../lib/types";
import { DEFAULT_SETTINGS } from "../lib/types";
import { BusyOverlay } from "./BusyOverlay";
import { ConfirmDeleteDrafts } from "./ConfirmDeleteDrafts";
import { ConfirmPush } from "./ConfirmPush";
import { send } from "./messaging";
import { SessionGate } from "./SessionGate";
import { SettingsTab } from "./SettingsTab";
import { SyncTab } from "./SyncTab";
import "./styles.css";

type TabId = "sync" | "settings";

type CategoriesMeta = {
  categories: HipiconCategory[];
  bagCount: number;
  fetchedAt: string | null;
  source: "live" | "bundled";
};

export function App() {
  const [ready, setReady] = useState(false);
  const [sessions, setSessions] = useState<SessionCheckResult | null>(null);
  const [checkingSessions, setCheckingSessions] = useState(true);
  const [tab, setTab] = useState<TabId>("sync");
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [catalog, setCatalog] = useState<CatalogCache | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("İşlem sürüyor…");
  const [status, setStatus] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const [confirmPush, setConfirmPush] = useState<PushMode | null>(null);
  const [confirmDeleteDrafts, setConfirmDeleteDrafts] = useState(false);
  const [categoriesMeta, setCategoriesMeta] = useState<CategoriesMeta | null>(
    null,
  );
  const [categoriesEpoch, setCategoriesEpoch] = useState(0);

  function adoptCategories(data: CategoriesMeta) {
    applyLiveCategories(
      data.source === "live" ? data.categories : null,
    );
    setCategoriesMeta(data);
    setCategoriesEpoch((n) => n + 1);
  }

  const loadWorkspace = useCallback(async () => {
    const [nextSettings, nextCatalog, cats] = await Promise.all([
      send<AppSettings>({ type: "GET_SETTINGS" }),
      send<CatalogCache | null>({ type: "GET_CATALOG" }),
      send<CategoriesMeta>({ type: "GET_HIPICON_CATEGORIES" }),
    ]);
    setSettings(nextSettings);
    setCatalog(nextCatalog);
    adoptCategories(cats);

    const fetchedAt = nextSettings.usdTryRateFetchedAt;
    const stale =
      !fetchedAt ||
      Date.now() - Date.parse(fetchedAt) > 6 * 60 * 60 * 1000 ||
      !nextSettings.usdTryRateSource ||
      nextSettings.usdTryRateSource === "manuel";
    if (stale) {
      void send<{
        rate: number;
        source: string;
        fetchedAt: string;
        settings: AppSettings;
      }>({ type: "FETCH_USD_TRY_RATE" })
        .then((data) => setSettings(data.settings))
        .catch(() => {
          /* kayıtlı kurla devam */
        });
    }

    const catStale =
      cats.source !== "live" ||
      !cats.fetchedAt ||
      Date.now() - Date.parse(cats.fetchedAt) > 7 * 24 * 60 * 60 * 1000;
    if (catStale) {
      void send<CategoriesMeta>({
        type: "FETCH_HIPICON_CATEGORIES",
        force: cats.source !== "live",
      })
        .then((data) => adoptCategories(data))
        .catch(() => {
          /* bundled / cache ile devam */
        });
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    setCheckingSessions(true);
    try {
      const result = await send<SessionCheckResult>({ type: "CHECK_SESSIONS" });
      setSessions(result);
      if (result.settings) setSettings(result.settings);
      return result;
    } finally {
      setCheckingSessions(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await loadWorkspace();
        await refreshSessions();
      } catch (error) {
        setStatus({
          tone: "error",
          text: error instanceof Error ? error.message : "Başlatılamadı",
        });
      } finally {
        setReady(true);
      }
    })();
  }, [loadWorkspace, refreshSessions]);

  const sessionsReady = Boolean(sessions?.ready);

  const selectedCount = useMemo(
    () => catalog?.variants.filter((v) => v.selected).length ?? 0,
    [catalog],
  );

  const selectedVariants = useMemo(
    () => catalog?.variants.filter((v) => v.selected) ?? [],
    [catalog],
  );

  const selectedVariantIds = useMemo(
    () =>
      selectedVariants
        .map((v) => String(v.shopifyVariantId ?? "").trim())
        .filter(Boolean),
    [selectedVariants],
  );

  const previewRows = useMemo(
    () => selectedVariants.slice(0, 12),
    [selectedVariants],
  );

  const filtered = useMemo(() => {
    if (!catalog) return [];
    const q = query.trim().toLocaleLowerCase("tr-TR");
    if (!q) return catalog.variants;
    return catalog.variants.filter(
      (v) =>
        v.sku.toLocaleLowerCase("tr-TR").includes(q) ||
        v.name.toLocaleLowerCase("tr-TR").includes(q) ||
        (v.productType ?? "").toLocaleLowerCase("tr-TR").includes(q),
    );
  }, [catalog, query]);

  async function run(
    action: () => Promise<void>,
    label = "İşlem sürüyor…",
  ) {
    setBusy(true);
    setBusyLabel(label);
    setStatus(null);
    try {
      await action();
    } catch (error) {
      setStatus({
        tone: "error",
        text: error instanceof Error ? error.message : "İşlem başarısız",
      });
    } finally {
      setBusy(false);
    }
  }

  const showBusy = !ready || busy || checkingSessions;
  const overlayLabel = !ready
    ? "Panel hazırlanıyor…"
    : busy
      ? busyLabel
      : "Oturum kontrol ediliyor…";

  if (!ready) {
    return (
      <div className="app">
        <BusyOverlay active label={overlayLabel} />
      </div>
    );
  }

  if (!sessionsReady) {
    return (
      <>
        <BusyOverlay active={showBusy} label={overlayLabel} />
        <SessionGate
          sessions={sessions}
          checkingSessions={checkingSessions}
          busy={busy}
          settings={settings}
          setSettings={setSettings}
          status={status}
          setStatus={setStatus}
          showSettings={tab === "settings"}
          onShowSettings={() => setTab("settings")}
          refreshSessions={refreshSessions}
          run={run}
        />
      </>
    );
  }

  return (
    <div className="app">
      <BusyOverlay active={showBusy} label={overlayLabel} />
      <div className="brand">
        <div className="brand-bar">
          <div className="brand-title">
            <BrandLogo className="brand-logo" />
            <h1>Hipistock</h1>
          </div>
          {settings.usdTryRate > 0 && (
            <button
              type="button"
              className="fx-pill"
              disabled={busy}
              title={
                [
                  settings.usdTryRateSource,
                  settings.usdTryRateFetchedAt
                    ? new Date(settings.usdTryRateFetchedAt).toLocaleString(
                        "tr-TR",
                      )
                    : null,
                  "tıkla: kuru yenile",
                ]
                  .filter(Boolean)
                  .join(" · ")
              }
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
                    text: `Kur: ${data.rate} (${data.source})`,
                  });
                }, "Kur güncelleniyor…")
              }
            >
              <svg
                className="fx-pill-icon"
                viewBox="0 0 24 24"
                width="13"
                height="13"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 10h12a4 4 0 0 0 0-8H8" />
                <path d="M20 14H8a4 4 0 0 0 0 8h8" />
                <path d="M12 2v20" />
              </svg>
              <span>
                $1 → ₺
                {settings.usdTryRate.toLocaleString("tr-TR", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </button>
          )}
          <button
            type="button"
            className="ghost session-btn"
            disabled={busy || checkingSessions}
            onClick={() =>
              void run(async () => {
                const result = await refreshSessions();
                if (!result.ready) {
                  setStatus({
                    tone: "error",
                    text: "Oturum düşmüş — tekrar giriş gerekli",
                  });
                }
              }, "Oturum kontrol ediliyor…")
            }
          >
            <svg
              className="session-btn-icon"
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 11h-6" />
              <path d="m19 8 3 3-3 3" />
            </svg>
            Oturum
          </button>
        </div>
      </div>

      <div className="tabs">
        <button
          className={tab === "sync" ? "active" : ""}
          onClick={() => setTab("sync")}
        >
          Senkron
        </button>
        <button
          className={tab === "settings" ? "active" : ""}
          onClick={() => setTab("settings")}
        >
          Ayarlar
        </button>
      </div>

      {status && (
        <div className={`status ${status.tone === "error" ? "error" : ""}`}>
          {status.text}
        </div>
      )}

      {tab === "settings" ? (
        <SettingsTab
          settings={settings}
          setSettings={setSettings}
          busy={busy}
          setStatus={setStatus}
          refreshSessions={refreshSessions}
          run={run}
          categoriesMeta={categoriesMeta}
          categoriesEpoch={categoriesEpoch}
          onCategories={adoptCategories}
          onSaved={() => setTab("sync")}
        />
      ) : (
        <SyncTab
          catalog={catalog}
          setCatalog={setCatalog}
          settings={settings}
          query={query}
          setQuery={setQuery}
          filtered={filtered}
          selectedCount={selectedCount}
          busy={busy}
          setStatus={setStatus}
          setConfirmPush={setConfirmPush}
          setConfirmDeleteDrafts={setConfirmDeleteDrafts}
          loadWorkspace={loadWorkspace}
          run={run}
          categoriesEpoch={categoriesEpoch}
        />
      )}

      {confirmPush && (
        <ConfirmPush
          mode={confirmPush}
          selectedCount={selectedCount}
          selectedVariantIds={selectedVariantIds}
          previewRows={previewRows}
          settings={settings}
          busy={busy}
          setConfirmPush={setConfirmPush}
          setStatus={setStatus}
          setCatalog={setCatalog}
          run={run}
        />
      )}

      {confirmDeleteDrafts && (
        <ConfirmDeleteDrafts
          storeName={settings.storeName}
          busy={busy}
          setConfirmDeleteDrafts={setConfirmDeleteDrafts}
          setStatus={setStatus}
          run={run}
        />
      )}
    </div>
  );
}
