import { send } from "./messaging";

type Status = { tone: "ok" | "error"; text: string } | null;

type Props = {
  storeName: string;
  busy: boolean;
  setConfirmDeleteDrafts: (v: boolean) => void;
  setStatus: (s: Status) => void;
  run: (action: () => Promise<void>, label?: string) => Promise<void>;
};

export function ConfirmDeleteDrafts({
  storeName,
  busy,
  setConfirmDeleteDrafts,
  setStatus,
  run,
}: Props) {
  return (
    <div
      className="confirm-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-delete-drafts-title"
    >
      <div className="panel confirm-panel">
        <h2 id="confirm-delete-drafts-title">
          {busy ? "Taslaklar siliniyor…" : "Hipicon'daki tüm taslakları sil?"}
        </h2>
        <p className="muted">
          {busy
            ? "Hipicon’da satır satır siliniyor. İstediğiniz anda durdurabilirsiniz; o ana kadar silinenler geri gelmez."
            : `Hipicon Taslaklar listesindeki ürünler sayfa sayfa seçilip silinir (${
                storeName.trim() || "magaza-adi"
              }.hipicon.com/products/bulk?type=drafts). Bu işlem geri alınamaz.`}
        </p>
        <div className="row">
          {!busy ? (
            <>
              <button
                className="danger"
                onClick={() =>
                  void run(async () => {
                    const result = await send<{
                      ok: boolean;
                      message: string;
                      count: number;
                      stopped?: boolean;
                    }>({ type: "DELETE_HIPICON_DRAFTS" });
                    setConfirmDeleteDrafts(false);
                    setStatus({
                      tone: result.ok ? "ok" : "error",
                      text: result.message,
                    });
                  }, "Hipicon taslakları siliniyor…")
                }
              >
                Evet, tümünü sil
              </button>
              <button
                className="secondary"
                onClick={() => setConfirmDeleteDrafts(false)}
              >
                Vazgeç
              </button>
            </>
          ) : (
            <button
              className="danger"
              onClick={() => {
                void send({ type: "STOP_DELETE_HIPICON_DRAFTS" }).catch(() => {
                  /* background yoksa yoksay */
                });
              }}
            >
              Durdur
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
