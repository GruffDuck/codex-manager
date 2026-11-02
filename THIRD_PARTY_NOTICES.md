# Üçüncü taraf bildirimleri

Codex Manager projesinin kendi katkıları CC BY-NC-SA 4.0 altında sunulur.
Aşağıdaki üçüncü taraf bileşenler kendi lisanslarına tabidir. Projenin ticari
kullanım kısıtı bu bileşenlerin bağımsız olarak sahip olduğu hakları değiştirmez.

## Başlıca JavaScript bileşenleri

Bu tablo 2026-11-02 tarihinde kurulu sürümleri gösterir; geliştirme araçları da
şeffaflık için listelenmiştir. Lisans metinleri değiştirilmeden kopyalanmıştır.

| Bileşen | Sürüm | Lisans | Lisans / bildirim metni |
| --- | --- | --- | --- |
| fastify | 5.12.7 | MIT | [LICENSE](licenses/npm/fastify--LICENSE) |
| lucide-react | 1.65.0 | ISC | [LICENSE](licenses/npm/lucide-react--LICENSE) |
| zod | 4.6.7 | MIT | [LICENSE](licenses/npm/zod--LICENSE) |
| ws | 8.22.1 | MIT | [LICENSE](licenses/npm/ws--LICENSE) |
| react | 19.3.1 | MIT | [LICENSE](licenses/npm/react--LICENSE) |
| react-dom | 19.3.1 | MIT | [LICENSE](licenses/npm/react-dom--LICENSE) |
| electron | 45.2.1 | MIT | [LICENSE](licenses/npm/electron--LICENSE) |
| vite | 6.4.5 | MIT | [LICENSE.md](licenses/npm/vite--LICENSE.md) |
| typescript | 5.9.3 | Apache-2.0 | [LICENSE.txt](licenses/npm/typescript--LICENSE.txt), [ThirdPartyNoticeText.txt](licenses/npm/typescript--ThirdPartyNoticeText.txt) |
| tsx | 4.23.15 | MIT | [LICENSE](licenses/npm/tsx--LICENSE) |
| smol-toml | 1.9.1 | BSD-3-Clause | [LICENSE](licenses/npm/smol-toml--LICENSE) |
| electron-builder | 26.18.0 | MIT | [LICENSE](licenses/npm/electron-builder--LICENSE) |

Tam kilit dosyası envanteri: [dependency-licenses.json](docs/dependency-licenses.json).
Bu envanter, geçişli ve platforma özel isteğe bağlı paketleri de içerir;
yukarıdaki tablo tüm geçişli bağımlılıkların bildirimlerinin eksiksiz bir paketi
olduğu iddiasını taşımaz. Dağıtım paketi hazırlanırken o pakete giren tüm
bağımlılıkların gerekli lisans ve bildirimleri de eklenmelidir.

Paketin 51 üretim bağımlılığı içinde bağımsız LICENSE dosyası taşımayan
`abstract-logging` 2.0.1, README'sinde yazarının MIT lisans sayfasına işaret eder.
Bu sayfa değişmeden [MIT lisans bildirimi](licenses/npm/abstract-logging--MIT.html)
olarak eklendi; paket içindeki README de korunur.

Lucide lisans metni, Feather kökenli ikonlar için MIT bildirimini de içerir.
Electron dağıtımındaki `LICENSE` ve `LICENSES.chromium.html` dosyaları masaüstü
paketlerinde korunmalıdır; Chromium'un bildirimleri Electron'un kendi MIT
lisans dosyasının yerine geçmez.

## IBM Plex fontları

`ui/public/fonts/` ve `electron/assets/fonts/` altında IBM Plex Sans / Mono adıyla
kullanılan fontlar bulunur. IBM Plex, SIL Open Font License 1.1 altında sunulur.

- Kaynak: https://github.com/IBM/plex
- Telif / lisans: [IBM Plex OFL](licenses/ibm-plex/OFL.txt)
- Copyright © 2017 IBM Corp. with Reserved Font Name "Plex".

Fontlar ana projenin ticari kullanım kısıtına geçirilmez. Bu incelemede font
ikili dosyalarının belirli bir IBM sürümüne kadar tedarik zinciri doğrulaması
yapılmamıştır; yayımlamadan önce kaynağı kayıtlı dosyalarla doğrulanmalıdır.

## Antigravity Manager

Ayrı core süreci, yerel gateway ve hesap havuzu yaklaşımından esinlenilmiştir.
Yerel karşılaştırmada belirgin bir uygulama kodu kopyası saptanmamıştır;
yöntem, kısa ortak kalıplar ve sınırlamalar [inceleme raporunda](docs/provenance-audit.md)
belgelenmiştir. Bu atıf, Antigravity kodunun dağıtıldığı veya yazarlarının bu
projeyi onayladığı anlamına gelmez.
