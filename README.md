# Hipistock

**Shopify kataloğunuzu Hipicon satıcı panelinize aktaran Chrome eklentisi.**

Shopify Admin'deki ürünlerinizi tek panelden seçin, fiyat/stok ya da yeni ürün girişi olarak Hipicon'un beklediği Excel formatına dönüştürün ve Hipicon toplu yükleme ekranına otomatik yükleyin. Sunucu yok, hesap yok, dışarıya veri gitmiyor — her şey sizin tarayıcınızda çalışır.

[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6)](https://www.typescriptlang.org/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue)](LICENSE)

---

## Neden?

Hipicon'a ürün girişi elle yapıldığında her ürün için kategori seçmek, kategoriye özel Excel şablonunu indirmek, alanları doldurmak ve dosyayı yüklemek gerekir. Yüz kalemlik bir katalogda bu iş saatler alır ve hata yapmak kolaydır.

Hipistock bu döngünün tamamını otomatikleştirir: Shopify'dan gerçek stok ve fiyat verisini çeker, kategori kurallarınıza göre eşler, doğru şablonu Hipicon API'sinden indirip doldurur ve yükleme ekranına bırakır. Siz sadece neyi aktaracağınızı seçip onaylarsınız.

## Öne çıkanlar

- **İki aktarım modu** — mevcut ürünler için *fiyat/stok güncelleme*, yeni kalemler için *yeni ürün girişi*
- **Gerçek stok verisi** — Shopify Admin oturumu veya custom app token üzerinden envanter; ikisi de yoksa vitrin verisine düşer
- **Kategoriye özel şablon** — yeni ürün Excel'i, seçilen Hipicon kategorisi için Hipicon'dan canlı indirilir
- **Akıllı kategori eşleme** — Shopify `product_type` / başlık / etiket / handle üzerinden kural tabanlı eşleme, satır bazında override edilebilir
- **Otomatik kur** — TCMB önce, olmazsa yedek FX sağlayıcıları; USD fiyatlar TL'ye çevrilirken sonu **9**'a yuvarlanır
- **Manuel fiyat** — bir satıra elle TL girerseniz olduğu gibi kullanılır, yuvarlama uygulanmaz
- **Gemini ile çeviri (opsiyonel)** — ürün adı ve açıklamasını çekerken Türkçeleştirir; anahtar girmezseniz sessizce devre dışı kalır
- **Toplu taslak temizliği** — Hipicon'daki taslak ürünleri sayfa sayfa siler, istediğiniz an durdurabilirsiniz
- **Oturum kontrolü** — aktarımdan önce her iki panelde oturumunuzun açık olduğunu doğrular, değilse giriş sayfasını açar
- **Backend yok** — Manifest V3 eklentisi olarak bağımsız çalışır, hiçbir aracı sunucuya ihtiyaç duymaz

## Kurulum

### Hazır paketten (ekip dağıtımı)

1. `npm run pack` ile üretilen `release/hipistock-<sürüm>.zip` dosyasını açın
2. `chrome://extensions` adresine gidin ve **Geliştirici modu**'nu açın
3. **Paketlenmemiş öğe yükle** → zip'ten çıkan klasörü seçin
4. Araç çubuğundaki **Hipistock** simgesine tıklayın → yan panel açılır

### Kaynaktan

```bash
git clone https://github.com/erdaldemirci/chrome-ext-hipistock.git
cd chrome-ext-hipistock
npm install
npm run build     # typecheck + production build → dist/
```

Ardından `chrome://extensions` → **Paketlenmemiş öğe yükle** → `dist` klasörünü seçin.

## İlk yapılandırma

1. Tarayıcıda **Shopify Admin** ve **Hipicon satıcı panelinizi** açık bırakın — eklenti ilk açılışta mağaza URL'si ve Hipicon slug'ını bu sekmelerden otomatik algılar
2. Yan paneli açın; **oturum kontrolü** iki tarafın da hazır olduğunu doğrular
3. Gerekirse **Ayarlar** sekmesinden elle girin:

| Ayar | Açıklama |
|------|----------|
| Shopify mağaza URL | Örn. `https://magazam.myshopify.com` |
| Hipicon mağaza adı | Panel slug'ı, örn. `magazam` |
| Admin API token | Opsiyonel; `shpat_…` custom app token, `read_products` + `read_inventory` |
| USD/TRY kuru | Elle girilebilir veya tek tıkla TCMB'den çekilir |
| KDV oranı | Hipicon Excel'ine yazılacak oran (varsayılan %10) |
| Hipicon kategorisi | Varsayılan kategori + eşleme kuralları |
| Gemini API anahtarı | Opsiyonel; TR çeviri için |

## Kullanım akışı

```
Shopify'dan çek  →  satırları düzenle/seç  →  onay diyaloğu  →  Excel üret  →  Hipicon'a yükle
```

| İşlem | Ne yapar |
|-------|----------|
| **Shopify'dan çek** | Katalog + envanter verisini toplar (oturum, token veya vitrin kaynağından) |
| **Yeni ürün aktar** | Seçili satırlar → kategori şablonu Hipicon'dan indirilir → doldurulur → yüklenir |
| **Fiyat / stok aktar** | Seçili satırlar → fiyat/stok Excel'i → yüklenir |
| **Excel indir** | Yüklemeden önce üretilen dosyayı denetlemek için indirir |
| **Seçili olanları sil** | Yalnızca yerel listeden kaldırır — Hipicon'a dokunmaz |
| **Tüm taslakları sil** | Hipicon'daki taslak ürünleri toplu siler (durdurulabilir) |

Başarıyla aktarılan satırlar **Gönderilenler**'e taşınır; gerekirse geri alabilirsiniz.

## Fiyatlandırma mantığı

- **Otomatik kur:** `Shopify fiyatı × USD/TRY kuru` → sonu **9** olacak şekilde yuvarlanır
- **Manuel TL:** girdiğiniz değer aynen kullanılır, yuvarlama yapılmaz
- Kur kaynağı ve çekim zamanı ayarlarda saklanır, panelde gösterilir

## Gizlilik ve güvenlik

- **Veri toplanmaz.** Hipistock'un backend'i, analitiği, telemetrisi veya reklam SDK'sı yok
- **Shopify Admin token** yalnızca tarayıcı `storage`'ında tutulur, arayüzde maskeli gösterilir
- **Hipicon şifresi hiç saklanmaz** — mevcut cookie / `x-auth-token` oturumu kullanılır
- **Gemini anahtarı** yereldedir ve arayüze geri döndürülmez
- Her aktarım öncesi açık seçim ve onay diyaloğu vardır
- Tüm işleme tarayıcınızda gerçekleşir; ağ istekleri yalnızca Shopify, Hipicon ve kur sağlayıcılarına gider

Tam metin: [`store-assets/privacy-policy.md`](store-assets/privacy-policy.md)

### İzin gerekçeleri

| İzin | Neden gerekli |
|------|---------------|
| `storage` | Ayarlar ve geçici katalog önbelleği |
| `sidePanel` | Ana arayüz yan panelde çalışır |
| `tabs` | Açık Shopify/Hipicon sekmelerini bulmak ve oturum durumunu okumak |
| `scripting` | Hipicon toplu yükleme ve Shopify Admin sayfalarına içerik betiği enjekte etmek |
| `downloads` | Üretilen Excel dosyasını denetim için indirmek |
| Host izinleri | Shopify, Hipicon, TCMB/FX ve (opsiyonel) Gemini uç noktaları |

## Mimari

```
src/
├── background/     MV3 service worker — mesaj yönlendirme, senkronizasyon, oturum/envanter
├── sidepanel/      React 19 arayüz (Sync + Ayarlar sekmeleri, onay diyalogları)
├── popup/          Araç çubuğu popup'ı
├── content/
│   ├── hipicon/            kategori, şablon, yükleme, taslak silme, DOM prob
│   └── shopify-admin/      oturum, envanter kazıma, fetch köprüsü
└── lib/            Excel üretimi, kategori kuralları, kur, kripto, tipler, sabitler
```

Mesajlaşma tek bir ayrık birleşim tipi (`ExtensionMessage`) üzerinden yürür; arayüz ile service worker arasındaki her çağrı `{ ok: true, data }` / `{ ok: false, error }` sonucuna indirgenir.

## Geliştirme

```bash
npm run dev         # watch build → dist
npm run typecheck   # tsc (uygulama + build betikleri)
npm run build       # typecheck + production build
npm run pack        # build + release/hipistock-<sürüm>.zip
```

**Hipicon arayüzü değişirse:** seçicileri [`src/lib/hipicon-selectors.ts`](src/lib/hipicon-selectors.ts) dosyasından güncelleyin — DOM bağımlılıkları tek noktada toplanmıştır.

**Sürüm çıkarken:** `package.json` ve `public/manifest.json` sürümlerini birlikte güncelleyin; `pack` betiği zip adını manifest sürümünden üretir.

## Gereksinimler

- Chrome 116+
- Node.js 20+ (geliştirme için)
- Shopify Admin erişimi olan bir hesap
- Hipicon satıcı paneli hesabı

## Lisans

[GPL-3.0](LICENSE) © Erdal Demirci
