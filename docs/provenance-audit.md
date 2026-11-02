# Kaynak ve lisans incelemesi

Tarih: 2026-11-02. İncelenen ürün: Codex Manager 0.1.0.

## Sonuç

Yerel Antigravity Manager kopyasıyla yapılan karşılaştırmada, Codex Manager'a
alınmış belirgin bir uygulama işlevi veya birebir aynı dosya saptanmadı.
Bu sonuç **kodun tamamen özgün olduğunu ispatlamaz**. Üçüncü taraf kütüphane,
ikon ve font kullanımı vardır; bunların lisansları korunmalıdır.

Ana proje lisansı sahibinin tercihiyle **CC BY-NC-SA 4.0** olarak korundu.
Ticari olmayan kullanım, değişiklik ve paylaşım mümkündür; atıf, değişikliklerin
belirtilmesi ve paylaşılan uyarlamalarda aynı lisans koşulları gerekir.
Bu lisans bir yazılım lisansı olarak özel tasarlanmamıştır ve ticari kullanım
kısıtı nedeniyle proje OSI tanımında açık kaynak olarak tanıtılmamalıdır.

## Kapsam ve yöntem

- Üründeki 43 adet `.ts`, `.tsx`, `.js`, `.cjs`, `.mjs`, `.css`, `.html`, `.svg`
  dosyası, Antigravity Manager'daki aynı uzantılı 1.511 dosyayla karşılaştırıldı.
- `node_modules`, `.git`, `dist`, `.vite`, `.taste-skill`, `coverage` hariç tutuldu.
- Yorumlar ve boşluk farkları kısmen giderilerek 25 token uzunluğundaki ortak
  diziler tarandı; aday dosya çiftlerinde en uzun ortak token dizisi ölçüldü.
- Kaynak ve varlık dosyalarında SHA-256 ile birebir dosya eşleşmesi arandı.
  Ana `LICENSE` ve npm kilit dosyası bu birebir karşılaştırma sonucundan hariçtir.
- Bulunan anlamlı adaylar elle incelendi. Protokol alanları ve standart
  programlama kalıpları, tek başına kod alıntısı kanıtı olarak değerlendirilmedi.

Makine çıktısı, adaylar ve ürün dosya özetleri:
[provenance-audit.json](provenance-audit.json).

## Bulunan benzerlikler

| Alan | Bulgu | Değerlendirme |
| --- | --- | --- |
| Tam dosyalar | Birebir eşleşen ürün dosyası bulunmadı | Ana lisans ve kilit dosyası hariç; dış bağımlılıklar tarama dışında |
| Erişilebilirlik CSS'i | En uzun ortak dizi 57 token; `prefers-reduced-motion` bloğu | Yaygın animasyon azaltma kalıbı; kökenini tek başına belirlemez |
| Test sunucuları | 27–29 token; `server.listen(0, '127.0.0.1', resolve)` | Standart Node test kalıbı; bazı eşleşmeler bu inceleme sırasında eklenen testte çıktı |
| React alanı | 29 token; Enter ile `event.currentTarget.blur()` | Kısa, yaygın olay işleyicisi |
| Port doğrulama | 26 token; 1024–65535 aralığında Zod doğrulaması | Standart port aralığı ve API kullanımı |
| Diğer adaylar | Kısa HTML başlangıç iskeleti, JSON hata cevabı, HTTP callback | Belirgin bir özgün uygulama bloğu saptanmadı |

Toplam 14 dosya çifti 25 token eşiğini geçti. Bu, 14 alıntı kod parçası olduğu
anlamına gelmez; aynı kısa kalıp birden fazla referans dosyasında bulunabilir.

## Mimari esin ve protokol bilgisi

Yerel tasarım belgeleri, ayrı core süreci, yerel gateway ve hesap havuzu
mimarisinde Antigravity Manager'ın incelendiğini açıkça belirtiyor. Bu esin,
kaynak kod kopyasıyla aynı şey değildir. README'deki kesin “hiçbir kaynak kodu
kopyalanmamıştır” iddiası, bu incelemenin desteklediği sınırlı ifadeyle değiştirildi.

Yerel blueprint ayrıca bazı OAuth / plan uçlarının üçüncü taraf bir Codex
Manager ikili dosyasından gözlemlendiğini kaydediyor. İlgili ikili bu incelemede
karşılaştırılmadı. Protokol uçlarını gözlemlemek tek başına kod kopyalandığını
göstermez; üçüncü taraf ikilinin lisansı ve kullanım koşulları hakkında bu
inceleme bir hüküm vermez.

## Üçüncü taraf içerik

İlk inceleme anındaki `package-lock.json` içinde 267 harici paket kaydı vardı
(aşağıdaki tablo o anın görüntüsüdür; canlı bağlantı / paketleme geliştirmesinden
sonraki güncel envanter `dependency-licenses.json` dosyasındadır):

| Lisans beyanı | Kayıt sayısı |
| --- | ---: |
| MIT | 237 |
| ISC | 14 |
| BSD-3-Clause | 9 |
| Apache-2.0 | 3 |
| BSD-2-Clause | 2 |
| CC-BY-4.0 | 1 |
| MIT OR CC0-1.0 | 1 |

Bunlar paket sayılarıdır, uygulamaya paketlenen modül sayısı değildir.
Geliştirme ve platforma özel isteğe bağlı paketler de bu sayıya dahildir.
CC-BY-4.0 kaydı `caniuse-lite` verisidir.

- Lucide ikonlarının ISC ve Feather kökenli ikonların MIT bildirimleri korunur.
- IBM Plex fontları için eksik OFL metni resmi IBM deposundan eklendi.
- Başlıca doğrudan kullanılan paketlerin yerel lisans/bildirimleri eklendi.
- Electron paketlemesinde Chromium'un kendi üçüncü taraf bildirimleri de korunmalıdır.
- Yeni ana proje lisansı, üçüncü tarafların lisanslarını veya telif sahipliğini değiştirmez.

Ayrıntılar: [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
Envanter: [dependency-licenses.json](dependency-licenses.json).

## Sınırlamalar ve yayımdan önce kalanlar

Bu inceleme bütün interneti, eski sürümlerin tamamını veya yeniden adlandırılmış
ve önemli ölçüde dönüştürülmüş kodu kapsamıyor. İkili varlıklarda görsel benzerlik
analizi yapılmadı; eşit SHA-256 bulunmaması özgün tasarım kanıtı değildir.
Font dosyalarının belirli bir upstream sürümüne kadar kökeni doğrulanmadı.
Paketlerin beyan ettiği lisanslar bağımsız bir hukuki inceleme değildir.

Yayımdan önce font / ikon kaynağı kayıtları tamamlanmalı, üretilen masaüstü
paketindeki geçişli bağımlılık bildirimleri denetlenmeli ve yeni bir kaynak
alıntısı eklenirse dosya bazında kaynak, yazar, lisans ve değişiklikler yazılmalıdır.
Git geçmişindeki gizli bilgiler ve OAuth dağıtım koşulları bu kaynak benzerliği
incelemesinden ayrı kontrol edilmelidir.

## Lisans kaynakları

- CC BY-NC-SA 4.0: https://creativecommons.org/licenses/by-nc-sa/4.0/
- CC'nin yazılım açıklaması: https://creativecommons.org/faq/#can-i-apply-a-creative-commons-license-to-software
- OSI tanımı: https://opensource.org/osd
- IBM Plex lisansı: https://github.com/IBM/plex/blob/master/LICENSE.txt
