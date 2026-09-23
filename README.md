# 🌌 TE Universe - TE Ekibi Çok Yayıncılı Hayran Portalı

**TE Universe**, TE Ekibi yayıncılarının (Yusufte, Peach, YusaBakal, Poniks, Koston, Rwaii, Goktugv) güncel YouTube içeriklerini, klip paylaşımlarını ve Minecraft skin modellerini tek bir çatı altında toplayan dinamik bir hayran portalıdır.

---

## ✨ Öne Çıkan Özellikler

* **🎨 Dinamik Yayıncı Temaları:** Her yayıncının kendine özgü renk paleti, arka plan gradyanları ve sosyal medya bağlantıları `config.json` üzerinden dinamik olarak yüklenir.
* **🎮 3D Minecraft Skin Viewer:** Yayıncıların özel Minecraft skin modellerini 3 boyutlu olarak etkileşimli biçimde görüntüleme.
* **🎬 Video & Klip Galerisi:** 
  * YouTube Data API v3 entegrasyonu ile otomatik kanal içerikleri ve önbellek (cache) korumalı kanal avatarları.
  * Firebase Firestore altyapısı ile anonim beğeni, izlenme takibi ve klip paylaşım modülü.
* **🧹 Mükemmel Bellek Yönetimi:** YouTube Player Iframe nesnelerinin sayfa içi geçişlerde tamamen temizlenip yeniden oluşturulmasıyla (`rebuildVideoFrame`) bellek sızıntıları önlenmiştir.

---

## 🛠️ Teknolojiler

* **Frontend:** HTML5, CSS3, Tailwind CSS
* **Scripting:** Pure JavaScript (ES6+ Modules)
* **Veritabanı & Auth:** Firebase Firestore, Anonymous Auth
* **API Entegrasyonları:** YouTube Data API v3
* **Otomasyon & Hosting:** GitHub Actions, GitHub Pages

---

## 👥 Yayıncı Kadrosu

| Yayıncı | Rozet | YouTube Kanalı |
| :--- | :--- | :--- |
| **Yusufte** | `YUSUFTE` | [@yusufte](https://www.youtube.com/@yusufte) |
| **Peach** | `PEACH` | [@Peach](https://www.youtube.com/@Peach) |
| **YusaBakal** | `YUSABAKAL` | [@YusaBakal](https://www.youtube.com/@YusaBakal) |
| **Poniks** | `PONİKS` | [@poniks](https://www.youtube.com/@poniks) |
| **Koston** | `KOSTON` | [@MrKoston](https://www.youtube.com/@MrKoston) |
| **Rwaii** | `RWAİİ` | [@Rwaii](https://www.youtube.com/@Rwaii) |
| **Goktugv** | `GOKTUGV` | [@goktugv](https://www.youtube.com/@goktugv) |

---

## 📂 Proje Mimarisi

```text
TE-Universe/
├── avatars/                     # Yayıncı profil görselleri
├── skins/                       # Yayıncı Minecraft skin dosyaları (.png)
├── css/
│   └── styles.css               # Tasarım Yönetimi
├── js/
│   └── app.js                   # Ana uygulama mantığı ve dinamik tema yönetimi
│   └── clips.js                 # Firestore klip modülü ve bellek temizleyici
│   └── skin-viewer.js           # Minecraft skinleri gösterimi
│   └── video-galery.js          # Yayıncıların video sergisi gösterimi
├── config.json                  # Açık kaynak yapılandırma şablonu
├── index.html                   # Ana HTML şablonu
├── README.md                    # Proje Tanıtımı
├── LICENSE                      # Lisans bilgileri
└── .gitignore                   # Dosyaları gizleme kuralları
```

---

## Canlı Demo
[Uygulamayı Aç](https://emileuemier.github.io/TE-Universe/)


## Lisans
Bu proje "Tüm Hakları Saklıdır" kapsamında korunmaktadır. Detaylar için `LICENSE` dosyasına bakınız.
