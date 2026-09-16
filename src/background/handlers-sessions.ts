import { checkBothSessions } from "../lib/sessions";
import { getSettings } from "../lib/storage";

export async function requireSessionsReady() {
  const settings = await getSettings();
  const sessions = await checkBothSessions({
    shopifyStoreUrl: settings.shopifyStoreUrl,
    storeName: settings.storeName,
  });
  if (!sessions.ready) {
    const missing = [
      !sessions.shopify.ok ? "Shopify Admin" : null,
      !sessions.hipicon.ok ? "Hipicon" : null,
    ]
      .filter(Boolean)
      .join(" + ");
    throw new Error(`Önce oturum açın: ${missing}`);
  }
  return sessions;
}

export function inventorySourceLabel(
  source: "session" | "token" | "public" | undefined,
): string {
  switch (source) {
    case "session":
      return "Admin oturum stok";
    case "token":
      return "API token stok";
    case "public":
      return "public stok";
    case undefined:
      return "public stok";
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}
