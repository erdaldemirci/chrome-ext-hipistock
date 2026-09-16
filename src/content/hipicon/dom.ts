import { HipiconSelectors } from "../../lib/hipicon-selectors";

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function textOf(el: Element): string {
  return (el.textContent || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("tr-TR");
}

export function hrefOf(el: Element): string {
  if (el instanceof HTMLAnchorElement) return (el.href || "").toLowerCase();
  const href = el.getAttribute("href");
  return href ? href.toLowerCase() : "";
}

export function mainRoot(): ParentNode {
  return document.querySelector(HipiconSelectors.mainRoot) ?? document;
}

export function isBlockedClickTarget(el: Element): boolean {
  const t = textOf(el);
  const href = hrefOf(el);
  if (
    href.endsWith(".pdf") ||
    href.includes(".pdf") ||
    href.includes("kargo-fiyat")
  ) {
    return true;
  }
  if (el.closest("aside, header, nav")) return true;
  if (
    HipiconSelectors.clickBlocklist.some(
      (b) => t.includes(b) || href.includes(b),
    )
  ) {
    return true;
  }
  return false;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
