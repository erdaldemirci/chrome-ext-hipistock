import type { ExtensionMessage } from "../lib/types";
import { fetchHipiconCategoryList } from "./hipicon/categories";
import { deleteDraftsPage, setHipiconDeleteDraftsAbort } from "./hipicon/drafts";
import {
  collectHints,
  ensureExcelTab,
  findDropZone,
  findFileInput,
  guessLoggedIn,
  probe,
} from "./hipicon/probe";
import {
  fetchHipiconPriceStockTemplate,
  fetchHipiconProductEntryTemplate,
} from "./hipicon/templates";
import {
  clickLikelyUploadButton,
  confirmPriceStockPreview,
  hipiconPriceStockCatalogHint,
  injectFile,
} from "./hipicon/upload";

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    void (async () => {
      switch (message.type) {
        case "PROBE_HIPICON":
          sendResponse(probe());
          return;
        case "HIPICON_FETCH_CATEGORIES": {
          const categories = await fetchHipiconCategoryList();
          sendResponse({ ok: true, categories });
          return;
        }
        case "HIPICON_FETCH_PRODUCT_TEMPLATE": {
          const result = await fetchHipiconProductEntryTemplate(
            message.categoryId,
          );
          sendResponse({ ok: true, ...result });
          return;
        }
        case "HIPICON_FETCH_PRICE_STOCK_TEMPLATE": {
          const result = await fetchHipiconPriceStockTemplate();
          sendResponse({ ok: true, ...result });
          return;
        }
        case "HIPICON_UPLOAD": {
          const loggedIn = guessLoggedIn();
          if (loggedIn === false) {
            sendResponse({
              ok: false,
              message: "Hipicon oturumu yok — satıcı paneline giriş yapın",
            });
            return;
          }

          ensureExcelTab();
          await new Promise((r) => setTimeout(r, 400));

          let input = findFileInput();
          if (!input) {
            const zone = findDropZone();
            zone?.click();
            await new Promise((r) => setTimeout(r, 300));
            input = findFileInput();
          }

          if (!input) {
            const hints = collectHints();
            sendResponse({
              ok: false,
              message:
                "Excel yükleme alanı bulunamadı (Toplu Ürün İşlemleri → Excel işlemleri). " +
                (hints.length
                  ? `İpuçları: ${hints.slice(0, 4).join(" · ")}`
                  : ""),
            });
            return;
          }

          if (message.mode === "price_stock") {
            const emptyHint = hipiconPriceStockCatalogHint();
            if (emptyHint) {
              // Yine de yüklemeyi dene (filtre UI’de dar olabilir); uyarıyı sonuca ekle
              console.warn("[hipistock]", emptyHint);
            }
          }

          await injectFile(input, message.fileName, message.bytesBase64);

          // Dropzone onChange ile import zaten başlar; product_entry için ekstra tık yeter.
          await new Promise((r) => setTimeout(r, 500));
          clickLikelyUploadButton(message.mode);

          if (message.mode === "price_stock") {
            // PRODUCT_BULK_EDIT: PREVIEW_READY → “N ürünü güncelle”
            const confirmed = await confirmPriceStockPreview();
            const emptyHint = hipiconPriceStockCatalogHint();
            if (!confirmed.ok && emptyHint) {
              sendResponse({
                ok: false,
                message: `${confirmed.message} · ${emptyHint}`,
              });
              return;
            }
            sendResponse(confirmed);
            return;
          }

          sendResponse({
            ok: true,
            message:
              "Excel enjekte edildi — panelde işlemin başladığını / taslakları kontrol edin",
          });
          return;
        }
        case "HIPICON_DELETE_DRAFTS_PAGE":
          sendResponse(await deleteDraftsPage());
          return;
        case "HIPICON_ABORT_DELETE_DRAFTS":
          setHipiconDeleteDraftsAbort(message.active);
          sendResponse({ ok: true });
          return;
        case "STOP_DELETE_HIPICON_DRAFTS":
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
        case "DELETE_HIPICON_DRAFTS":
        case "FETCH_USD_TRY_RATE":
        case "GET_HIPICON_CATEGORIES":
        case "FETCH_HIPICON_CATEGORIES":
        case "FETCH_ADMIN_INVENTORY":
        case "HIPICON_STATUS":
        case "HIPICON_UPLOAD_RESULT":
        case "HIPICON_FETCH_CATEGORIES_RESULT":
        case "ADMIN_INVENTORY_RESULT":
          sendResponse({
            ok: false,
            message: "Bu mesaj Hipicon content için değil",
          });
          return;
        default: {
          const _exhaustive: never = message;
          void _exhaustive;
          sendResponse({ ok: false, message: "Desteklenmeyen mesaj" });
        }
      }
    })().catch((error: unknown) => {
      sendResponse({
        ok: false,
        message: error instanceof Error ? error.message : "Content script hata",
      });
    });
    return true;
  },
);
