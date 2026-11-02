# Codex hesap değiştirme — kapanış ve yeniden açılış

## Kullanıcı akışı

Ana hesap düğmesi ve auto-switch aynı `RestartController` işlemini çağırır:

1. Seçilen hesabın token'ları ve Codex kurulumu kontrol edilir.
2. macOS AppKit aracılığıyla Codex'e normal çıkış isteği gönderilir.
3. Ana uygulama ve ona ait çocuk süreçlerin kapanışı beklenir. Zorla kapatma yoktur.
4. Giriş ve yapılandırma dosyalarının o andaki halleri şifreli olarak yedeklenir.
5. Seçilen hesap `auth.json` dosyasına atomik yazılır. Manager gateway ayarı varsa
   kaldırılır; doğrudan ChatGPT girişi hazırlanır.
6. Codex aynı `CODEX_HOME` ile açılır.
7. Üç kontrol boyunca uygulamanın açık kaldığı ve giriş dosyasının seçilen hesapta
   kaldığı doğrulanır. Sonuç ancak bundan sonra tamamlandı olarak kaydedilir.

Bu akış açık Codex sunucusuna canlı RPC bağlantısı gerektirmez. Kodun içinde
korunan deneysel canlı bağlantı yolu ana hesap düğmesi veya auto-switch için
kullanılmaz.

## API ve ilerleme

- `POST /api/accounts/:id/use-in-codex`: kapat → hesabı kaydet → aç.
- `GET /api/codex/restart`: destek, uygulama durumu ve son işlem aşaması.
- `GET /api/state`: `codex_restart` alanı arayüz için aynı durumu içerir.
- `POST /api/accounts/:id/prepare`: yalnızca dosyayı hazırlar; elle açılış içindir.
- `POST /api/accounts/:id/use-in-cli`: yalnızca CLI giriş dosyasını değiştirir.
- `POST /api/accounts/:id/live-switch`: ortak sunuculu kurulumlar için deneysel
  eski yol; ana arayüzde kullanılmaz.

Aşamalar: `preparing`, `closing`, `writing`, `opening`, `checking`, `completed`,
`failed`. Arayüz işlem sürerken diğer hesap düğmelerini kilitler. Core düzeyinde
ortak kilit, CLI yazımı ile yeniden başlatmanın çakışmasını da engeller.

## Auto-switch

`Restart Codex` hedefi, seçili giriş dosyasındaki hesabın en dar kota penceresini
izler. Varsayılan eşik %0, kontrol aralığı 60 saniyedir. Uygun bir sonraki hesabın
bilinen ve eşikten yüksek kalan kotası olmalıdır. Henüz kota bilgisi olmayan
hesaba veya kullanılamayan hesaba rastgele geçilmez.

Codex kullanıcı tarafından kapatılmışsa auto-switch onu tekrar açmaz. Yönetilen
bir hesap seçili değilse önce kullanıcıdan bir hesap seçmesi beklenir.
Aktif yanıtın bitmesini bekleme koşulu yoktur: kota eşiğine ulaşınca uygulama
normal çıkış akışıyla kapanır. Bu, sürmekte olan bir yanıtı kesebilir.

Yeniden başlatma başarısızsa olay kaydı ve tercihe bağlı bildirim oluşturulur.
Aynı hedef için otomatik yeniden deneme en az on dakika durdurulur; manuel
tekrar deneme mümkündür. Başka bir hesap değişikliği sürüyorsa işlem ertelenir.
`CLI only` hedefi uygulamayı yeniden başlatmaz; yalnızca giriş dosyasını hazırlar.

## Hata davranışı

- Token yenilenemez veya Codex bulunamazsa açık uygulamaya dokunulmaz.
- Codex normal çıkışı kabul etmez veya çocuk süreçler kapanmazsa giriş değiştirilmez.
- Yazma / açma / açılış kontrolü başarısızsa, gerekirse kısmen açılmış Codex
  kapatılır, önceki dosyalar geri yazılır ve önceden açıksa eski girişle açılır.
- Kurtarma da başarısızsa arayüz bunu açıkça söyler; başarı iddia edilmez.
- Geri dönüş verisi veritabanında AES-256-GCM ile şifrelenir ve başarılı işlem /
  başarılı geri dönüşten sonra temizlenir. Tam süreç veya makine çöküşünden
  otomatik kurtarma henüz uygulanmamıştır; yarıda kalan işlem Manager'da görünür.

## Sınırlar ve doğrulama

Native yaşam döngüsü yardımcısı şu an macOS içindir. Uygulama kimliği
`com.openai.codex` ile bulunur; başka uygulamalara veya bağımsız CLI süreçlerine
çıkış isteği gönderilmez. Derleme Swift / Xcode command line tools gerektirir;
son kullanıcı paketinde derlenmiş yardımcı bulunur.

Açılış doğrulaması **süreç + giriş dosyası** doğrulamasıdır. Özel sunucu kullanan
Codex sürümlerinde arayüzde görünen hesabın bağımsız RPC sorgusu yapıldığı veya
sohbetlerin otomatik devam ettirildiği iddia edilmez.

35 test; kapanış sırası, giriş dosyasına dokunmadan hata verme, açılış hatasında
geri dönüş, sonradan değişen girişin reddi, eşzamanlı istekler ve sıfır kotada
manuel / otomatik akışın aynı denetleyiciyi kullanmasını kapsar. Gerçek native
kurulum durum sorgusu yapıldı; mevcut sohbeti kapatacağı için bu geliştirme
sırasında gerçek Codex'e çıkış / hesap değişimi isteği gönderilmedi.
