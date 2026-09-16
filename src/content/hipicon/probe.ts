import { HipiconSelectors } from "../../lib/hipicon-selectors";
import { mainRoot, textOf } from "./dom";

export function guessLoggedIn(): boolean | null {
  const body = document.body?.innerText?.toLocaleLowerCase("tr-TR") ?? "";
  if (!body) return null;
  const hasLoginForm =
    document.querySelector('input[type="password"]') != null &&
    HipiconSelectors.loginHints.some((h) => body.includes(h));
  if (hasLoginForm) return false;
  if (
    body.includes("toplu ürün") ||
    body.includes("ürünler") ||
    body.includes("sipariş") ||
    body.includes("dashboard") ||
    body.includes("panel")
  ) {
    return true;
  }
  return null;
}

export function collectHints(): string[] {
  const hints: string[] = [];
  const candidates = Array.from(
    mainRoot().querySelectorAll(
      "a, button, [role='button'], label, h1, h2, h3, span",
    ),
  );
  for (const el of candidates) {
    const t = textOf(el);
    if (!t || t.length > 120) continue;
    if (HipiconSelectors.hintKeywords.some((k) => t.includes(k))) {
      hints.push(t.slice(0, 80));
      if (hints.length >= 12) break;
    }
  }
  return hints;
}

export function findFileInput(): HTMLInputElement | null {
  for (const sel of HipiconSelectors.fileInputs) {
    const nodes = Array.from(
      document.querySelectorAll<HTMLInputElement>(sel),
    );
    const preferred =
      nodes.find((n) => !n.disabled && n.closest("main")) ??
      nodes.find((n) => !n.disabled) ??
      nodes[0];
    if (preferred) return preferred;
  }
  return null;
}

export function findDropZone(): HTMLElement | null {
  const root = mainRoot();
  const cards = Array.from(
    root.querySelectorAll<HTMLElement>(
      '[data-slot="card"], [class*="border-dashed"], div',
    ),
  );
  for (const el of cards) {
    const t = textOf(el);
    if (
      HipiconSelectors.dropZoneNeedles.some((n) => t.includes(n)) &&
      el.querySelector('input[type="file"]')
    ) {
      return el;
    }
  }
  return null;
}

export function ensureExcelTab(): void {
  const root = mainRoot();
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>("button"));
  const excel = tabs.find((b) => {
    const v = (b.getAttribute("value") || "").toLowerCase();
    const t = textOf(b);
    return v === "excel" || t.includes("excel işlem");
  });
  if (excel && !excel.className.includes("border-primary")) {
    excel.click();
  }
}

export function probe() {
  ensureExcelTab();
  return {
    loggedIn: guessLoggedIn(),
    url: location.href,
    foundFileInput: Boolean(findFileInput()),
    foundDropZone: Boolean(findDropZone()),
    hints: collectHints(),
  };
}
