/* ============================================================
   YUSUFTE UNIVERSE - js/app.js
   Merkezi başlatıcı: config.json'u okur, yayıncı geçişini ve
   temayı yönetir, tüm modülleri başlatır.
   ============================================================ */
(function () {
  'use strict';

  var VIEW_NAMES = ['home', 'clips', 'videos'];
  var LS_CREATOR = 'my_universe_creator';

  var cfg = null;
  var activeCreatorId = 'all';
  var titleMain = 'YUSUFTE';

  /* Kanal thumbnail önbelleği (YouTube API kotası koruması) */
  var thumbCache = {};

  /* ---------- HTML kaçışı ---------- */
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function byId(id) {
    return document.getElementById(id);
  }

  /* Sosyal medya platform tanımları: config.creators.*.socials anahtarları
     bu sırada DOM'a basılır. değeri boş olanlar atlanır. */
  var SOCIAL_DEFS = [
    { key: 'youtube', icon: '<i class="fa-brands fa-youtube"></i>', aria: 'YouTube' },
    { key: 'kick', img: 'https://cdn.simpleicons.org/kick/white', aria: 'Kick' },
    { key: 'x', icon: '<i class="fa-brands fa-x-twitter"></i>', aria: 'X' },
    { key: 'twitter', icon: '<i class="fa-brands fa-x-twitter"></i>', aria: 'X' },
    { key: 'instagram', icon: '<i class="fa-brands fa-instagram"></i>', aria: 'Instagram' },
    { key: 'discord', icon: '<i class="fa-brands fa-discord"></i>', aria: 'Discord' },
    { key: 'twitch', icon: '<i class="fa-brands fa-twitch"></i>', aria: 'Twitch' },
    { key: 'tiktok', icon: '<i class="fa-brands fa-tiktok"></i>', aria: 'TikTok' },
    { key: 'github', icon: '<i class="fa-brands fa-github"></i>', aria: 'GitHub' },
    { key: 'spotify', icon: '<i class="fa-brands fa-spotify"></i>', aria: 'Spotify' }
  ];

  /* Seçilen yayıncının creators.*.socials verisinden hero sosyal ikonlarını
     dinamik olarak üretir (footer'da görünmez, yalnızca ana sayfada). */
  function renderCreatorSocials(creator) {
    var socials = (creator && creator.socials) || {};
    var wrapId = 'hero-socials';
    var wrap = byId(wrapId);
    if (!wrap) return;
    wrap.style.display = '';
    wrap.innerHTML = '';

    var added = false;
    SOCIAL_DEFS.forEach(function (def) {
      var url = String(socials[def.key] || '').trim();
      if (!url) return;
      var a = document.createElement('a');
      url = /^https?:\/\//i.test(url) ? url : 'https://' + url;
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.className = 'social-dot group';
      a.setAttribute('aria-label', def.aria);
      a.title = def.aria;
      if (def.img) {
        a.innerHTML = '<img src="' + def.img + '" alt="' + def.aria + '" class="w-4 h-4 object-contain opacity-60 group-hover:opacity-100 group-hover:brightness-0 transition-all duration-250">';
      } else {
        a.innerHTML = def.icon;
      }
      wrap.appendChild(a);
      added = true;
    });

    // "Tüm Ekip" istisnası: ekip hesabı boşsa uyarı yazısı gösterilmez, kutu gizlenir
    if (!added && activeCreatorId === 'all') {
      wrap.style.display = 'none';
      return;
    }

    if (!added) {
      var hint = document.createElement('span');
      hint.className = 'text-xs text-white/35 font-mono';
      hint.textContent = 'Sosyal medya tanımlanmadı (config.json → creators.*.socials)';
      wrap.appendChild(hint);
    }
  }

  /* ---------- Renk yardımcıları ---------- */
  function hexToRgb(hex) {
    var h = String(hex || '').replace('#', '').trim();
    if (!h) return '255, 122, 89';
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    if (h.length !== 6) return '255, 122, 89';
    var n = parseInt(h, 16);
    if (isNaN(n)) return '255, 122, 89';
    return ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255);
  }

  function shade(hex, ratio) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    if (h.length !== 6) return hex || '#ff6b35';
    var n = parseInt(h, 16);
    if (isNaN(n)) return hex;
    var clamp = function (v) { return Math.max(0, Math.min(255, Math.round(v))); };
    var r = clamp(((n >> 16) & 255) + 255 * ratio);
    var g = clamp(((n >> 8) & 255) + 255 * ratio);
    var b = clamp((n & 255) + 255 * ratio);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  /* ---------- Tema uygulama ---------- */
  function applyTheme(theme) {
    var t = theme || {};
    var root = document.documentElement;
    var primary = t.primary || '#ff7a59';

    root.style.setProperty('--accent', primary);
    root.style.setProperty('--accent-rgb', hexToRgb(primary));
    root.style.setProperty('--accent-bright', shade(primary, 0.25));
    root.style.setProperty('--accent-deep', shade(primary, -0.22));
    root.style.setProperty('--accent-dim', t.primaryGlow || 'rgba(255, 122, 89, 0.35)');
    root.style.setProperty('--accent-gradient', t.gradient || 'linear-gradient(135deg, ' + primary + ', ' + shade(primary, -0.2) + ')');
    root.style.setProperty('--bg-accent', t.bgAccent || 'rgba(255, 122, 89, 0.1)');
  }

  /* ---------- Kanallar ---------- */
  function channelUrl(ch) {
    var handle = String((ch && ch.handle) || '').trim();
    var id = String((ch && ch.id) || '').trim();
    if (handle) return 'https://www.youtube.com/@' + handle.replace(/^@+/, '');
    if (!id) return '#';
    if (id.charAt(0) === '@') return 'https://www.youtube.com/' + id;
    return 'https://www.youtube.com/channel/' + id;
  }

  /* "all" seçiliyken tüm yayıncıların YALNIZCA ana kanalları
     (isMainChannel === true) birleştirilir; kesit/yan kanallar elenir.
     Bireysel yayıncı seçilince kendi tüm kanalları listelenir. */
  function resolveChannels(creatorId) {
    var creators = (cfg && cfg.creators) || {};
    var list = [];
    var own = creators[creatorId];
    var arr = (own && own.youtubeChannels) || [];
    if (creatorId === 'all') arr = (arr || []).filter(function (ch) { return ch.isMainChannel === true; });
    if (arr.length) {
      list = list.concat(arr);
    } else if (creatorId === 'all') {
      Object.keys(creators).forEach(function (k) {
        list = list.concat((creators[k].youtubeChannels || []).filter(function (ch) {
          return ch.isMainChannel === true;
        }));
      });
    }
    var seen = {};
    var out = [];
    list.forEach(function (ch) {
      // id yoksa handle'a düş: kanal asla liste dışında kalmasın
      var cid = String((ch && ch.id) || (ch && ch.handle) || '').trim();
      if (!cid) {
        var fallbackHandle = String((ch && ch.handle) || '').trim();
        if (fallbackHandle) cid = fallbackHandle;
      }
      if (!cid || seen[cid]) return;
      seen[cid] = true;
      out.push({
        id: cid,
        handle: String((ch && ch.handle) || '').trim(),
        name: (ch && ch.name) || cid
      });
    });
    return out;
  }

  function renderChannelAnchor(ch, cls) {
    var a = document.createElement('a');
    a.href = channelUrl(ch);
    a.target = '_blank';
    a.rel = 'noopener';
    a.className = cls;
    a.innerHTML = '<i class="fa-brands fa-youtube mr-1.5"></i><span>' + esc(ch.name) + '</span>';
    return a;
  }

  function renderNavChannels(channels) {
    var wrap = byId('nav-channels');
    if (!wrap) return;
    wrap.innerHTML = '';
    channels.slice(0, 4).forEach(function (ch) {
      var a = renderChannelAnchor(ch, 'btn-ghost inline-flex');
      var label = a.querySelector('span');
      if (label) label.className = 'nav-label';
      wrap.appendChild(a);
    });
  }

  function renderHeroChannels(channels) {
    var wrap = byId('hero-channels');
    if (!wrap) return;
    wrap.innerHTML = '';

    if (!channels.length) {
      var hint = document.createElement('div');
      hint.className = 'mt-1 text-xs text-white/35 font-mono';
      hint.textContent = 'Kanal tanımlanmadı — config.json → creators.' + activeCreatorId + '.youtubeChannels';
      wrap.appendChild(hint);
      return;
    }

    channels.forEach(function (ch, i) {
      var cls = i === 0 ? 'btn-primary' : 'btn-accent';
      var a = renderChannelAnchor(ch, cls);
      var ic = a.querySelector('i');
      if (ic) ic.removeAttribute('class');
      if (ic) ic.setAttribute('class', 'fa-brands fa-youtube mr-2');
      wrap.appendChild(a);
    });
  }

  /* ---------- YouTube kanal thumbnail'i (DTO kotası dostu) ---------- */
  function getChannelThumb(channelId) {
    channelId = String(channelId || '');
    if (channelId in thumbCache) return Promise.resolve(thumbCache[channelId] || null);

    var apiKey = (cfg && cfg.youtubeApiKey) || '';
    if (!apiKey || !channelId || channelId.charAt(0) === '@') {
      thumbCache[channelId] = '';
      return Promise.resolve(null);
    }

    return fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&id=' +
      encodeURIComponent(channelId) + '&key=' + encodeURIComponent(apiKey))
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (data) {
        var item = data && data.items && data.items[0];
        var s = item && item.snippet;
        var th = (s && s.thumbnails) || {};
        var url = (th.medium && th.medium.url) || (th.default && th.default.url) || (th.high && th.high.url) || '';
        thumbCache[channelId] = url;
        return url || null;
      })
      .catch(function () {
        thumbCache[channelId] = '';
        return null;
      });
  }

  /* ---------- Marka avatarı / favicon ---------- */
  /* Yerel profil fotoğrafı adayları: avatars/{creatorKey}.png/.jpg/.jpeg/.webp.
     YouTube URL'leri kırık/kota/tanımlı değilse otomatik olarak buraya düşülür. */
  function localAvatarCandidates(creatorKey) {
    return ['png', 'jpg', 'jpeg', 'webp'].map(function (ext) {
      return 'avatars/' + String(creatorKey).toLowerCase() + '.' + ext;
    });
  }

  function updateBrandAvatar(creator, siteInfo) {
    var avatar = byId('nav-brand-avatar');
    var icon = byId('nav-brand-icon');
    var tag = byId('nav-brand-tag');

    function setFavicon(url) {
      if (!url) return;
      var fav = byId('site-favicon');
      if (!fav) {
        fav = document.createElement('link');
        fav.rel = 'icon';
        fav.id = 'site-favicon';
        fav.type = 'image/png';
        document.head.appendChild(fav);
      }
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        try {
          // Kare/dikdörtgen olmasına bakılmaksızın favicon HER ZAMAN
          // kusursuz bir daire (ctx.arc + ctx.clip) olarak çizilir.
          var size = Math.min(img.naturalWidth, img.naturalHeight) || 64;
          var canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          var ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, size, size);
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          var sx = Math.max(0, (img.naturalWidth - size) / 2);
          var sy = Math.max(0, (img.naturalHeight - size) / 2);
          ctx.drawImage(img, sx, sy, size, size, 0, 0, size, size);
          fav.href = canvas.toDataURL('image/png');
        } catch (e) {
          fav.href = url;
        }
      };
      img.onerror = function () { fav.href = url; };
      img.src = url;
    }

    function hideImg() {
      if (avatar) avatar.classList.add('hidden');
      if (icon) icon.classList.remove('hidden');
      if (tag) tag.classList.add('hidden');
    }

    function showTag() {
      if (avatar) avatar.classList.add('hidden');
      if (icon) icon.classList.add('hidden');
      if (tag) tag.classList.remove('hidden');
    }

    function showImg(url) {
      if (!url) return showTag();
      setFavicon(url);
      if (avatar) {
        avatar.onload = function () {
          avatar.classList.remove('hidden');
          avatar.classList.add('rounded-full', 'aspect-square', 'object-cover');
          if (icon) icon.classList.add('hidden');
          if (tag) tag.classList.add('hidden');
        };
        avatar.onerror = hideImg;
        avatar.src = url;
      }
    }

    // Tüm Ekip: avatarUrl (örn. avatars/te-ekip.png) yoksa "TE" rozeti gösterilir
    // — artık 'all' da diğer yayıncılar gibi avatar zincirinden geçer.

    // 1) avatarUrl → 2) avatars/{key}.png/.jpg… → 3) siteInfo.fallbackAvatar → 4) baş harfler/rozete
    var candidates = [];
    if (creator && creator.avatarUrl) candidates.push(creator.avatarUrl);
    localAvatarCandidates(activeCreatorId).forEach(function (u) { candidates.push(u); });
    if (siteInfo && siteInfo.fallbackAvatar) candidates.push(siteInfo.fallbackAvatar);

    var tryIndex = 0;
    function tryNext() {
      if (tryIndex >= candidates.length) {
        // Hiçbiri yüklenemedi — son durak baş harf rozeti ("all" → "TE")
        showTag();
        return;
      }
      var url = candidates[tryIndex++];
      var probe = new Image();
      probe.onload = function () { showImg(url); };
      probe.onerror = function () { tryNext(); };
      probe.src = url;
    }

    // avatarUrl tanımlı değilse, yapılandırılmış kanal varsa YouTube API
    // thumbnail'i öncelik adayı olarak (async) ekle.
    if (!(creator && creator.avatarUrl)) {
      var first = resolveChannels(activeCreatorId)[0];
      if (first && first.id && /^UC[\w-]{22}$/.test(first.id)) {
        getChannelThumb(first.id).then(function (url) {
          if (url) candidates.unshift(url);
          tryNext();
        });
        return;
      }
    }
    tryNext();
  }

  function creatorById(id) {
    return (cfg && cfg.creators && cfg.creators[id]) || null;
  }

  /* ---------- Yayıncı görünümü güncelleme ---------- */
  function applyCreator(creatorId) {
    var cr = creatorById(creatorId) || creatorById('all');
    if (!cr) return;
    activeCreatorId = creatorId;

    applyTheme(cr.colorTheme);

    // Sayfa başlığı: [Yayıncı] Universe (Tüm Ekip → "TE Ekibi Universe")
    var info = (cfg && cfg.siteInfo) || {};
    if (creatorId === 'all') {
      document.title = 'TE Ekibi Universe';
    } else {
      document.title = (cr.name || '').trim() + ' Universe';
    }

    // Sol üst marka/logo başlığı
    var brand = byId('nav-brand');
    if (brand) {
      brand.textContent = (creatorId === 'all')
        ? 'TE Ekibi Universe'
        : ((cr.name || '').trim() + ' Universe');
    }

    // Hero başlığı + rozet
    var mainWord = (creatorId === 'all')
      ? titleMain
      : String(cr.name || '').trim().toUpperCase();
    var mainEl = byId('hero-title-main');
    if (mainEl) mainEl.textContent = mainWord || 'UNIVERSE';
    var subEl = byId('hero-title-sub');
    if (subEl) subEl.textContent = 'UNIVERSE';

    // Orta-üst küçük etiket: hangi yayıncı seçilirse seçilsin sabit "Hayran Portalı"
    var badgeEl = byId('hero-badge');
    if (badgeEl) {
      badgeEl.textContent = 'Hayran Portalı';
    }

    var heroSub = byId('hero-subtitle');
    if (heroSub) {
      if (creatorId === 'all') {
        heroSub.textContent = info.subtitle || 'Yusufte Ekibi Çok Yayıncılı Hayran Portalı';
      } else {
        heroSub.textContent = cr.name + ' — YouTube kanalları, topluluk klipleri ve skinler.';
      }
    }

    var skinName = byId('skin-creator-name');
    if (skinName) skinName.textContent = cr.name;
    var skinTitle = byId('skin-card-title');
    if (skinTitle) skinTitle.textContent = cr.name + ' Karakteri';

    // Kanallar
    var channels = resolveChannels(creatorId);
    renderNavChannels(channels);
    renderHeroChannels(channels);

    // Marka avatarı
    updateBrandAvatar(cr, info);

    // Sosyal medya bağlantıları (hero + footer) — yayıncının socials verisine göre
    renderCreatorSocials(cr);

    // Skin: Tüm Ekip modunda bölümün tamamı (başlık, yazılar, kapsayıcı) gizlenir
    var skinSection = byId('skin-section');
    if (creatorId === 'all') {
      if (skinSection) skinSection.classList.add('hidden');
    } else {
      if (skinSection) skinSection.classList.remove('hidden');
      if (window.SkinViewerModule && typeof window.SkinViewerModule.setSkin === 'function') {
        window.SkinViewerModule.setSkin(cr.skinUrl, {});
      }
    }

    // Video modülü
    if (window.VideoGalleryModule && typeof window.VideoGalleryModule.setChannels === 'function') {
      window.VideoGalleryModule.setChannels(channels, cr.keywords || []);
    }

    // Klip modülü: aktif yayıncıya göre klipleri filtrele/dinle
    if (window.ClipsModule && typeof window.ClipsModule.setActiveStreamer === 'function') {
      window.ClipsModule.setActiveStreamer(creatorId);
    }

    markActiveCreatorItem();
  }

  /* ---------- Dropdown ---------- */
  function swatchInitials(name) {
    return String(name || '?').trim().split(/\s+/).map(function (w) {
      return w.charAt(0).toUpperCase();
    }).slice(0, 2).join('') || '?';
  }

  function buildCreatorList() {
    var list = byId('creator-list');
    if (!list) return;
    list.innerHTML = '';

    var creators = (cfg && cfg.creators) || {};
    Object.keys(creators).forEach(function (id) {
      var cr = creators[id];
      if (!cr) return;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'creator-item' + (activeCreatorId === id ? ' active' : '');
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', String(activeCreatorId === id));
      btn.dataset.creator = id;

      // Profil resmi: avatarUrl → avatars/{id} → fallback → baş harfler ("all" → "TE")
      var avatar = document.createElement('span');
      avatar.className = 'creator-swatch avatar-swatch';
      if (cr.colorTheme && cr.colorTheme.gradient) avatar.style.background = cr.colorTheme.gradient;
      avatar.textContent = swatchInitials(cr.name);

      var avatarCandidates = [];
      if (cr.avatarUrl) avatarCandidates.push(cr.avatarUrl);
      localAvatarCandidates(id).forEach(function (u) { avatarCandidates.push(u); });
      if (cfg.siteInfo && cfg.siteInfo.fallbackAvatar) avatarCandidates.push(cfg.siteInfo.fallbackAvatar);

      var avatarIdx = 0;
      var setSwatchImg = function (url) {
        var im = new Image();
        im.className = 'swatch-img';
        im.alt = '';
        im.src = url;
        avatar.textContent = '';
        avatar.appendChild(im);
      };
      var trySwatch = function () {
        if (avatarIdx >= avatarCandidates.length) return; // baş harfler kalsın
        var url = avatarCandidates[avatarIdx++];
        var probe = new Image();
        probe.onload = function () { setSwatchImg(url); };
        probe.onerror = function () { trySwatch(); };
        probe.src = url;
      };
      trySwatch();

      var info = document.createElement('span');
      info.className = 'creator-info';

      var name = document.createElement('span');
      name.className = 'creator-name';
      name.textContent = cr.name;

      var badge = document.createElement('span');
      badge.className = 'creator-badge-chip';
      badge.textContent = cr.badge || '';

      info.appendChild(name);
      info.appendChild(badge);

      var check = document.createElement('i');
      check.className = 'fa-solid fa-check creator-check';

      btn.appendChild(avatar);
      btn.appendChild(info);
      btn.appendChild(check);

      btn.addEventListener('click', function () {
        selectCreator(id);
      });

      list.appendChild(btn);
    });
  }

  function markActiveCreatorItem() {
    var items = document.querySelectorAll('#creator-list .creator-item');
    items.forEach(function (btn) {
      var on = btn.getAttribute('data-creator') === activeCreatorId;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', String(on));
    });
  }

  function openDropdown() {
    var wrap = byId('creator-dropdown-wrap');
    var dd = byId('creator-dropdown');
    var brand = byId('brand-home');
    if (!dd) return;
    buildCreatorList();
    dd.classList.remove('hidden');
    if (wrap) wrap.classList.add('open');
    if (brand) brand.setAttribute('aria-expanded', 'true');
  }

  function closeDropdown() {
    var wrap = byId('creator-dropdown-wrap');
    var dd = byId('creator-dropdown');
    var brand = byId('brand-home');
    if (!dd) return;
    dd.classList.add('hidden');
    if (wrap) wrap.classList.remove('open');
    if (brand) brand.setAttribute('aria-expanded', 'false');
  }

  function toggleDropdown() {
    var dd = byId('creator-dropdown');
    if (!dd) return;
    if (dd.classList.contains('hidden')) openDropdown();
    else closeDropdown();
  }

  function wireDropdown() {
    var brand = byId('brand-home');
    if (brand) {
      brand.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleDropdown();
      });
    }
    document.addEventListener('click', function (e) {
      var wrap = byId('creator-dropdown-wrap');
      if (wrap && !wrap.contains(e.target)) closeDropdown();
    });
  }

  function selectCreator(id) {
    if (!cfg || !cfg.creators || !cfg.creators[id]) id = (cfg && cfg.siteInfo && cfg.siteInfo.defaultCreator) || 'all';
    if (!cfg.creators[id]) id = 'all';
    try { localStorage.setItem(LS_CREATOR, id); } catch (e) { /* yok say */ }
    applyCreator(id);
    showView('home');
    closeDropdown();
  }

  /* ---------- SPA görünüm yönetimi ---------- */
  function showView(name) {
    if (VIEW_NAMES.indexOf(name) === -1) name = 'home';

    VIEW_NAMES.forEach(function (v) {
      var el = byId('view-' + v);
      if (el) el.classList.toggle('hidden', v !== name);
    });

    document.querySelectorAll('[data-view]').forEach(function (btn) {
      var active = btn.getAttribute('data-view') === name;
      btn.classList.toggle('active', active);
      if (active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });

    if (name === 'clips' && window.ClipsModule && typeof window.ClipsModule.onShow === 'function') {
      window.ClipsModule.onShow();
    }
    if (name === 'videos' && window.VideoGalleryModule && typeof window.VideoGalleryModule.onShow === 'function') {
      window.VideoGalleryModule.onShow();
    }

    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function wireNavigation() {
    document.querySelectorAll('[data-view]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showView(btn.getAttribute('data-view'));
      });
    });
  }

  /* ---------- Hata ekranı ---------- */
  function showConfigError(err) {
    var overlay = byId('config-error');
    var msg = byId('config-error-msg');
    if (!overlay) return;

    var why = 'config.json bulunamadı veya parse edilemedi.';
    if (err) {
      if (err instanceof SyntaxError) {
        why = 'config.json geçersiz JSON: ' + err.message;
      } else if (err.message && err.message.indexOf('HTTP') === 0) {
        why = 'config.json alınamadı (' + err.message + ').';
      } else {
        why = err.message || why;
      }
    }
    if (msg) msg.textContent = why;
    overlay.classList.remove('hidden');

    var retry = byId('config-error-retry');
    if (retry) {
      retry.addEventListener('click', function () {
        overlay.classList.add('hidden');
        bootstrap();
      });
    }
  }

  /* ---------- Ana başlatıcı ---------- */
  async function bootstrap() {
    try {
      var res = await fetch('config.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      cfg = await res.json();

      var info = cfg.siteInfo || {};
      applySiteInfo(info);

      var defaultCreator = info.defaultCreator || 'all';
      try {
        var saved = localStorage.getItem(LS_CREATOR);
        if (saved && cfg.creators && cfg.creators[saved]) defaultCreator = saved;
      } catch (e) { /* yok say */ }
      if (!cfg.creators || !cfg.creators[defaultCreator]) defaultCreator = 'all';

      if (window.SkinViewerModule && typeof window.SkinViewerModule.init === 'function') {
        // Tüm Ekip başlangıcında skin yüklenmez (görüntüleyici gizli kalır)
        var starter = cfg.creators[defaultCreator] || {};
        window.SkinViewerModule.init({
          textureUrl: defaultCreator === 'all' ? '' : (starter.skinUrl || 'skins/peach.png'),
          autoWalk: false
        });
      }
      if (window.ClipsModule) {
        window.ClipsModule.init(cfg.firebase || {});
      }
      if (window.VideoGalleryModule && typeof window.VideoGalleryModule.init === 'function') {
        window.VideoGalleryModule.init(cfg, info);
      }

      // Klip modülüne yayıncı etiket haritasını (config.creators) tanıt
      if (window.ClipsModule && typeof window.ClipsModule.setStreamers === 'function') {
        window.ClipsModule.setStreamers(cfg.creators);
      }

      buildCreatorList();
      wireDropdown();
      applyCreator(defaultCreator);
    } catch (err) {
      console.error('[Yusufte Universe] config.json yüklenemedi:', err);
      showConfigError(err);
    }
  }

  function applySiteInfo(info) {
    if (!info) return;
    if (info.title) {
      var brand = byId('nav-brand');
      if (brand) brand.textContent = info.title;
      var words = String(info.title).trim().split(/\s+/);
      titleMain = (words[0] || 'Yusufte').toUpperCase();
    }
    var sub = byId('hero-subtitle');
    if (sub && info.subtitle) sub.textContent = info.subtitle;
    var foot = byId('footer-brand');
    if (foot) foot.textContent = titleMain;
  }

  var yearEl = byId('footer-year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  wireNavigation();
  bootstrap();
})();