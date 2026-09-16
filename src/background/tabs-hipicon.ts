import { hipiconBulkUrl, hipiconDraftsUrl } from "../lib/constants";
import type { ExtensionMessage } from "../lib/types";
import { sendToTab } from "./tabs-shopify";

export async function findHipiconTab(
  bulkUrl: string,
): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({});
  const host = (() => {
    try {
      return new URL(bulkUrl).hostname;
    } catch {
      return "hipicon.com";
    }
  })();

  const match = tabs.find((tab) => {
    if (!tab.url) return false;
    try {
      return new URL(tab.url).hostname === host;
    } catch {
      return false;
    }
  });
  return match ?? null;
}

function isHipiconBulkProductsUrl(url: string): boolean {
  return /hipicon\.com/i.test(url) && /\/products\/bulk/i.test(url);
}

function isHipiconExcelBulkUrl(url: string): boolean {
  return (
    isHipiconBulkProductsUrl(url) && !/[?&]type=drafts(?:&|$)/i.test(url)
  );
}

export async function waitForHipiconTab(
  tabId: number,
  attempts = 50,
): Promise<chrome.tabs.Tab> {
  for (let i = 0; i < attempts; i += 1) {
    const tab = await chrome.tabs.get(tabId);
    if (
      tab.url &&
      isHipiconBulkProductsUrl(tab.url) &&
      tab.status === "complete"
    ) {
      // Content script document_idle — kısa ek bekleme
      await new Promise((r) => setTimeout(r, 400));
      return tab;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return chrome.tabs.get(tabId);
}

export async function ensureHipiconBulkTab(
  storeName: string,
): Promise<chrome.tabs.Tab> {
  const bulkUrl = hipiconBulkUrl(storeName);
  const existing = await findHipiconTab(bulkUrl);
  if (existing?.id) {
    if (existing.url && isHipiconExcelBulkUrl(existing.url)) {
      await chrome.tabs.update(existing.id, { active: true });
      const tab = await chrome.tabs.get(existing.id);
      if (tab.status === "complete") {
        await new Promise((r) => setTimeout(r, 300));
        return tab;
      }
      return waitForHipiconTab(existing.id);
    }
    await chrome.tabs.update(existing.id, { active: true, url: bulkUrl });
    return waitForHipiconTab(existing.id);
  }
  const created = await chrome.tabs.create({ url: bulkUrl, active: true });
  if (!created.id) throw new Error("Hipicon sekmesi açılamadı");
  return waitForHipiconTab(created.id);
}

/** Kategori API için: mevcut Hipicon sekmesi yeter; yoksa bulk açılır. */
export async function ensureHipiconSessionTab(
  storeName: string,
): Promise<chrome.tabs.Tab> {
  const bulkUrl = hipiconBulkUrl(storeName);
  const existing = await findHipiconTab(bulkUrl);
  if (existing?.id) {
    if (existing.url && /hipicon\.com/i.test(existing.url)) {
      await chrome.tabs.update(existing.id, { active: true });
      if (existing.status === "complete") {
        await new Promise((r) => setTimeout(r, 300));
        return existing;
      }
      return waitForHipiconTab(existing.id);
    }
  }
  const created = await chrome.tabs.create({ url: bulkUrl, active: true });
  if (!created.id) throw new Error("Hipicon sekmesi açılamadı");
  return waitForHipiconTab(created.id);
}

export async function ensureHipiconDraftsTab(
  storeName: string,
  opts?: { forceReload?: boolean },
): Promise<chrome.tabs.Tab> {
  const draftsUrl = hipiconDraftsUrl(storeName);
  const existing = await findHipiconTab(draftsUrl);
  if (existing?.id) {
    const alreadyDrafts =
      existing.url &&
      /\/products\/bulk/i.test(existing.url) &&
      /type=drafts/i.test(existing.url);
    if (alreadyDrafts && !opts?.forceReload) {
      await chrome.tabs.update(existing.id, { active: true });
      return existing;
    }
    await chrome.tabs.update(existing.id, {
      active: true,
      url: draftsUrl,
    });
    return waitForHipiconTab(existing.id);
  }
  const created = await chrome.tabs.create({ url: draftsUrl, active: true });
  if (!created.id) throw new Error("Hipicon taslak sekmesi açılamadı");
  return waitForHipiconTab(created.id);
}

export async function sendToHipiconTab<T>(
  tabId: number,
  message: ExtensionMessage,
): Promise<T> {
  return sendToTab<T>(tabId, "content/hipicon.js", message);
}
