/** Hipicon seller panel — /products/bulk Excel işlemleri DOM. */
export const HipiconSelectors = {
  /** Ana içerik; sidebar (kargo PDF vb.) hariç */
  mainRoot: "main",
  fileInputs: [
    'main input[type="file"]',
    'input[type="file"][data-slot="input"]',
    'input[type="file"]',
  ],
  /** Drop zone kartı metni (Hipicon: “Doldurduğunuz şablonu buraya…”) */
  dropZoneNeedles: [
    "doldurduğunuz şablonu",
    "şablonu buraya",
    "sürükleyin",
    "tıklayıp seçin",
    "doldurduğunuz dosyayı",
  ],
  uploadButtons: [
    "main button",
    "main [role='button']",
    'main input[type="submit"]',
  ],
  loginHints: ["giriş", "login", "şifre", "password", "sign in"],
  /** Yükleme sonrası onay — dar tut */
  priceStockButtonNeedles: [
    "işlemi başlat",
    "yüklemeyi başlat",
    "dosyayı yükle",
    "excel yükle",
    "yükle ve işle",
    "yükle",
    "upload",
  ],
  /**
   * PRODUCT_BULK_EDIT sonrası önizleme onayı:
   * "{{count}} ürünü güncelle" / "Update {{count}} product(s)"
   */
  priceStockConfirmNeedles: [
    "ürünü güncelle",
    "ürünleri güncelle",
    "update",
    "product(s)",
  ],
  productEntryButtonNeedles: [
    "işlemi başlat",
    "yüklemeyi başlat",
    "dosyayı yükle",
    "ürün yükle",
    "yükle",
    "upload",
  ],
  clickBlocklist: [
    "kargo",
    "fiyat listesi",
    "şablonu indir",
    "indirmek istediğiniz",
    "pdf",
    "çıkış",
    "logout",
    "destek",
    "rehber",
    "sipariş",
    "bildirim",
    "toggle theme",
  ],
  hintKeywords: [
    "excel",
    "şablon",
    "sürükleyin",
    "yükle",
    "toplu ürün",
  ],
  /** Taslaklar sekmesi / toplu silme */
  draftsTabNeedles: ["taslak"],
  /** Üst araç çubuğu — seçili satırlar için toplu işlem */
  manageMenuNeedles: ["yönet", "manage"],
  selectionMenuNeedles: ["kayıt seçildi", "seçildi"],
  deleteMenuNeedles: [
    "ürünü sil",
    "seçilenleri sil",
    "seçilileri sil",
    "taslakları sil",
    "tümünü sil",
    "sil",
    "delete",
    "kaldır",
  ],
  deleteMenuBlocklist: [
    "indir",
    "download",
    "seçimi kaldır",
    "seçimi temizle",
    "tümünü seç",
    "sayfadaki",
    "düzenle",
    "edit",
    "kopyala",
    "yayınla",
  ],
  confirmDeleteNeedles: ["onayla", "sil", "evet", "devam", "delete", "kaldır"],
  confirmCancelNeedles: ["vazgeç", "iptal", "hayır", "cancel"],
} as const;
