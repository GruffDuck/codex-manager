# Codex Manager

ChatGPT / Codex hesaplarını tek yerden yöneten, kota takibi yapan ve Codex CLI'ın önüne
şeffaf bir **Responses API gateway'i** koyan masaüstü uygulaması.

Aynı mimari desen: **ayrı bir core süreci** (Fastify + SQLite) + **yerel API gateway** +
**ince bir masaüstü kabuk** (Electron). Core tek başına da çalışır; UI olmadan da
`curl` ile kullanılabilir.

```
┌────────────────────┐   /v1/responses    ┌──────────────────────────┐
│  Codex CLI / IDE   │ ─────────────────▶ │  Codex Manager core      │
│  (Bearer sk-…)     │ ◀───────────────── │  :8055  Fastify gateway  │
└────────────────────┘   SSE / JSON       │  ├─ hesap seçimi (lease) │
                                          │  ├─ token yenileme       │
┌────────────────────┐      /api/*        │  ├─ kota takibi          │
│  UI (React/Vite)   │ ─────────────────▶ │  └─ SQLite (node:sqlite) │
└────────────────────┘                    └───────────┬──────────────┘
                                                      │ Bearer + chatgpt-account-id
                                          ┌───────────▼──────────────┐
                                          │ chatgpt.com/backend-api  │
                                          └──────────────────────────┘
```

## Neler yapar

- **Çoklu hesap**: ChatGPT OAuth ile ekleme (Codex CLI ile aynı `client_id`, aynı
  `localhost:1455/auth/callback`, PKCE), mevcut `~/.codex/auth.json`'ı içe aktarma veya
  token paketini yapıştırma.
- **Kota görünürlüğü**: 5 saatlik ve haftalık pencereler, `used_percent`, sıfırlanma
  zamanı, plan tipi, kredi bilgisi. Kaynak: `GET /backend-api/wham/usage` ve her
  yanıtta gelen `x-codex-*` başlıkları.
- **Kota ağırlıklı rotasyon**: boş kotası olan hesap daha çok trafik alır (smooth
  weighted round-robin). 429'da hesap işaretlenir, cooldown bitince geri döner.
- **Şeffaf vekil**: gövde aynen iletilir; yalnızca `authorization` ve
  `chatgpt-account-id` değiştirilir. SSE akışı olduğu gibi aktarılır.
- **Token yenileme**: JWT süresi dolmak üzereyse veya upstream 401 dönerse refresh
  token ile bir kez yenilenir, sonuç şifreli olarak saklanır.
- **CLI senkronizasyonu**: `Use in CLI` hesabı `~/.codex/auth.json`'a atomik yazar
  (önce `.codex-manager.bak` yedeği alınır).
- **`config.toml` yazıcı**: `[model_providers.codex_manager]` bloğunu ekler, mevcut
  kök `model` değerini korur, yedeği alır ve tek tuşla geri alır.
- **Trafik günlüğü**: son 500 istek; hangi hesap, hangi model, durum kodu, gecikme.

## Gereksinimler

- **Node.js ≥ 23.4** (yerleşik `node:sqlite` için; Node 24 önerilir)
- npm 10+
- macOS / Linux / Windows

## Kurulum ve çalıştırma

```bash
cd codex-manager
npm install
npm run dev          # core :8055 (tsx watch) + UI :5173 (Vite)
```

Üretim derlemesi ve tek süreç:

```bash
npm run build        # core/dist + ui/dist
npm start            # http://127.0.0.1:8055
```

Masaüstü kabuk (Electron, core'u kendisi başlatır):

```bash
npm run desktop
```

İlk açılışta `~/.codex-manager/` oluşur:

| Dosya | İçerik |
| --- | --- |
| `config.json` | port, API anahtarı, upstream, deneme sayısı (0600) |
| `secret.key` | AES-256-GCM anahtarı (0600) |
| `data.db` | hesaplar (şifreli token blob'u), kotlar, istek günlüğü |

Port değiştirmek için: `CODEX_MANAGER_PORT=8056 npm start` (Electron da aynı değişkeni okur).

## Codex'i gateway'e bağlama

**Switch account** Codex'i normal çıkış yoluyla kapatır, seçilen hesabı kaydeder
ve Codex'i yeniden açar. **Auto-switch** aynı işlemi kota eşiğinde yapar;
varsayılan eşik %0'dır. Bu işlem sürmekte olan bir yanıtı kesebilir.
[Hesap değiştirme, doğrulama ve hata davranışı](docs/desktop-integration.md).

Kurulabilir preview paketleri: macOS/Linux için `npm run package`, Windows x64
için `npm run package:win`. Windows native kapatıp-açma henüz desteklenmez.
[Paketleme ve imzalama durumu](docs/packaging.md).

UI'daki **Write config.toml** düğmesi `~/.codex/config.toml` dosyasına iki yönetilen bölge ekler
(TOML'de kök anahtarlar tablo başlığından sonra gelemediği için ayrı ayrı):

```toml
# >>> codex-manager (root keys: managed)
model_provider = "codex_manager"
model = "gpt-6.1-sol"
# <<< codex-manager (root keys)

… senin mevcut ayarların ve tabloların …

# >>> codex-manager (provider: managed)
[model_providers.codex_manager]
name = "Codex Manager"
base_url = "http://127.0.0.1:8055/v1"
wire_api = "responses"
requires_openai_auth = false
http_headers = { Authorization = "Bearer sk-…" }
# <<< codex-manager (provider)
```

- Mevcut kök `model` değeri korunur; blok kaldırılınca eski satırlar geri yazılır.
- Codex çalışıyorsa yeniden başlatın.
- **Remove block** bloğu siler; ilk yazmadan önceki dosya `config.toml.codex-manager.bak`
  olarak durur.

Alternatif olarak gateway'i kullanmadan yalnızca hesap değiştirmek isterseniz
**Use in CLI** hesabı doğrudan `~/.codex/auth.json`'a yazar.

## Uçlar

Gateway (Bearer = `config.json` içindeki `api_key`):

| Uç | Açıklama |
| --- | --- |
| `POST /v1/responses` | Codex Responses isteği; SSE veya JSON |
| `GET /v1/models` | Upstream model listesi (5 dk önbellek) |
| `GET /v1/usage` | Hesap bazlı kota özeti |
| `GET /healthz` | Kimlik doğrulamasız sağlık kontrolü |

Yönetim (yalnızca loopback, UI tarafından kullanılır):

`GET /api/state`, `POST /api/accounts/import`, `POST /api/accounts/json`,
`POST /api/accounts/:id/refresh`, `POST /api/accounts/refresh-all`,
`POST /api/accounts/:id/switch`, `DELETE /api/accounts/:id`,
`POST /api/login/start`, `POST /api/login/cancel`, `PATCH /api/config`,
`POST /api/key/rotate`, `POST /api/codex/config`, `DELETE /api/codex/config`.

İsteğe bağlı başlıklar:

- `x-codex-account: <id | account_id | email>` — isteği tek hesaba sabitler. Hesap
  uygun değilse **hata döner**, sessizce başka hesaba kaymaz.
- `x-codex-manager-*` yanıt başlıkları hangi hesabın kullanıldığını ve kaç deneme
  yapıldığını söyler.

## Rotasyon ve hata davranışı

1. Uygun hesaplar: `active`, veya cooldown'ı geçmiş `rate_limited`, veya cooldown'ı
   geçmiş `error`. `expired` asla seçilmez.
2. Seçim: kota ağırlığı (kalan ≥ %75 → 3, ≥ %25 → 2, altı → 1) ile smooth weighted
   round-robin.
3. Yanıtlar:
   - `429` → kota başlıkları işlenir, hesap cooldown'a alınır, sıradaki hesap denenir.
   - `401` → token bir kez zorla yenilenir; yine 401 ise hesap `expired` işaretlenir.
   - `5xx` / ağ hatası → sıradaki hesap denenir, hesap cezalandırılmaz.
   - Tüm denemeler tükenirse son hata gövdesi + `retry-after` döner.
4. Başarılı her yanıt `x-codex-*` başlıklarıyla kotayı günceller.

## Güvenlik

- Token'lar düz metin yazılmaz: AES-256-GCM, anahtar `~/.codex-manager/secret.key` (0600).
- Gateway ve API yalnızca `127.0.0.1`'e bağlanır.
- `/v1/*` sabit zamanlı karşılaştırılan Bearer anahtarı ister.
- OAuth callback dinleyicisi yalnızca loopback bağlantı kabul eder ve giriş bitince kapanır.
- Telemetri yok; hiçbir veri OpenAI dışında bir yere gitmez.

## Testler

```bash
npm test          # birim + gateway entegrasyon testleri (mock upstream)
node scripts/mock-upstream.mjs 8099   # elle denemek için sahte Codex backend'i
```

Testler gerçek `~/.codex-manager` dizinine dokunmaz; geçici `HOME` kullanır.

## Sınırlar / yol haritası

- Protokol çevirisi yok: yalnızca Responses API vekillenir (Chat Completions → Responses
  dönüşümü yok).
- WebSocket taşıması vekillenmez; Codex HTTP/SSE'ye düşer.
- macOS/Linux için Node içeren preview paketleme eklendi. İmzalama, notarization,
  otomatik güncelleme henüz yok. Windows x64 EXE/ZIP preview eklendi; Windows
  açılış testi ve Windows native hesap yeniden başlatma desteği henüz yok.
- Kota tahmini yapılmaz; yalnızca upstream'in bildirdiği değerler gösterilir.

## Lisans ve kaynak notu

Projenin kendi katkıları **CC BY-NC-SA 4.0** altında sunulur: ticari olmayan
amaçlarla kullanabilir, değiştirebilir ve paylaşabilirsiniz. Paylaşımda uygun
atıf yapılmalı, değişiklikler belirtilmeli ve uyarlamalar aynı lisans koşullarıyla
paylaşılmalıdır. Ticari kullanım için bu lisans izin vermez.

- [Tam lisans metni](LICENSE)
- [Lisans özeti](https://creativecommons.org/licenses/by-nc-sa/4.0/)
- [Üçüncü taraf lisans ve telif bildirimleri](THIRD_PARTY_NOTICES.md)
- [Yerel kaynak benzerliği incelemesi](docs/provenance-audit.md)

Ticari kullanım kısıtı nedeniyle proje, OSI tanımında açık kaynak değil,
**kaynağı açık ve ticari olmayan kullanıma yönelik** bir projedir. CC lisansları
özel olarak yazılım için tasarlanmamıştır; bu lisans proje sahibinin tercihidir.
Üçüncü taraf kütüphane ve fontlar kendi lisanslarında kalır.

Mimari yaklaşım Antigravity Manager'dan esinlenmiştir. 2026-11-02 tarihli yerel
incelemede belirgin bir uygulama kodu kopyası saptanmamıştır; bu, bütün kodun
kökeninin kesin ispatı veya tüm dış kaynakları kapsayan bir tarama değildir.

Bu proje bağımsızdır; OpenAI veya Antigravity Manager ile bağlantılı değildir.
