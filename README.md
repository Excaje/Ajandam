# 🗓️ Ajandam

Kişisel ajanda + notlar + şifre kasası. Tek kod tabanı; hem **Samsung S25 Ultra**'na hem **Windows bilgisayarına** gerçek bir uygulama gibi kurulur (PWA teknolojisi). Verilerin önce cihazında saklanır, internet olmadan da çalışır.

## Özellikler

- **Ajanda**: Gün / Hafta / Ay / Yıl görünümleri · tekrarlayan etkinlikler (her gün/hafta/ay/yıl) · renk etiketleri · etkinliklere görsel ekleme
- **Hatırlatıcı & Alarm**: bildirim + titreşim; alarm işaretlersen tam ekran uyarı ve zil sesi
- **Notlar**: görsel ekleme, sabitleme, arama
- **Şifre Kasası**: AES-256-GCM şifreleme, güçlü parola üretici, otomatik kilitlenme, tek tıkla kopyalama
- **Eşitleme** (isteğe bağlı): telefonda yaptığın değişiklik saniyeler içinde bilgisayarda — ücretsiz Firebase ile, **uçtan uca şifreli** (Google dahil kimse içeriği okuyamaz)
- **Tema**: Aydınlık / Karanlık / Sisteme uy
- **Yedekleme**: tüm verini tek (şifreli) dosyaya indir, geri yükle
- Arama, çevrimdışı çalışma, tamamen Türkçe

---

## 1) Bilgisayarda hemen deneme

Uygulama dosyaları doğrudan çift tıklamayla açılMAZ (güvenlik özellikleri `http` ister). Küçük bir yerel sunucuyla aç:

1. Bu klasörde **PowerShell** aç (klasörde boş yere Shift + sağ tık → "PowerShell penceresini burada aç")
2. Şunu çalıştır: `python -m http.server 8173`
3. Tarayıcıda `http://localhost:8173` adresine git

> Bu yalnızca deneme içindir. Kalıcı kullanım ve telefon için aşağıdaki gibi internete koy — korkma, 10 dakikalık iş ve ücretsiz.

## 2) İnternete koyma (ücretsiz, sunucu kiralamadan)

Telefona kurabilmek ve iki cihazdan aynı adrese girebilmek için dosyaların HTTPS bir adreste durması gerekir. En kolayı **GitHub Pages**:

1. [github.com](https://github.com) → ücretsiz hesap aç (varsa giriş yap)
2. Sağ üstte **+** → **New repository** → isim ver (örn. `ajandam`) → **Private değil, Public** seç → Create
   (Kod herkese açık olur ama **verilerin asla kodun içinde değildir** — veriler yalnızca cihazlarında ve şifreli olarak Firebase'de durur)
3. Repo sayfasında **uploading an existing file** bağlantısına tıkla → bu klasördeki **tüm dosya ve klasörleri** sürükle-bırak → **Commit changes**
4. Repo → **Settings** → **Pages** → Branch: `main`, klasör: `/ (root)` → **Save**
5. 1-2 dakika sonra adresin hazır: `https://KULLANICIADIN.github.io/ajandam/`

Güncelleme gerektiğinde aynı dosyaları tekrar yükleyip üzerine yazman yeterli; uygulama kendini yeniler.

## 3) Uygulama olarak kurma

**Telefon (S25 Ultra):** Chrome ile adresine git → sağ üst ⋮ menü → **"Ana ekrana ekle" / "Uygulamayı yükle"**. Artık ana ekranda kendi simgesiyle, tam ekran bir uygulama.

**Bilgisayar (Windows):** Chrome veya Edge ile adresine git → adres çubuğunun sağındaki **yükle simgesine** (⊕ / bilgisayar ikonu) tıkla. Başlat menüsüne ve görev çubuğuna eklenir.

## 4) Eşitlemeyi açma (telefon ↔ bilgisayar)

Ücretsiz bir Firebase projesi kuracaksın (kredi kartı istemez; kişisel kullanım limitlerin çok çok altında kalır):

1. [console.firebase.google.com](https://console.firebase.google.com) → Google hesabınla gir → **Proje ekle** → isim ver → Google Analytics'i **kapat** → oluştur
2. Sol menü **Build → Authentication** → **Get started** → **Sign-in method** sekmesi → **Google**'ı etkinleştir → kaydet
3. **Authentication → Settings → Authorized domains** → **Add domain** → `KULLANICIADIN.github.io` ekle
4. Sol menü **Build → Firestore Database** → **Create database** → **Production mode** → konum: `eur3 (europe-west)` → oluştur
5. Firestore'da **Rules** sekmesi → içindekini silip şunu yapıştır → **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

6. Sol üst ⚙️ → **Project settings** → aşağıda **Your apps** → **</>** (Web) simgesi → uygulamayı kaydet → ekranda çıkan `firebaseConfig = { ... }` bloğunu **tümüyle kopyala**
7. Ajandam'ı aç → **Ayarlar → Cihazlar Arası Eşitleme** → kutuya yapıştır → **Yapılandırmayı Kaydet** → **Google ile giriş yap**
8. Aynısını ikinci cihazda da yap (aynı config, aynı Google hesabı). İkinci cihaz ana parolanı bir kez sorar ve eşitlemeye katılır.

> **İsteğe bağlı sıkılaştırma:** Authentication → Users sekmesinde kendi **User UID**'ini gör; kurallardaki `request.auth.uid == uid` satırını
> `request.auth.uid == uid && uid == "SENIN_UID_DEGERIN"` yaparsan proje yalnızca senin hesabına kilitlenir.

### Güvenlik nasıl sağlanıyor?

- Ana parolandan **PBKDF2 (600.000 tur)** ile anahtar türetilir; parolan **hiçbir yere kaydedilmez ve asla cihazdan çıkmaz**
- Kasa kayıtları cihazda bile yalnızca **AES-256-GCM** ile şifreli durur
- Buluta giden **her şey** (etkinlikler, notlar, görseller, kasa) gönderilmeden önce cihazda şifrelenir → Firebase/Google sadece anlamsız şifreli bloklar görür
- ⚠️ **Ana parolanı unutursan verilerin kurtarılamaz.** Bu bir hata değil, güvenliğin bedeli. Güçlü ama hatırlayacağın bir parola seç; arada bir **Ayarlar → Yedek indir** yap.

## 5) Bildirimler hakkında dürüst not

Web uygulamalarında bildirimler **uygulama açıkken veya arka planda dururken** güvenilir çalışır:

- **Telefonda**: uygulamayı kapatmayıp arka planda bırakırsan bildirim + titreşim + alarm gelir. İlk açılışta bildirim iznini ver (Ayarlar → Bildirim izni iste → Test et).
- **Bilgisayarda**: uygulama penceresi (simge durumunda bile) açık kaldığı sürece Windows bildirimi düşer.
- Uygulama **tamamen kapalıyken** hatırlatıcı çalamaz (bunun için sunucu gerekir). Sabah uyandırma gibi kritik alarmlar için telefonun Saat uygulamasını yedek tut.
- Kaçan hatırlatıcılar, uygulamayı açtığında son 15 dakika içindeyse yine de gösterilir.

## Dosyalar

```
index.html            Uygulama iskeleti
css/style.css         Tasarım (açık/koyu tema)
js/…                  Modüller: takvim, notlar, kasa, şifreleme, bildirim, eşitleme
sw.js                 Çevrimdışı çalışma (service worker)
manifest.webmanifest  Uygulama kimliği (isim, simge)
icons/                Uygulama simgeleri
```

Sorun yaşarsan: sayfayı **Ctrl+F5** ile yenile (önbelleği tazeler). İyi kullanımlar! 🎉
