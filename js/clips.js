/* ============================================================
   YUSUFTE UNIVERSE - js/clips.js
   Topluluk Klipleri modülü (Firebase Firestore)
   - config.json > firebase ile başlatılır
   - clips koleksiyonu: ekle / düzenle / sil / listele / beğen / izlenme
   - start/end saniye zorlaması (YouTube IFrame API)
   - aranılan + sıralama; localStorage korumaları
   ============================================================ */
(function () {
  'use strict';

  var LS_CREATED = 'my_created_clips';
  var LS_LIKED = 'my_liked_clips';
  var LS_VIEWED = 'my_viewed_clips';

  // "Tüm Ekip" bölgesinde oluşturulan kliplerin streamerId'si.
  // Diğer yayıncılardan ayrı bir kategori olarak saklanır ve yalnızca
  // TE (Tüm Ekip) görünümündeki "TE Ekip Klipleri" sekmesinde özel listelenir.
  var TE_STREAMER_ID = 'te';

  var grid = document.getElementById('clips-grid');
  var tabsEl = document.getElementById('clips-tabs');
  var statusEl = document.getElementById('clips-status');
  var warningEl = document.getElementById('clips-config-warning');
  var createBtn = document.getElementById('clip-create-btn');
  var clipModal = document.getElementById('clip-modal');
  var clipForm = document.getElementById('clip-form');
  var formMsg = document.getElementById('clip-form-msg');
  var modalTitle = document.getElementById('clip-modal-title-text');
  var submitLabel = document.getElementById('clip-form-submit-label');

  var searchInput = document.getElementById('clip-search-input');
  var sortSelect = document.getElementById('clip-sort-select');

  var videoModal = document.getElementById('video-modal');
  var videoFrame = document.getElementById('video-modal-frame');
  var videoTitle = document.getElementById('video-modal-title');

  // Özel klip kontrol barı
  var playerControls = document.getElementById('custom-player-controls');
  var cpcPlay = document.getElementById('cpc-play');
  var cpcTime = document.getElementById('cpc-time');
  var cpcProgress = document.getElementById('cpc-progress');
  var cpcFill = document.getElementById('cpc-progress-fill');
  var cpcFull = document.getElementById('cpc-fullscreen');
  var clipPlaying = false;

  var db = null;
  var activeTab = 'all';
  var editingClipId = null;
  var allClips = [];
  var myCreated = readLs(LS_CREATED);
  var myLiked = readLs(LS_LIKED);
  var myViewed = readLs(LS_VIEWED);

  var clipPlayer = null;      // aktif klip oynatıcısı (YT IFrame API)
  var clipTimer = null;       // endTime denetim zamanlayıcısı
  var clipStartT = 0;
  var clipEndT = 0;

  // Yayıncı tabanlı ayrıştırma: aktif yayıncı kimliği ('all' = Tüm Ekip),
  // config.creators etiket haritası ve canlı sorgu için unsubscribe tutamacı.
  var activeStreamerId = 'all';
  var streamersMap = null;
  var clipsUnsubscribe = null;

  /* ---------- Yardımcılar ---------- */
  function readLs(key) {
    try {
      var v = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }

  function writeLs(key, arr) {
    try {
      localStorage.setItem(key, JSON.stringify(arr));
    } catch (e) { /* yok say */ }
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderStatus(msg) {
    if (!statusEl) return;
    statusEl.textContent = msg;
  }

  /* Yayıncı kimliğinden görünen ad çözümleme (config.creators.*.name). */
  function streamerLabel(id) {
    if (!id) return '';
    if (id === TE_STREAMER_ID) return 'TE Ekibi';
    if (streamersMap && streamersMap[id]) return streamersMap[id].name || id;
    return id;
  }

  /* "Klip Oluştur" butonu durumu: yalnızca Firebase hazırken etkindir.
     "Tüm Ekip" bölgesinde de TE Ekip klibi oluşturulabildiği için ayrı
     bir yayıncı seçme şartı aranmaz. */
  function updateCreateButton() {
    if (!createBtn) return;
    createBtn.disabled = !db;
    createBtn.title = '';
  }

  function showWarning(msg) {
    if (!warningEl) return;
    warningEl.textContent = '';
    var i = document.createElement('i');
    i.className = 'fa-solid fa-triangle-exclamation mr-1.5 text-peach';
    warningEl.appendChild(i);
    warningEl.appendChild(document.createTextNode(msg));
    warningEl.classList.remove('hidden');
    if (createBtn) createBtn.disabled = true;
    renderStatus('Klip modülü şu an kullanılamıyor.');
  }

  function fmtViews(n) {
    n = Number(n) || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.', ',') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace('.', ',') + 'K';
    return String(n);
  }

  function fmtDate(val) {
    if (!val) return '';
    try {
      var date = val.toMillis ? val.toMillis() : new Date(val).getTime();
      return new Date(date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) {
      return '';
    }
  }

  /* ---------- YouTube video ID çözümleme ---------- */
  function parseVideoId(input) {
    var str = String(input || '').trim();
    if (!str) return null;

    var bare = str.match(/^([\w-]{11})$/);
    if (bare) return bare[1];

    var m = str.match(/youtu\.be\/([\w-]{11})/);
    if (m) return m[1];

    m = str.match(/youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/)([\w-]{11})/);
    if (m) return m[1];

    m = str.match(/youtube\.com\/(?:v|e)\/([\w-]{11})/);
    return m ? m[1] : null;
  }

  /* Klip dokümanını çözme: yalnızca YouTube
     (youtubeVideoId / videoId / saklanmış kaynak URL).
     Dönüş: { ytId, watchUrl, hasVideo } */
  function getClipVideoInfo(clip) {
    clip = clip || {};
    var rawUrl = String(clip.sourceUrl || clip.videoUrl || clip.url || clip.video || '').trim();
    var ytId = String(clip.youtubeVideoId || clip.videoId || '').trim();
    if (!ytId && /(youtube\.com|youtu\.be)/i.test(rawUrl)) {
      ytId = parseVideoId(rawUrl) || '';
    }
    var watchUrl = ytId
      ? 'https://www.youtube.com/watch?v=' + encodeURIComponent(ytId)
      : ((rawUrl && rawUrl.indexOf('http') === 0) ? rawUrl : '');
    return {
      ytId: ytId,
      watchUrl: watchUrl,
      hasVideo: Boolean(ytId)
    };
  }

  /* ---------- Firebase başlatma ---------- */
  function initFirebase(cfg) {
    if (!cfg || !cfg.projectId || String(cfg.apiKey || '').indexOf('YOUR_') === 0 ||
        String(cfg.projectId || '').indexOf('YOUR_') === 0) {
      showWarning('config.json &raquo; firebase bölümünü doldurun ve dosyayı www yapısına yükleyin.');
      return;
    }
    if (typeof firebase === 'undefined' || !firebase.firestore) {
      showWarning('Firebase kütüphaneleri yüklenemedi (internet bağlantısını kontrol edin).');
      return;
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(cfg);
      db = firebase.firestore();
      if (firebase.auth) {
        firebase.auth().signInAnonymously().catch(function (err) {
          console.error('Anonim oturum hatası:', err);
        });
      }
      listen();
    } catch (err) {
      showWarning('Firebase başlatılamadı: ' + (err.message || err));
    }
  }

  /* ---------- Canlı liste (yayıncı filtreli) ---------- */
  function listen() {
    if (!db) return;
    if (clipsUnsubscribe) {
      clipsUnsubscribe();
      clipsUnsubscribe = null;
    }

    renderStatus('Klipler yükleniyor...');
    allClips = [];

    // "Tüm Ekip" (all): bütün klipler çekilir.
    // Belirli bir yayıncı: streamerId == aktif yayıncı ile filtreli sorgu.
    // Not: where + orderBy bileşik sorgu Firestore'da ek index gerektirir;
    // sıralama client tarafında visibleClips()/sortClips() ile sağlanır.
    var query;
    if (activeStreamerId === 'all') {
      query = db.collection('clips').orderBy('createdAt', 'desc');
    } else {
      query = db.collection('clips').where('streamerId', '==', activeStreamerId);
    }

    clipsUnsubscribe = query.onSnapshot(function (snap) {
      allClips = [];
      snap.forEach(function (doc) {
        allClips.push(Object.assign({ id: doc.id }, doc.data()));
      });
      renderStatus(allClips.length ? '' : 'Henüz klip yok — ilk klibi sen oluştur!');
      buildTabs();
      renderGrid();
    }, function (err) {
      renderStatus('Klipler alınamadı: ' + (err.message || err));
    });
  }

  /* ---------- Sekmeler ---------- */
  function buildTabs() {
    if (!tabsEl) return;
    tabsEl.innerHTML = '';

    var tabs = [{ key: 'all', label: '<i class="fa-solid fa-layer-group mr-1.5"></i>Tüm Klipler' }];
    // "Tüm Ekip" bölgesi: TE'ye özel klipler için ayrı sekme (butun klipler ana sekmede)
    if (activeStreamerId === 'all') {
      tabs.push({ key: 'te', label: '<i class="fa-solid fa-users mr-1.5"></i>TE Ekibi Klipleri' });
    }
    tabs.push({ key: 'mine', label: '<i class="fa-solid fa-user mr-1.5"></i>Kendi Kliplerim' });

    tabs.forEach(function (tab) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab-btn' + (activeTab === tab.key ? ' active' : '');
      btn.innerHTML = tab.label;
      if (tab.key === 'mine' && myCreated.length) {
        var badge = document.createElement('span');
        badge.className = 'ml-1.5 text-xs';
        badge.textContent = '(' + myCreated.length + ')';
        btn.appendChild(badge);
      }
      btn.addEventListener('click', function () {
        if (activeTab === tab.key) return;
        activeTab = tab.key;
        buildTabs();
        renderGrid();
      });
      tabsEl.appendChild(btn);
    });
  }

  /* ---------- Liste render (arama + sıralama) ---------- */
  function tsOf(c) {
    var v = c.createdAt;
    if (!v) return 0;
    if (typeof v.toMillis === 'function') return v.toMillis();
    var n = Date.parse(v);
    return isNaN(n) ? 0 : n;
  }

  function getSortMode() {
    return sortSelect ? sortSelect.value : 'newest';
  }

  function getSearchQuery() {
    return searchInput ? searchInput.value.trim().toLowerCase() : '';
  }

  function sortClips(a, b) {
    switch (getSortMode()) {
      case 'likes': return (Number(b.likes) || 0) - (Number(a.likes) || 0);
      case 'views': return (Number(b.views) || 0) - (Number(a.views) || 0);
      case 'oldest': return tsOf(a) - tsOf(b);
      default: return tsOf(b) - tsOf(a); // newest
    }
  }

  function visibleClips() {
    var q = getSearchQuery();

    var list = allClips.filter(function (c) {
      if (activeTab === 'te' && String(c.streamerId || '') !== TE_STREAMER_ID) return false;
      if (activeTab === 'mine' && myCreated.indexOf(c.id) === -1) return false;
      if (!q) return true;
      var hay = ((c.title || '') + ' ' + (c.username || '') + ' ' +
        (c.youtubeVideoId || '') + ' ' + (c.videoId || '') + ' ' +
        (c.streamerId || '')).toLowerCase();
      return hay.indexOf(q) !== -1;
    });

    list.sort(sortClips);
    return list;
  }

  function renderGrid() {
    if (!grid) return;
    var items = visibleClips();
    if (!items.length) {
      grid.innerHTML = '<div class="col-span-full text-center text-white/40 text-sm mt-2">' +
        (activeTab === 'mine' ? 'Henüz kendi klibini oluşturmadın.' :
         activeTab === 'te' ? 'Henüz TE Ekibi klibi yok — ilk TE klibini sen oluştur!' :
         'Gösterilecek klip yok.') +
        '</div>';
      return;
    }
    grid.innerHTML = '';
    items.forEach(function (clip) {
      grid.appendChild(buildCard(clip));
    });
  }

  /* ---------- Klip kartı ---------- */
  function buildCard(clip) {
    var info = getClipVideoInfo(clip);
    var ytId = info.ytId;
    var videoId = escapeHtml(ytId);
    var watchUrl = info.watchUrl;
    var id = escapeHtml(clip.id);
    var title = escapeHtml(clip.title || '');
    var username = escapeHtml(clip.username || '');
    var thumb = ytId
      ? 'https://i.ytimg.com/vi/' + encodeURIComponent(ytId) + '/mqdefault.jpg'
      : '';
    var thumbHtml = thumb ? '<img src="' + thumb + '" alt="" loading="lazy">' : '';
    var duration = (Number(clip.startTime) || 0) + '-' + (Number(clip.endTime) || 0) + ' sn';
    var liked = myLiked.indexOf(clip.id) !== -1;
    var owned = myCreated.indexOf(clip.id) !== -1;
    var views = fmtViews(clip.views);
    var likesTxt = fmtViews(clip.likes);
    var dateStr = fmtDate(clip.createdAt);
    var sourceTxt = videoId
      ? 'Kaynak: ' + videoId
      : (watchUrl ? 'Kaynak: bağlantı' : 'Kaynak video yok');

    var ownerActions = owned
      ? '<div class="clip-owner-actions">' +
          '<button type="button" class="clip-owner-btn" data-action="edit" title="Düzenle" aria-label="Düzenle"><i class="fa-solid fa-pen"></i></button>' +
          '<button type="button" class="clip-owner-btn clip-owner-btn-danger" data-action="delete" title="Sil" aria-label="Sil"><i class="fa-solid fa-trash-can"></i></button>' +
        '</div>'
      : '';

    var likeBtnTitle = owned ? 'Kendi klibinizi beğenemezsiniz' : 'Beğen';
    var likeBtnDisabled = owned ? ' disabled' : '';

    // Yayıncı bölgesi rozeti: yalnızca "Tüm Ekip" görünümünde gösterilir
    // (belirli bir yayıncı bölgesinde tüm kartlar zaten o yayıncıya aittir).
    var streamerHtml = '';
    var clipStreamerId = String(clip.streamerId || '').trim();
    if (activeStreamerId === 'all' && clipStreamerId) {
      var streamerName = escapeHtml(streamerLabel(clipStreamerId));
      streamerHtml = '<p class="clip-streamer" title="' + streamerName +
        '"><i class="fa-solid fa-user-group mr-1"></i>' + streamerName + '</p>';
    }

    var card = document.createElement('article');
    card.className = 'clip-card';
    card.setAttribute('data-id', id);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    card.innerHTML =
      '<div class="clip-thumb">' +
        thumbHtml +
        '<span class="clip-platform-badge youtube"><i class="fa-brands fa-youtube mr-1"></i>YOUTUBE</span>' +
        '<span class="clip-duration">' + duration + '</span>' +
        '<span class="play-overlay"><span class="play-btn"><i class="fa-solid fa-play"></i></span></span>' +
        ownerActions +
      '</div>' +
      '<div class="clip-info">' +
        '<h3>' + title + '</h3>' +
        '<p class="clip-username"><i class="fa-solid fa-circle-user mr-1"></i>' + username + '</p>' +
        streamerHtml +
        '<div class="clip-actions">' +
          '<button type="button" class="clip-like-btn' + (liked ? ' liked' : '') + (owned ? ' own-disabled' : '') + '"' +
            ' aria-label="Beğen" aria-pressed="' + (liked ? 'true' : 'false') + '" title="' + likeBtnTitle + '"' + likeBtnDisabled + '>' +
            '<i class="fa-solid fa-heart"></i><span class="like-count">' + likesTxt + '</span>' +
          '</button>' +
          (dateStr ? '<span class="clip-date">' + dateStr + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="clip-stats-bar">' +
        '<span class="cstat"><i class="fa-solid fa-eye"></i>' + views + '</span>' +
        '<span class="cstat"><i class="fa-solid fa-heart"></i>' + likesTxt + '</span>' +
        '<span class="cstat clip-source" title="' + (watchUrl || '') + '">' +
          '<i class="fa-solid fa-video"></i>' +
          (watchUrl
            ? '<a href="' + watchUrl + '" target="_blank" rel="noopener">' + sourceTxt + '</a>'
            : '<span>' + sourceTxt + '</span>') +
        '</span>' +
      '</div>';

    card.addEventListener('click', function (e) {
      if (e.target.closest('.clip-like-btn') ||
          e.target.closest('.clip-owner-actions') ||
          e.target.closest('a')) return;
      openClip(clip);
    });
    card.addEventListener('keydown', function (e) {
      if (e.target !== card) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openClip(clip);
      }
    });

    var likeBtn = card.querySelector('.clip-like-btn');
    likeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      likeClip(clip, likeBtn);
    });

    card.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (btn.getAttribute('data-action') === 'edit') openEditModal(clip);
        else deleteClip(clip);
      });
    });

    return card;
  }

  /* ---------- Beğen (kalp toggle, 0 altına düşmez, kendi klibi engelli) ---------- */
  function likeClip(clip, btn) {
    if (!db) return;
    if (myCreated.indexOf(clip.id) !== -1) return; // kendi klibi beğenilemez

    var idx = myLiked.indexOf(clip.id);
    var isLiked = idx !== -1;
    var delta = isLiked ? -1 : 1;

    if (isLiked) myLiked.splice(idx, 1);
    else myLiked.push(clip.id);
    writeLs(LS_LIKED, myLiked);

    btn.classList.toggle('liked', !isLiked);
    btn.setAttribute('aria-pressed', String(!isLiked));
    btn.disabled = false;

    var countEl = btn.querySelector('.like-count');
    if (countEl) {
      var base = Math.max(0, Number(clip.likes) || 0);
      countEl.textContent = fmtViews(Math.max(0, base + delta));
    }

    var ref = db.collection('clips').doc(clip.id);
    db.runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        var cur = snap.exists ? Number(snap.get('likes')) || 0 : 0;
        tx.update(ref, { likes: Math.max(0, cur + delta) });
      });
    }).catch(function (err) {
      showWarning('Beğeni güncellenemedi: ' + (err.message || err));
    });
  }

  /* ---------- YouTube IFrame API geçitleri ---------- */
  function ensureYT(ok, fail) {
    if (window.YT && window.YT.Player) { ok(); return; }
    var tries = 0;
    var iv = setInterval(function () {
      tries += 1;
      if (window.YT && window.YT.Player) {
        clearInterval(iv);
        ok();
        return;
      }
      if (tries >= 60) {
        clearInterval(iv);
        if (fail) fail();
      }
    }, 250);
  }

  function stopClipTimer() {
    if (clipTimer) {
      clearInterval(clipTimer);
      clipTimer = null;
    }
  }

  function resetClipUI() {
    clipPlaying = false;
    if (cpcFill) {
      cpcFill.style.width = '0%';
    }
    if (cpcProgress) cpcProgress.setAttribute('aria-valuenow', '0');
    if (cpcTime) cpcTime.textContent = '0:00 / 0:00';
    if (cpcPlay) cpcPlay.innerHTML = '<i class="fa-solid fa-play"></i>';
  }

  /* YouTube Player'ı tamamen yok et + paylaşılan iframe'i DOM'a yeniden kur.
     destroy() iframe'i sayfadan SİLER; yeniden kurmadan galeri/klip bozulur. */
  function rebuildVideoFrame() {
    var wrap = videoFrame && videoFrame.parentNode
      ? videoFrame.parentNode
      : document.querySelector('#video-modal .video-frame-wrap');
    if (!wrap) return;

    var old = videoFrame;
    if (old && old.parentNode === wrap) {
      wrap.removeChild(old);
    }

    var nb = document.createElement('iframe');
    nb.id = 'video-modal-frame';
    nb.setAttribute('src', '');
    nb.setAttribute('title', 'YouTube video player');
    nb.setAttribute('frameborder', '0');
    nb.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
    nb.setAttribute('allowfullscreen', '');
    nb.style.display = 'block';
    wrap.appendChild(nb);
    videoFrame = nb;
  }

  /* Sıkı yaşam döngüsü temizliği: zamanlayıcıyı durdur, player'ı yok et,
     çubuğu sıfırla, tam ekrandaysa çık. */
  function cleanupClipPlayer() {
    stopClipTimer();

    if (clipPlayer && typeof clipPlayer.destroy === 'function') {
      try { clipPlayer.destroy(); } catch (e) { /* yok say */ }
    }
    clipPlayer = null;

    rebuildVideoFrame();
    resetClipUI();

    var d = document;
    if (d.fullscreenElement || d.webkitFullscreenElement) {
      (d.exitFullscreen || d.webkitExitFullscreen || function () {}).call(d);
    }
    updateFullscreenIcon();
  }

  /* İzlenme sayacı: yalnızca sayaç artırımını engeller, oynatmayı ASLA engellemez */
  function bumpViewCount(clip) {
    if (!db) return;
    if (myViewed.indexOf(clip.id) !== -1) return; // bot engeli — sadece sayaç için
    myViewed.push(clip.id);
    writeLs(LS_VIEWED, myViewed);
    db.collection('clips').doc(clip.id).update({
      views: firebase.firestore.FieldValue.increment(1)
    }).catch(function () { /* başarısız olursa snapshot günceller */ });
  }

  /* ---------- İzle (view + start/end zorlamalı oynatma) ---------- */
  function openClip(clip) {
    cleanupClipPlayer(); // önceki player/zamanlayıcı/tam ekran tamamen temizlenir

    bumpViewCount(clip);

    if (videoTitle) videoTitle.textContent = clip.title || 'Klip';

    if (!videoFrame) return;

    var info = getClipVideoInfo(clip);
    if (!info.hasVideo) return; // ID/URL yoksa oynatılamaz

    openYoutubeClip(clip, info);

    if (videoModal) {
      videoModal.classList.add('open');
      videoModal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }
  }

  /* YouTube klip: start/end zamanlayıcılı özel kontrol barı ile oynatılır. */
  function openYoutubeClip(clip, info) {
    var ytId = (info && info.ytId) || clip.youtubeVideoId || clip.videoId || '';
    if (!ytId) return;

    clipStartT = Math.max(0, Number(clip.startTime) || 0);
    clipEndT = Math.max(0, Number(clip.endTime) || 15);
    if (clipEndT <= clipStartT) clipEndT = clipStartT + 1;

    // controls=0 → YouTube'un 2 saatlik orijinal alt çubuğu gizlenir;
    // yerine aşağıdaki ÖZEL kontrol barı (.custom-player-controls) kullanılır.
    // start/end parametreleri klip sınırlarını, enablejsapi=1 JS denetimini,
    // mute=0 ise ilk oynatmada ses kısılmamasını sağlar.
    videoFrame.src = 'https://www.youtube.com/embed/' + encodeURIComponent(ytId) +
      '?autoplay=1&start=' + clipStartT + '&end=' + clipEndT +
      '&controls=0&enablejsapi=1&mute=0&rel=0';

    clipPlaying = true;
    if (cpcFill) cpcFill.style.width = '0%';
    if (cpcTime) cpcTime.textContent = '0:00 / ' + formatClipSec(clipEndT - clipStartT);
    if (cpcPlay) cpcPlay.innerHTML = '<i class="fa-solid fa-pause"></i>';
    showClipControls();

    ensureYT(function () {
      try {
        // GÖRÜNÜR #video-modal-frame iframe'ine "remote" oynatıcı bağlanır.
        // Önceki örnek cleanupClipPlayer() ile destroy edilip iframe yeniden kurulmuştu.
        clipPlayer = new YT.Player('video-modal-frame', {
          events: {
            onReady: function (event) {
              try { event.target.playVideo(); } catch (e) { /* yok say */ }
            },
            onStateChange: function (event) {
              clipPlaying = (event.data === YT.PlayerState.PLAYING);
              if (cpcPlay) {
                cpcPlay.innerHTML = clipPlaying
                  ? '<i class="fa-solid fa-pause"></i>'
                  : '<i class="fa-solid fa-play"></i>';
              }
              if (clipPlaying) startClipTimer();
              else stopClipTimer();
              if (event.data === YT.PlayerState.ENDED) {
                // Klibin sonu: başa sar ve döngüyü sürdür (klip dışına izin yok)
                try {
                  clipPlayer.seekTo(clipStartT, true);
                  clipPlayer.playVideo();
                } catch (e) { /* yok say */ }
              }
            }
          }
        });
      } catch (e) { /* start/end URL parametreleri zaten aktif */ }
    }, function () {
      /* YT API yüklenemediyse start/end URL parametreleri zaten aktif */ });
  }

  /* ---------- Özel kontrol barı (Custom YouTube Controller) ---------- */
  function formatClipSec(sec) {
    sec = Math.max(0, Math.floor(sec) || 0);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function totalClipSec() {
    return Math.max(1, clipEndT - clipStartT);
  }

  function showClipControls() {
    if (playerControls) playerControls.classList.remove('hidden');
    updateClipUI();
  }

  function hideClipControls() {
    if (playerControls) playerControls.classList.add('hidden');
    clipPlaying = false;
  }

  function updateClipUI() {
    if (!cpcFill && !cpcTime) return;
    var total = totalClipSec();
    var t = 0;
    if (clipPlayer && typeof clipPlayer.getCurrentTime === 'function') {
      try { t = clipPlayer.getCurrentTime(); } catch (e) { /* yok say */ }
    }
    var elapsed = Math.min(total, Math.max(0, t - clipStartT));
    var pct = total > 0 ? (elapsed / total) * 100 : 0;
    if (cpcFill) cpcFill.style.width = pct + '%';
    if (cpcProgress) {
      cpcProgress.setAttribute('aria-valuenow', String(Math.round(pct)));
    }
    if (cpcTime) cpcTime.textContent = formatClipSec(elapsed) + ' / ' + formatClipSec(total);
  }

  function seekFromEvent(e) {
    if (!clipPlayer || !cpcProgress) return;
    var rect = cpcProgress.getBoundingClientRect();
    if (!rect.width) return;
    var ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    var target = Math.min(clipEndT, Math.max(clipStartT, clipStartT + ratio * totalClipSec()));
    try { clipPlayer.seekTo(target, true); } catch (err) { return; }
    updateClipUI();
  }

  function toggleClipFullscreen() {
    var box = document.querySelector('#video-modal .video-modal-box');
    var d = document;
    if (!box) return;
    var isFs = d.fullscreenElement || d.webkitFullscreenElement;
    if (isFs) {
      (d.exitFullscreen || d.webkitExitFullscreen || function () {}).call(d);
    } else {
      (box.requestFullscreen || box.webkitRequestFullscreen || function () {}).call(box);
    }
  }

  function updateFullscreenIcon() {
    if (!cpcFull) return;
    var d = document;
    var isFs = d.fullscreenElement || d.webkitFullscreenElement;
    cpcFull.innerHTML = isFs
      ? '<i class="fa-solid fa-compress"></i>'
      : '<i class="fa-solid fa-expand"></i>';
  }

  /* Senkronize zamanlayıcı + döngü: YALNIZCA PLAYING iken çalışır (onStateChange başlatır) */
  function startClipTimer() {
    stopClipTimer();
    clipTimer = setInterval(function () {
      if (!clipPlayer || typeof clipPlayer.getCurrentTime !== 'function') return;
      var t;
      try { t = clipPlayer.getCurrentTime(); } catch (e) { return; }
      if (isNaN(t)) return;

      // Saniye kısıtlaması: klip dışına çıkma → anında başa sar
      if (t >= clipEndT || t < clipStartT) {
        try { clipPlayer.seekTo(clipStartT, true); } catch (e) { /* yok say */ }
        return;
      }

      var elapsed = t - clipStartT;
      var duration = totalClipSec();
      var pct = Math.min(100, Math.max(0, (elapsed / duration) * 100));
      if (cpcFill) cpcFill.style.width = pct + '%';
      if (cpcProgress) cpcProgress.setAttribute('aria-valuenow', String(Math.round(pct)));
      if (cpcTime) cpcTime.textContent = formatClipSec(elapsed) + ' / ' + formatClipSec(duration);
    }, 150);
  }

  function closeVideoPlayer() {
    // Klip aktifse tam temizlik (destroy + iframe yeniden kurulum + tam ekran çıkışı).
    // Galeri videosu kapatılırken SADECE modalı kapat — galerinin iframe'ini bozma.
    if (clipPlayer || clipTimer) {
      cleanupClipPlayer();
    } else {
      stopClipTimer();
      if (videoFrame) videoFrame.src = '';
    }

    hideClipControls();
    if (videoModal) {
      videoModal.classList.remove('open');
      videoModal.setAttribute('aria-hidden', 'true');
    }
    document.body.style.overflow = '';
  }

  /* ---------- Klip oluşturma modalı ---------- */
  function openClipModal() {
    editingClipId = null;
    if (modalTitle) modalTitle.textContent = 'Yeni Klip Oluştur';
    if (submitLabel) submitLabel.textContent = 'Klibi Kaydet';
    if (clipForm) clipForm.reset();
    if (formMsg) formMsg.textContent = '';
    var submitBtn = clipForm ? clipForm.querySelector('button[type="submit"]') : null;
    if (submitBtn) submitBtn.disabled = false;

    var note = document.getElementById('clip-streamer-note');
    if (note) {
      // Tüm Ekip bölgesinde klip TE Ekip klibi olarak kaydedilir.
      var region = (activeStreamerId === 'all')
        ? streamerLabel(TE_STREAMER_ID)
        : streamerLabel(activeStreamerId);
      note.innerHTML = '<i class="fa-solid fa-user-tag mr-1"></i>Klip bölgesi: <strong>' +
        escapeHtml(region) + '</strong>';
    }

    if (!clipModal) return;
    clipModal.classList.add('open');
    clipModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    var first = document.getElementById('clip-username');
    if (first) setTimeout(function () { first.focus(); }, 60);
  }

  function openEditModal(clip) {
    editingClipId = clip.id;
    if (modalTitle) modalTitle.textContent = 'Klibi Düzenle';
    if (submitLabel) submitLabel.textContent = 'Güncelle';
    if (formMsg) formMsg.textContent = '';
    var submitBtn = clipForm ? clipForm.querySelector('button[type="submit"]') : null;
    if (submitBtn) submitBtn.disabled = false;

    var set = function (id, val) {
      var el = document.getElementById(id);
      if (el) el.value = val == null ? '' : val;
    };
    set('clip-username', clip.username);
    set('clip-title', clip.title);
    set('clip-video', clip.youtubeVideoId || clip.videoId || '');
    set('clip-start', clip.startTime);
    set('clip-end', clip.endTime);

    var note = document.getElementById('clip-streamer-note');
    if (note) {
      var editSid = String(clip.streamerId || '').trim();
      note.innerHTML = editSid
        ? '<i class="fa-solid fa-user-tag mr-1"></i>Klip bölgesi: <strong>' +
          escapeHtml(streamerLabel(editSid)) + '</strong> (değiştirilemez)'
        : '<i class="fa-solid fa-circle-exclamation mr-1"></i>Bu klip henüz bir yayıncıya bağlı değil.';
    }

    if (!clipModal) return;
    clipModal.classList.add('open');
    clipModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    var first = document.getElementById('clip-title');
    if (first) setTimeout(function () { first.focus(); }, 60);
  }

  function closeClipModal() {
    editingClipId = null;
    var submitBtn = clipForm ? clipForm.querySelector('button[type="submit"]') : null;
    if (submitBtn) submitBtn.disabled = false;
    if (!clipModal) return;
    clipModal.classList.remove('open');
    clipModal.setAttribute('aria-hidden', 'true');
    if (!videoModal || !videoModal.classList.contains('open')) {
      document.body.style.overflow = '';
    }
  }

  /* ---------- Kendi klibini silme ---------- */
  function deleteClip(clip) {
    if (!db) return;
    if (!window.confirm('Bu klibi kalıcı olarak silmek istediğine emin misin?')) return;

    db.collection('clips').doc(clip.id).delete().then(function () {
      removeFromLs(LS_CREATED, clip.id);
      removeFromLs(LS_LIKED, clip.id);
      removeFromLs(LS_VIEWED, clip.id);
      renderStatus('Klip silindi.');
    }).catch(function (err) {
      showWarning('Klibin silinemediği bir sorun oluştu: ' + (err.message || err));
    });
  }

  function removeFromLs(key, clipId) {
    var arr = readLs(key);
    var i = arr.indexOf(clipId);
    if (i !== -1) {
      arr.splice(i, 1);
      writeLs(key, arr);
    }
    if (key === LS_CREATED) myCreated = arr;
    else if (key === LS_LIKED) myLiked = arr;
    else if (key === LS_VIEWED) myViewed = arr;
  }

  function setFormError(msg) {
    if (!formMsg) return;
    formMsg.textContent = msg;
  }

  function fieldVal(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  function saveClip(data, submitBtn) {
    if (editingClipId) {
      db.collection('clips').doc(editingClipId).update(data).then(function () {
        if (submitBtn) submitBtn.disabled = false;
        editingClipId = null;
        clipForm.reset();
        closeClipModal();
        renderStatus('Klip güncellendi.');
      }).catch(function (err) {
        setFormError('Klip güncellenemedi: ' + (err.message || err));
        if (submitBtn) submitBtn.disabled = false;
      });
      return;
    }

    data.likes = 0;
    data.views = 0;
    data.createdAt = firebase.firestore.FieldValue.serverTimestamp();

    db.collection('clips').add(data).then(function (ref) {
      if (submitBtn) submitBtn.disabled = false;
      myCreated.push(ref.id);
      writeLs(LS_CREATED, myCreated);
      myLiked.push(ref.id);
      writeLs(LS_LIKED, myLiked);
      clipForm.reset();
      closeClipModal();
      renderStatus('Klip eklendi! Toplulukla paylaşıldı.');
      activeTab = 'mine';
      buildTabs();
      renderGrid();
    }).catch(function (err) {
      setFormError('Klibin kaydedilemediği bir sorun oluştu: ' + (err.message || err));
      if (submitBtn) submitBtn.disabled = false;
    });
  }

  // Yayıncı guardrail: galeri listesinde veya başlıkta/channelId'de
  // aktif yayıncının anahtar kelimesi eşleşmesi aranır.
  function saveClipAfterValidation(videoId, data, submitBtn) {
    if (window.VideoGalleryModule && typeof window.VideoGalleryModule.validateCreatorVideo === 'function') {
      window.VideoGalleryModule.validateCreatorVideo(videoId).then(function (ok) {
        if (!ok) {
          // Tüm Ekip: config.json → creators.all.keywords temasına göre kabul.
          setFormError(activeStreamerId === 'all'
            ? "Bu video TE Ekibi kriterlerine uymuyor: ekip anahtar kelimeleri (config.json → creators.all.keywords) eşleşmiyor veya video ekip kanallarında bulunamıyor."
            : "Yalnızca aktif yayıncının kanallarındaki videolardan veya başlığında ilgili kelimeler geçen videolardan klip oluşturabilirsiniz.");
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
        saveClip(data, submitBtn);
      }).catch(function () {
        setFormError('Video doğrulanırken bir sorun oluştu, lütfen tekrar deneyin.');
        if (submitBtn) submitBtn.disabled = false;
      });
      return;
    }
    saveClip(data, submitBtn);
  }

  function submitClip(e) {
    e.preventDefault();
    if (!db) return;

    var username = fieldVal('clip-username');
    var title = fieldVal('clip-title');
    var videoInput = fieldVal('clip-video');
    var start = parseInt(fieldVal('clip-start'), 10);
    var end = parseInt(fieldVal('clip-end'), 10);

    if (!username) return setFormError('Kullanıcı adı boş olamaz.');
    if (!title) return setFormError('Klip başlığı boş olamaz.');
    var videoId = parseVideoId(videoInput);
    if (!videoId) return setFormError('Geçerli bir YouTube URL veya Video ID girin.');
    if (isNaN(start) || start < 0) return setFormError('Başlangıç saniyesi geçersiz.');
    if (isNaN(end) || end <= start) return setFormError('Bitiş saniyesi başlangıçtan büyük olmalı.');

    setFormError('');
    var submitBtn = clipForm.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    var data = {
      username: username,
      title: title,
      youtubeVideoId: videoId,
      startTime: start,
      endTime: end,
      // Tüm Ekip bölgesinde TE Ekip klibi olarak, belirli yayıncıda ise
      // o yayıncının klibi olarak kaydedilir.
      streamerId: activeStreamerId === 'all' ? TE_STREAMER_ID : activeStreamerId
    };
    // Düzenlemede bölge (streamerId) kayıttaki haliyle korunur—başka
    // yayıncıya taşınması engellenir.
    if (editingClipId) delete data.streamerId;

    var user = firebase.auth().currentUser;
    data.authorUid = user ? user.uid : null;
    // Düzenlemede sahiplik (authorUid) değişmez—orijinal kaydını korur.
    if (editingClipId) delete data.authorUid;

    saveClipAfterValidation(videoId, data, submitBtn);
  }

  /* ---------- Bağlantılar ---------- */
  function wireEvents() {
    if (createBtn) createBtn.addEventListener('click', openClipModal);

    document.querySelectorAll('[data-close-clip-modal]').forEach(function (el) {
      el.addEventListener('click', closeClipModal);
    });

    if (videoModal) {
      videoModal.querySelectorAll('[data-close-modal]').forEach(function (el) {
        el.addEventListener('click', closeVideoPlayer);
      });
    }

    if (clipForm) clipForm.addEventListener('submit', submitClip);

    if (searchInput) searchInput.addEventListener('input', function () { renderGrid(); });
    if (sortSelect) sortSelect.addEventListener('change', function () { renderGrid(); });

    // Özel klip kontrol barı
    if (cpcPlay) {
      cpcPlay.addEventListener('click', function () {
        if (!clipPlayer) return;
        try {
          if (clipPlaying) clipPlayer.pauseVideo();
          else clipPlayer.playVideo();
        } catch (e) { /* yok say */ }
      });
    }
    if (cpcFull) cpcFull.addEventListener('click', toggleClipFullscreen);
    if (cpcProgress) {
      cpcProgress.addEventListener('click', seekFromEvent);
      cpcProgress.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        if (!clipPlayer) return;
        var step = Math.max(1, Math.round(totalClipSec() / 100) || 1);
        var t = 0;
        if (typeof clipPlayer.getCurrentTime === 'function') {
          try { t = clipPlayer.getCurrentTime(); } catch (err) { return; }
        }
        var d = e.key === 'ArrowRight' ? step : -step;
        var target = Math.min(clipEndT, Math.max(clipStartT, t + d));
        try { clipPlayer.seekTo(target, true); } catch (err) { return; }
        updateClipUI();
      });
    }
    document.addEventListener('fullscreenchange', updateFullscreenIcon);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeVideoPlayer();
        closeClipModal();
      }
    });
  }

  /* ---------- Modül API ---------- */
  window.ClipsModule = {
    init: function (firebaseConfig) {
      if (grid || tabsEl) {
        wireEvents();
      }
      initFirebase(firebaseConfig || {});
      updateCreateButton();
      return window.ClipsModule;
    },
    /* Aktif yayıncı/bölge değiştiğinde klipleri o bölgeye göre yeniden dinle. */
    setActiveStreamer: function (id) {
      activeStreamerId = String(id || 'all');
      activeTab = 'all';
      if (db) listen();
      updateCreateButton();
      if (tabsEl) buildTabs();
      if (grid) renderGrid();
      return window.ClipsModule;
    },
    /* config.creators haritası: streamerId → görünen ad (kart rozeti/form notu). */
    setStreamers: function (map) {
      streamersMap = (map && typeof map === 'object') ? map : null;
      return window.ClipsModule;
    },
    onShow: function () {
      if (!db) return;
      updateCreateButton();
      buildTabs();
      renderGrid();
    }
  };
})();