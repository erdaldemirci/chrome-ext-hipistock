import { HipiconSelectors } from "../../lib/hipicon-selectors";
import { mainRoot, sleep, textOf } from "./dom";
import { guessLoggedIn } from "./probe";

let abortDeleteDrafts = false;

export function setHipiconDeleteDraftsAbort(active: boolean) {
  abortDeleteDrafts = active;
}

export function isHipiconDeleteDraftsAborted() {
  return abortDeleteDrafts;
}

/** Radix/shadcn — body pointer-events:none olsa da dialog action tıklanır. */
function forceClick(el: HTMLElement) {
  try {
    el.focus({ preventScroll: true });
  } catch {
    /* ignore */
  }
  // Native click (portal + pointer-events:auto üzerinde en güvenilir)
  el.click();
  const opts: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    buttons: 1,
  };
  el.dispatchEvent(new PointerEvent("pointerdown", opts));
  el.dispatchEvent(new MouseEvent("mousedown", opts));
  el.dispatchEvent(new PointerEvent("pointerup", opts));
  el.dispatchEvent(new MouseEvent("mouseup", opts));
  el.dispatchEvent(new MouseEvent("click", opts));
}

function ensureDraftsTab(): void {
  const root = mainRoot();
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>("button"));
  const drafts = tabs.find((b) => {
    const v = (b.getAttribute("value") || "").toLowerCase();
    const t = textOf(b);
    return (
      v === "drafts" ||
      HipiconSelectors.draftsTabNeedles.some((n) => t.includes(n))
    );
  });
  if (drafts && !drafts.className.includes("border-primary")) {
    forceClick(drafts);
  }
}

function draftRows(): HTMLElement[] {
  const root = mainRoot();
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'tbody[data-slot="table-body"] tr, table tbody tr',
    ),
  ).filter((row) => Boolean(rowManageButton(row)));
}

function countDraftRows(): number {
  return draftRows().length;
}

function rowManageButton(row: HTMLElement): HTMLElement | null {
  const triggers = Array.from(
    row.querySelectorAll<HTMLElement>(
      'button[data-slot="dropdown-menu-trigger"]',
    ),
  );
  return (
    triggers.find((b) => {
      const t = textOf(b).replace(/\s+/g, " ").trim();
      return t === "yönet" || t.startsWith("yönet");
    }) ?? null
  );
}

function findOpenMenuItems(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="menuitem"], [data-slot="dropdown-menu-item"], [role="option"]',
    ),
  ).filter((el) => {
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

function pickDeleteMenuItem(): HTMLElement | null {
  const items = findOpenMenuItems();
  const scored = items
    .map((el) => {
      const t = textOf(el);
      if (HipiconSelectors.deleteMenuBlocklist.some((b) => t.includes(b))) {
        return { el, score: -1 };
      }
      if (t === "sil" || t === "ürünü sil" || t.startsWith("sil ")) {
        return { el, score: 200 };
      }
      const idx = HipiconSelectors.deleteMenuNeedles.findIndex((n) =>
        t.includes(n),
      );
      return { el, score: idx === -1 ? -1 : 100 - idx };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.el ?? null;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  stepMs = 80,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await sleep(stepMs);
  }
  return predicate();
}

function findOpenDeleteDialog(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(
      '[data-slot="alert-dialog-content"][data-state="open"]',
    ) ??
    document.querySelector<HTMLElement>('[role="alertdialog"]')
  );
}

function findOnaylaButton(): HTMLElement | null {
  const dialog = findOpenDeleteDialog();
  if (!dialog) return null;

  const bySlot = dialog.querySelector<HTMLElement>(
    'button[data-slot="alert-dialog-action"]',
  );
  if (bySlot) return bySlot;

  return (
    Array.from(dialog.querySelectorAll<HTMLElement>("button")).find((b) => {
      const t = textOf(b);
      if (b.getAttribute("data-slot") === "alert-dialog-cancel") return false;
      if (HipiconSelectors.confirmCancelNeedles.some((c) => t.includes(c))) {
        return false;
      }
      return t === "onayla" || t.startsWith("onayla");
    }) ?? null
  );
}

/** Açık “Ürünü Sil” diyaloğunda Onayla’ya bas. */
async function confirmDeleteDialog(): Promise<boolean> {
  const action = findOnaylaButton();
  if (!action) return false;

  // body pointer-events:none iken dialog action pointer-events:auto
  forceClick(action);
  await sleep(100);
  if (findOpenDeleteDialog()) {
    forceClick(action);
  }

  return waitFor(() => !findOpenDeleteDialog(), 8000);
}

async function dismissOrConfirmStaleDialog(): Promise<void> {
  if (!findOpenDeleteDialog()) return;
  // Yarım kalmış silme — vazgeçme, Onayla
  const ok = await confirmDeleteDialog();
  if (!ok && findOpenDeleteDialog()) {
    const cancel = findOpenDeleteDialog()?.querySelector<HTMLElement>(
      'button[data-slot="alert-dialog-cancel"]',
    );
    if (cancel) {
      forceClick(cancel);
      await waitFor(() => !findOpenDeleteDialog(), 3000);
    }
  }
}

async function deleteOneDraftViaYonet(): Promise<{
  ok: boolean;
  message: string;
}> {
  // Önceki turda açık kalan diyalog varsa önce Onayla
  await dismissOrConfirmStaleDialog();

  const rows = draftRows();
  if (rows.length === 0) {
    return { ok: true, message: "satır yok" };
  }

  const manage = rowManageButton(rows[0]);
  if (!manage) {
    return { ok: false, message: "Satırda “Yönet” butonu bulunamadı" };
  }

  if (manage.getAttribute("data-state") === "open") {
    forceClick(manage);
    await sleep(150);
  }

  forceClick(manage);
  let menuReady = await waitFor(() => findOpenMenuItems().length > 0, 2500);
  if (!menuReady) {
    forceClick(manage);
    menuReady = await waitFor(() => findOpenMenuItems().length > 0, 2500);
  }
  if (!menuReady) {
    return { ok: false, message: "Yönet menüsü açılmadı" };
  }

  const deleteItem = pickDeleteMenuItem();
  if (!deleteItem) {
    return { ok: false, message: "Yönet menüsünde Sil bulunamadı" };
  }

  forceClick(deleteItem);
  const dialogReady = await waitFor(
    () => Boolean(findOpenDeleteDialog()),
    4000,
  );
  if (!dialogReady) {
    return { ok: false, message: "“Ürünü Sil” onay diyaloğu açılmadı" };
  }

  const confirmed = await confirmDeleteDialog();
  if (!confirmed) {
    return {
      ok: false,
      message: "Onayla tıklanamadı (alert-dialog-action)",
    };
  }

  await sleep(250);
  return { ok: true, message: "silindi" };
}

/**
 * Hipicon taslak silme: Yönet → Sil → Onayla (satır satır).
 */
export async function deleteDraftsPage(): Promise<{
  ok: boolean;
  message: string;
  deletedCount: number;
  empty: boolean;
  aborted?: boolean;
}> {
  const loggedIn = guessLoggedIn();
  if (loggedIn === false) {
    return {
      ok: false,
      message: "Hipicon oturumu yok — satıcı paneline giriş yapın",
      deletedCount: 0,
      empty: false,
    };
  }

  ensureDraftsTab();
  // SPA / tablo ilk yüklemede gecikir — satır gelene kadar bekle
  const readyCount = await waitFor(
    () => countDraftRows() > 0,
    14000,
    250,
  );
  if (!readyCount) {
    // Tablo hiç gelmediyse bir kez daha taslak sekmesine bas
    ensureDraftsTab();
    await waitFor(() => countDraftRows() > 0, 6000, 250);
  }

  // Sayfa açılışında yarım diyalog varsa bitir
  await dismissOrConfirmStaleDialog();

  if (countDraftRows() === 0) {
    return {
      ok: true,
      message: "Silinecek taslak yok",
      deletedCount: 0,
      empty: true,
    };
  }

  let deleted = 0;
  const maxPerCall = 15;
  let lastError = "";

  for (let i = 0; i < maxPerCall; i += 1) {
    if (isHipiconDeleteDraftsAborted()) {
      return {
        ok: true,
        message: `Durduruldu — ${deleted} taslak silindi (bu sayfa)`,
        deletedCount: deleted,
        empty: countDraftRows() === 0,
        aborted: true,
      };
    }

    if (countDraftRows() === 0) break;

    const before = countDraftRows();
    const result = await deleteOneDraftViaYonet();
    if (!result.ok) {
      lastError = result.message;
      break;
    }

    const dropped = await waitFor(() => countDraftRows() < before, 5000);
    if (dropped) {
      deleted += 1;
    } else {
      deleted += 1;
      await sleep(400);
      if (countDraftRows() >= before && deleted >= 3) {
        lastError = "Silme sonrası satır sayısı azalmadı";
        break;
      }
    }
  }

  const empty = countDraftRows() === 0;
  if (deleted === 0 && lastError) {
    return {
      ok: false,
      message: lastError,
      deletedCount: 0,
      empty: false,
    };
  }

  return {
    ok: true,
    message: empty
      ? `${deleted} taslak silindi (Yönet → Sil → Onayla)`
      : `${deleted} taslak silindi; devam ediliyor${lastError ? ` — ${lastError}` : ""}`,
    deletedCount: deleted,
    empty,
  };
}
