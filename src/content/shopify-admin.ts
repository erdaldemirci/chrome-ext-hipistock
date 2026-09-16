import type { ExtensionMessage } from "../lib/types";
import type { AdminInventoryResult } from "../lib/admin-inventory-types";
import { fetchAllInventory } from "./shopify-admin/fetch";
import { storeHandleFromLocation } from "./shopify-admin/session";

function emptyPayload(
  message: string,
  storeHandle: string | null = null,
): AdminInventoryResult {
  return {
    ok: false,
    message,
    byVariantId: {},
    bySku: {},
    storeHandle,
    count: 0,
    method: "none",
  };
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    void (async () => {
      switch (message.type) {
        case "FETCH_ADMIN_INVENTORY": {
          const storeHandle = storeHandleFromLocation();
          if (!storeHandle) {
            sendResponse(
              emptyPayload(
                "admin.shopify.com/store/... sayfasında olun (ör. /store/6153ea-2)",
              ),
            );
            return;
          }
          try {
            sendResponse(await fetchAllInventory(storeHandle));
          } catch (error) {
            sendResponse(
              emptyPayload(
                error instanceof Error
                  ? error.message
                  : "Admin stok çekimi başarısız",
                storeHandle,
              ),
            );
          }
          return;
        }
        case "GET_SETTINGS":
        case "SAVE_SETTINGS":
        case "CHECK_SESSIONS":
        case "OPEN_LOGIN":
        case "SYNC_SHOPIFY":
        case "GET_CATALOG":
        case "CLEAR_CATALOG":
        case "SET_SELECTION":
        case "SELECT_ALL":
        case "UPDATE_VARIANT":
        case "BULK_UPDATE_SELECTED":
        case "REMOVE_SELECTED":
        case "UNMARK_PUSHED":
        case "PUSH_HIPICON":
        case "DOWNLOAD_EXCEL":
        case "PROBE_HIPICON":
        case "DELETE_HIPICON_DRAFTS":
        case "STOP_DELETE_HIPICON_DRAFTS":
        case "HIPICON_DELETE_DRAFTS_PAGE":
        case "HIPICON_ABORT_DELETE_DRAFTS":
        case "FETCH_USD_TRY_RATE":
        case "GET_HIPICON_CATEGORIES":
        case "FETCH_HIPICON_CATEGORIES":
        case "HIPICON_FETCH_CATEGORIES":
        case "HIPICON_FETCH_PRODUCT_TEMPLATE":
        case "HIPICON_FETCH_PRICE_STOCK_TEMPLATE":
        case "HIPICON_FETCH_CATEGORIES_RESULT":
        case "HIPICON_STATUS":
        case "HIPICON_UPLOAD":
        case "HIPICON_UPLOAD_RESULT":
        case "ADMIN_INVENTORY_RESULT":
          sendResponse(
            emptyPayload("Bu mesaj Shopify Admin content için değil"),
          );
          return;
        default: {
          const _exhaustive: never = message;
          void _exhaustive;
          sendResponse(emptyPayload("Desteklenmeyen mesaj"));
        }
      }
    })();
    return true;
  },
);
