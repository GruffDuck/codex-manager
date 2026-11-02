# Doğrulama kaydı — 2026-11-02

## Başarılı kontroller

- `npm test`: 34/35 test başarılı.
- `npm run typecheck`: core ve UI TypeScript kontrolü başarılı.
- `npm run package`: macOS arm64 DMG / ZIP üretildi.
- `npm run test:package`: paketteki resmi Node 24.22.2 ve üretim bağımlılıklarıyla,
  geçici ve boş bir HOME altında core açıldı; sağlık, API ve UI cevapları doğrulandı.
- `npm audit --omit=dev`: denetim anında üretim bağımlılıklarında 0 kayıtlı açık.
  Bu sonuç bütün geliştirme araçlarının veya ürünün güvenlik garantisi değildir.
- Paket Electron 45.2.1 kullanıyor. Zod 4.6.7'ye güncellendi.
- Son `.app` gerçek kullanıcı profilinde açıldı; ana hesap ekranında yeni core'un
  canlı bağlantı durumunu gösterdiği doğrulandı. Bu işlem hesap değiştirmedi.
- Eski core'un yeni pencere tarafından sessizce kullanılmasını önleyen
  `management_api: 3` sağlık kontrolü eklendi.
- `git diff --check` ve Electron dosyalarının sözdizimi kontrolleri başarılı.

## Kapat / değiştir / yeniden aç doğrulaması

Ana hesap düğmesi ve %0 kotada auto-switch aynı yeniden başlatma denetleyicisini
kullanır. Sahte uygulama yaşam döngüsü testleri, kapanıştan önce giriş yazılmaması,
çıkışın reddi, açılış hatasında eski dosyaların geri yüklenmesi, yanlış girişin
reddi ve eşzamanlı değişiklik kilidini kapsar.

Native AppKit yardımcısının salt okunur durum sorgusu gerçek Codex kurulumunu
ve çalışan PID'yi doğru buldu. Gerçek çıkış / hesap değişimi bu aktif sohbeti
kapatacağı için başlatılmadı. Açılış sonrası hesap doğrulamasının süreç + giriş
dosyası düzeyinde olduğu, arayüz hesabının bağımsız okuması olmadığı belgelendi.

## Üretilen yerel çıktılar

- `release/Codex Manager-0.1.0-mac-arm64.dmg`
- `release/Codex Manager-0.1.0-mac-arm64.zip`
- `release/mac-arm64/Codex Manager.app`
- `release/SHA256SUMS.txt`

Bunlar imzasız preview çıktılarıdır. Apple Developer ID / notarization veya
GitHub yayını yapılmadı. macOS x64, Linux ve Windows üzerinde çalıştırma testi
bu doğrulamanın kapsamında değildir. Auto-update eklenmedi.


## Windows x64 preview çıktısı

- Node 24.22.2 win32-x64 arşivi resmi SHA-256 listesiyle doğrulandı.
- Electron 45.2.1 Windows x64 uygulaması paketlendi.
- NSIS 3.12 / electron-builder araç seti 1.2.1 ile kurulum EXE'si üretildi.
- Ana EXE ve Node, PE32+ x86-64 olarak kontrol edildi; ZIP bütünlüğü test edildi.
- macOS native yardımcı Windows paketinden çıkarıldı; restart desteği Windows'ta
  açık gösterilmez.
- Windows'ta çalıştırma / kurulum testi yapılmadı; Mac üzerinden üretim ve dosya
  incelemesi Windows davranışının doğrulandığı anlamına gelmez.
