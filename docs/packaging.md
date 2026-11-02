# Masaüstü paketi

## Derleme

macOS arm64/x64 ve Linux arm64/x64 üzerinde, hedef mimariyle aynı makinede:

```sh
npm ci
npm run package
```

Klasör biçiminde paket için `npm run package:dir` kullanılabilir.
Çıktılar `release/` altına yazılır. macOS'ta `.app`, `.dmg` ve `.zip`;
Linux'ta AppImage ve tar.gz hedefleri tanımlıdır. Linux hedefi bu macOS
çalışmasında çalıştırılarak doğrulanmamıştır.

Windows x64 preview paketi (macOS üzerinden de derlenebilir):

```sh
npm run package:win
```

`release/Codex Manager-Setup-0.1.0-win-x64.exe` kurulum dosyası ve
`release/Codex Manager-0.1.0-win-x64.zip` oluşur. ZIP tüm klasörüyle çıkarılmalıdır;
uygulama EXE'si tek başına kopyalanmamalıdır. Windows arm64 hedefi
`npm run package:win -- arm64` ile seçilebilir; bu çalışmada üretilmedi.

Windows paketi resmi Windows Node çalışma zamanını içerir. Hesap yönetimi,
kota ve gateway kodu paketlenir; ancak Codex'i kapatıp tekrar açan native
hesap değiştirme yardımcısı yalnızca macOS içindir. Windows'ta restart /
buna bağlı auto-switch destekleniyor gibi gösterilmez. Windows üzerinde
kurulum ve açılış testi henüz yapılmadığından bu sürüm preview'dur.

Paket, core için resmi Node.js 24 çalışma zamanını içerir; son kullanıcıya
Node veya npm kurulumu gerekmez. `prepare-runtime.mjs`, resmi Node dağıtımını
aynı HTTPS kaynağındaki SHA-256 listesiyle doğrular ve kaynak / hash bilgisini
paketteki `runtime/manifest.json` içinde saklar. Lisansı `runtime/NODE-LICENSE`
olarak paketlenir. Çalışma zamanı sürümü script içinde sabitlenmiştir.

Bu kontrol TLS kaynağı ve sağlama toplamına dayanır; Node release anahtarlarıyla
ayrı bir imza doğrulaması yapıldığı iddia edilmez.

## Yayın durumu

Bu paketler **imzasız preview** paketleridir. Windows Authenticode imzası da yoktur. macOS Developer ID ve Apple
notarization bilgileri yapılandırılmadı. Gatekeeper güven uyarıları beklenebilir;
paket imzalı / notarize edilmiş bir sürüm olarak tanıtılmamalıdır. Otomatik
güncelleme altyapısı yoktur. Hiçbir komut otomatik GitHub release yayımlamaz.

Üretim yayını için Developer ID, notarization, platform testleri ve dağıtılan
bileşenlerin tam lisans bildirimleri tamamlanmalıdır. IBM Plex ikili dosyalarının
ve özel ikonların köken doğrulaması önceki incelemede açık madde olarak kalmıştır.

Uygulama, kullanıcı hesaplarını ve ayarları mevcut `~/.codex-manager` içinde
tutar; paket bu kişisel verileri içermez. Ana proje lisansı CC BY-NC-SA 4.0'dır;
üçüncü taraflar kendi lisanslarında kalır.


Windows cross-build, electron-builder'ın ARM destekli NSIS 1.2.1 araç setini
kullanır. Bu preview'da EXE kaynak düzenleme / kod imzalama kapalı olduğundan
ana EXE bazı Electron varsayılan ikon / sürüm alanlarını taşıyabilir. Kurulum
ve uygulama dosyaları aynı kaynak sürümden üretilir. Yayın öncesi Windows
üzerinde uygulama açılışı ve platforma özgü özellikler ayrıca test edilmelidir.
