/* ============================================================
   YUSUFTE UNIVERSE - js/video-gallery.js
   Dinamik kanallı video sergisi (YouTube Data API v3)
   Aktif yayıncının config.creators.*.youtubeChannels listesine
   göre kanal video galerisi + klip doğrulama.
   ============================================================ */
(function () {
  'use strict';

  const DEFAULT_PAGE_SIZE = 30;
  const CACHE_TTL_MS = 2 * 60 * 60 * 1000;
  const CACHE_PREFIX = 'yusufte-universe:v2:videos'; // v2: eski oturumlardan kalma
  // yanlış `channel` anahtarına sahip önbellekleri geçersiz kılmak için
  const YT_BASE = 'https://www.googleapis.com/youtube/v3/';

  const tabsEl = document.getElementById('video-tabs');
  const searchInput = document.getElementById('video-search-input');
  const sortSelect = document.getElementById('video-sort-select');
  const grid = document.getElementById('video-grid');
  const moreEl = document.getElementById('video-more');
  const statusEl = document.getElementById('video-status');
  const modal = document.getElementById('video-modal');
  const modalTitle = document.getElementById('video-modal-title');

  let cfg = {};
  let apiKey = '';
  let activeFilter = 'all';
  let visibleCount = 0;
  let pageSize = DEFAULT_PAGE_SIZE;
  let loading = false;
  let statusText = '';
  let channels = {};
  let channelsMap = {};   // id -> { key, label }
  let channelAliases = {}; // canonical UC id / handle -> key (kesin kanal eşleşmesi)
  let channelKeys = [];
  let activeKeywords = [];
  let observer = null;
  let sentinel = null;

  /* ---------- Kanalları kur ---------- */
  function channelLabelFor(id) {
    const c = channelsMap[id];
    return c && c.label ? c.label : (id.charAt(0) === '@' ? id.replace(/^@/, '') : id);
  }

  /* ---------- Keskin (exact / kelime sınırı) eşleşme ----------
     "yusabakal" → "yusabakal2" ile eşleşmez, ancak "YusaBakal" ya da
     "yusabakal anları" ile eşleşir. Türkçe karakterler de kelime karakteri
     olarak kabul edilir. */
  function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function isWordChar(c) {
    if (!c) return false;
    return /[a-z0-9_@.\-\u00e0-\u00ff\u011f\u015f\u0131]/.test(c);
  }

  function keywordMatch(text, query) {
    const q = String(query == null ? '' : query).toLowerCase();
    const t = String(text == null ? '' : text).toLowerCase();
    if (!q) return false;
    if (q === t) return true;
    let sweep = 0;
    let idx;
    while ((idx = t.indexOf(q, sweep)) !== -1) {
      const before = idx > 0 ? t.charAt(idx - 1) : '';
      const after = t.charAt(idx + q.length);
      if (!isWordChar(before) && !isWordChar(after)) return true;
      sweep = idx + q.length;
    }
    return false;
  }

  function makeChannels(list) {
    channels = {};
    channelsMap = {};
    channelAliases = {};
    channelKeys = [];

    (Array.isArray(list) ? list : []).forEach(function (ch, i) {
      const cid = String((ch && ch.id) || (ch && ch.handle) || '').trim();
      if (!cid) return;
      const key = 'ch' + i;
      const handle = String((ch && ch.handle) || '').replace(/^@/, '').trim();
      channels[key] = {
        key: key,
        id: cid,
        handle: handle || (cid.charAt(0) === '@' ? cid.replace(/^@/, '').toLowerCase() : ''),
        label: (ch && ch.name) || cid,
        items: [],
        done: false,
        error: '',
        youtubeId: ''
      };
      channelsMap[cid] = { key: key, label: channels[key].label };
      channelKeys.push(key);
    });
  }

  /* Handle / UC ID fark etmeksizin kesin eşleşme için kanal kimliğini çözer:
     öncelik kanonik UC ID (youtubeId), sonra yapılandırılmış id/handle. */
  function resolveIdentity(ch) {
    const raw = String(ch.youtubeId || ch.id || '').trim();
    if (/^UC[\w-]{22}$/.test(raw)) return { id: raw };
    const forHandle = String(ch.handle || ch.id || '').replace(/^@/, '').trim();
    return { forHandle: forHandle };
  }

  /* ---------- YouTube Data API ---------- */
  function apiCall(endpoint, part, extra, maxResults) {
    const url = YT_BASE + endpoint +
      '?part=' + encodeURIComponent(part) +
      '&maxResults=' + maxResults +
      '&key=' + encodeURIComponent(apiKey) +
      (extra ? '&' + extra : '');

    return fetch(url).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () {
          return {};
        }).then(function (j) {
          const detail = (j.error && j.error.message) || '';
          throw new Error('YouTube API ' + res.status + (detail ? ' — ' + detail : ''));
        });
      }
      return res.json();
    });
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function fetchAllItems(ch, onProgress) {
    const identity = resolveIdentity(ch);
    const identParam = identity.id
      ? 'id=' + encodeURIComponent(identity.id)
      : 'forHandle=' + encodeURIComponent(identity.forHandle);

    return apiCall('channels', 'snippet,contentDetails', identParam, 1).then(function (chRes) {
      const resolved = chRes.items && chRes.items[0];
      const canonicalId = resolved && resolved.id;
      if (canonicalId) {
        ch.youtubeId = canonicalId;
        channelAliases[canonicalId.toLowerCase()] = ch.key;
      }
      if (ch.handle) channelAliases[ch.handle.toLowerCase()] = ch.key;

      if (resolved && resolved.snippet && resolved.snippet.title) {
        ch.label = resolved.snippet.title;
      }

      const uploads = chRes.items && chRes.items[0] &&
        chRes.items[0].contentDetails && chRes.items[0].contentDetails.relatedPlaylists &&
        chRes.items[0].contentDetails.relatedPlaylists.uploads;

      if (!uploads) {
        throw new Error('uploads playlist bulunamadı (' + (ch.id || ch.label) + ')');
      }

      const items = [];
      let pageToken = '';
      let guard = 0;

      function nextPage() {
        const extra = 'playlistId=' + encodeURIComponent(uploads) +
          (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
        return apiCall('playlistItems', 'snippet,contentDetails', extra, 50).then(function (res) {
          (res.items || []).forEach(function (pi) {
            const vid = (pi.contentDetails && pi.contentDetails.videoId) ||
              (pi.snippet && pi.snippet.resourceId && pi.snippet.resourceId.videoId);
            if (!vid) return;
            items.push(mapVideo(pi, vid, ch));
          });

          pageToken = res.nextPageToken || '';
          if (onProgress) onProgress(items.length);

          if (pageToken && guard < 200) {
            guard += 1;
            return sleep(200).then(nextPage);
          }
          return items;
        });
      }

      return nextPage();
    });
  }

  function mapVideo(pi, vid, ch) {
    const s = (pi && pi.snippet) || {};
    return {
      channel: ch.key,
      channelLabel: ch.label,
      youtubeVideoId: vid,
      title: s.title || 'Video',
      publishedAt: s.publishedAt || '',
      category: ''
    };
  }

  /* ---------- İstatistik yardımcıları ---------- */
  function fmtCount(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.', ',') + 'K';
    return String(n);
  }

  function fmtDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) { return ''; }
  }

  const statsMap = {};
  let statsInFlight = null;

  function sortUsesStats() {
    const mode = sortSelect ? sortSelect.value : 'newest';
    return mode === 'views' || mode === 'likes';
  }

  function fetchViewCounts(ids) {
    if (!apiKey) return Promise.resolve();
    const missing = ids.filter(function (id) { return !(id in statsMap); });
    if (!missing.length) return Promise.resolve();
    if (statsInFlight) return statsInFlight.then(function () { return fetchViewCounts(ids); });

    const before = Object.keys(statsMap).length;
    const batch = missing.slice(0, 45);
    statsInFlight = apiCall('videos', 'statistics', 'id=' + encodeURIComponent(batch.join(',')), 50)
      .then(function (res) {
        (res.items || []).forEach(function (it) {
          statsMap[it.id] = {
            views: (it.statistics && it.statistics.viewCount) || 0,
            likes: (it.statistics && it.statistics.likeCount) || 0
          };
        });
      })
      .catch(function () { /* görmezden gel */ })
      .then(function () {
        statsInFlight = null;
        if (sortUsesStats() && Object.keys(statsMap).length > before) {
          renderGrid();
        }
      });
    return statsInFlight;
  }

  function applyStats(videos) {
    videos.forEach(function (v) {
      if (!(v.youtubeVideoId in statsMap)) return;
      const st = statsMap[v.youtubeVideoId];
      const viewsNode = grid.querySelector('[data-stats-views="' + v.youtubeVideoId + '"]');
      if (viewsNode) viewsNode.textContent = fmtCount(st.views);
      const likesNode = grid.querySelector('[data-stats-likes="' + v.youtubeVideoId + '"]');
      if (likesNode) likesNode.textContent = fmtCount(st.likes);
    });
  }

  function seedStaticFor(key) {
    const ch = channels[key];
    const staticVideos = (cfg.videos || []).filter(function (v) {
      return v.channel === key;
    });
    ch.items = staticVideos.map(function (v) {
      return {
        channel: key,
        channelLabel: ch.label,
        youtubeVideoId: v.youtubeVideoId,
        title: v.title || 'Video',
        publishedAt: v.publishedAt || '',
        category: v.category || ''
      };
    });
    ch.done = true;
  }

  /* ---------- Önbellek ---------- */
  function readCache(ch) {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + ':' + ch.id);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d || !Array.isArray(d.items)) return null;
      if ((Date.now() - (d.fetchedAt || 0)) > CACHE_TTL_MS) return null;
      if (d.label) ch.label = d.label;
      return d.items;
    } catch (e) {
      return null;
    }
  }

  function writeCache(ch, items) {
    try {
      localStorage.setItem(CACHE_PREFIX + ':' + ch.id, JSON.stringify({
        fetchedAt: Date.now(),
        label: ch.label,
        items: items
      }));
    } catch (e) { /* depolama dolu */ }
  }

  /* Önbellekten/API'den gelen video objelerini mevcut kanal anahtarına (ch.key)
     ve etiketine (ch.label) bağla. Eski oturumlardan kalan yanlış `channel`
     / `channelLabel` değerleri filtre sekmeleriyle uyumsuzluk yaratır; burada
     düzeltilir. Böylece "Tümü"de görünen ama kendi sekmesinde boş kalan kanallar
     engellenir. */
  function bindChannelMeta(ch, items) {
    const label = (ch && ch.label) || '';
    return (Array.isArray(items) ? items : []).map(function (v) {
      const out = v || {};
      if (out.channel !== ch.key) out.channel = ch.key;
      if (label && out.channelLabel !== label) out.channelLabel = label;
      return out;
    });
  }

  /* ---------- Yükleme akışı ---------- */
  function loadChannel(key) {
    const ch = channels[key];

    if (!apiKey) { seedStaticFor(key); return Promise.resolve(); }
    if (!ch.id) {
      ch.error = 'kanal ID tanımlı değil';
      seedStaticFor(key);
      return Promise.resolve();
    }

    const cached = readCache(ch);
    if (cached) {
      ch.items = bindChannelMeta(ch, cached);
      ch.done = true;
      return Promise.resolve();
    }

    return fetchAllItems(ch, function (n) {
      statusText = 'YouTube\'dan videolar çekiliyor… (' + ch.label + ' · ' + n + ' video)';
      updateStatus();
    }).then(function (items) {
      ch.items = bindChannelMeta(ch, items);
      ch.done = true;
      writeCache(ch, items);
    }).catch(function (err) {
      ch.error = err.message || String(err);
      seedStaticFor(key);
    });
  }

  function loadAll() {
    loading = true;
    statusText = 'YouTube\'dan videolar çekiliyor…';
    renderGrid();
    updateStatus();

    const withApi = channelKeys.filter(function (k) { return apiKey && channels[k].id; });
    const without = channelKeys.filter(function (k) { return !(apiKey && channels[k].id); });

    without.forEach(seedStaticFor);

    Promise.all(channelKeys.map(loadChannel)).then(function () {
      loading = false;

      if (!channelKeys.length) {
        statusText = 'Bu yayıncı için kanal tanımlanmadı (config.json → creators.*.youtubeChannels).';
      } else if (!apiKey) {
        statusText = 'YouTube API anahtarı tanımlı değil — config.videos statik';
      } else if (withApi.length === 0) {
        statusText = 'Kanal ID\'leri tanımlı değil — config.videos statik';
      } else {
        const total = channelKeys.reduce(function (sum, k) { return sum + channels[k].items.length; }, 0);
        const errs = channelKeys.map(function (k) { return channels[k].error; }).filter(Boolean);
        statusText = 'YouTube Data API v3 ile çekildi — toplam ' + total + ' video.' +
          (errs.length ? ' (Yedek liste: ' + errs.join(' · ') + ')' : '');
      }

      buildTabs();
      renderGrid();
      updateStatus();
    });
  }

  /* ---------- Sekme ve kart üretimi ---------- */
  function buildTabs() {
    tabsEl.innerHTML = '';

    const tabs = [{ value: 'all', label: 'Tümü' }].concat(
      channelKeys.map(function (key) {
        return { value: key, label: channels[key] ? channels[key].label : key };
      })
    );

    tabs.forEach(function (t, i) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab-btn enter-card' + (t.value === activeFilter ? ' active' : '');
      btn.style.animationDelay = (i * 40) + 'ms';
      btn.dataset.filter = t.value;
      btn.textContent = t.label;

      btn.addEventListener('click', function () {
        activeFilter = t.value;
        visibleCount = pageSize;
        tabsEl.querySelectorAll('.tab-btn').forEach(function (b) {
          b.classList.toggle('active', b === btn);
        });
        renderGrid();
      });

      tabsEl.appendChild(btn);
    });
  }

  function getVideoSearchQuery() {
    return searchInput ? searchInput.value.trim().toLowerCase() : '';
  }

  function getVideoSortMode() {
    return sortSelect ? sortSelect.value : 'newest';
  }

  /* Filtre sekmesi ile video eşleşmesi: önce kesin kanal anahtarı (ch0, ch1…),
     sonra etiket / ID / handle uyumuna bakılır (büyük-küçük harf duyarsız). */
  function videoMatchesChannel(v, filterKey) {
    if (filterKey === 'all') return true;
    if (v.channel === filterKey) return true;

    const ch = channels[filterKey];
    if (!ch) return false;

    const vLabel = String(v.channelLabel || '').trim().toLowerCase();
    const chLabel = String(ch.label || '').trim().toLowerCase();
    if (vLabel && chLabel && vLabel === chLabel) return true;

    const vChan = String(v.channel || '').trim().toLowerCase();
    const chId = String(ch.id || '').trim().toLowerCase();
    const chHandle = String(ch.handle || '').replace(/^@/, '').trim().toLowerCase();
    if (vChan && (vChan === chId || vChan === chHandle || vChan === '@' + chHandle)) return true;

    return false;
  }

  function getFiltered() {
    const seen = {};
    const list = [];

    channelKeys.forEach(function (key) {
      channels[key].items.forEach(function (v) {
        if (!v.youtubeVideoId || seen[v.youtubeVideoId]) return;
        seen[v.youtubeVideoId] = true;
        list.push(v);
      });
    });

    const q = getVideoSearchQuery();
    const mode = getVideoSortMode();

    const filtered = list.filter(function (v) {
      if (q) {
        const titleText = (v.title || '').toLowerCase();
        const idText = String(v.youtubeVideoId || '').toLowerCase();
        const labelText = (v.channelLabel || '').toLowerCase();
        const ch = channels[v.channel];
        const handleText = ch ? String(ch.handle || ch.id || '').replace(/^@/, '').toLowerCase() : '';
        const hitTitle = titleText.indexOf(q) !== -1;
        const hitId = idText.indexOf(q) !== -1;
        // Kanal adı/handle: keskin kelime sınırı eşleşmesi
        // (ör. "yusabakal" → "yusabakal2" ile eşleşmez)
        const hitLabel = keywordMatch(labelText, q) || keywordMatch(handleText, q);
        if (!(hitTitle || hitId || hitLabel)) return false;
      }
      return videoMatchesChannel(v, activeFilter);
    });

    filtered.sort(function (a, b) {
      if (mode === 'views') {
        const va = Number(statsMap[a.youtubeVideoId] ? statsMap[a.youtubeVideoId].views : 0);
        const vb = Number(statsMap[b.youtubeVideoId] ? statsMap[b.youtubeVideoId].views : 0);
        return vb - va;
      }
      if (mode === 'likes') {
        const la = Number(statsMap[a.youtubeVideoId] ? statsMap[a.youtubeVideoId].likes : 0);
        const lb = Number(statsMap[b.youtubeVideoId] ? statsMap[b.youtubeVideoId].likes : 0);
        return lb - la;
      }
      const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
      const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
      return mode === 'oldest' ? ta - tb : tb - ta;
    });

    return filtered;
  }

  function onFilterChange() {
    visibleCount = pageSize;
    renderGrid();
  }

  function makeCard(v, i) {
    const card = document.createElement('div');
    card.className = 'video-card enter-card';
    card.style.animationDelay = Math.min(i * 60, 480) + 'ms';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', v.title + ' oynat');

    const category = v.category || '';
    const channelLabel = v.channelLabel || channelLabelFor(v.channel);
    const statsViews = (v.youtubeVideoId in statsMap)
      ? fmtCount(statsMap[v.youtubeVideoId].views)
      : '–';
    const statsLikes = (v.youtubeVideoId in statsMap)
      ? fmtCount(statsMap[v.youtubeVideoId].likes)
      : '–';

    let badges = '';
    if (category) {
      badges += '<span class="video-category-badge">' + escapeHtml(category) + '</span>';
    }
    badges += '<span class="video-channel-badge">' +
      '<i class="fa-brands fa-youtube mr-1"></i>' + escapeHtml(channelLabel) + '</span>';

    card.innerHTML =
      '<div class="video-thumb">' +
      '<img src="https://i.ytimg.com/vi/' + encodeURIComponent(v.youtubeVideoId) + '/mqdefault.jpg" alt="' + escapeAttr(v.title) + '" loading="lazy" onerror="this.style.display=\'none\'">' +
      badges +
      '<span class="play-overlay"><span class="play-btn"><i class="fa-solid fa-play"></i></span></span>' +
      '</div>' +
      '<div class="video-info">' +
        '<h3>' + escapeHtml(v.title) + '</h3>' +
        '<div class="video-stats">' +
          '<span class="vs-stat"><i class="fa-solid fa-eye"></i><span data-stats-views="' + v.youtubeVideoId + '">' + statsViews + '</span></span>' +
          '<span class="vs-stat"><i class="fa-solid fa-heart text-peach"></i> <span data-stats-likes="' + v.youtubeVideoId + '">' + statsLikes + '</span></span>' +
          '<span class="vs-stat"><i class="fa-solid fa-calendar-days"></i>' + fmtDate(v.publishedAt) + '</span>' +
        '</div>' +
      '</div>';

    card.addEventListener('click', function () { openModal(v); });
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(v); }
    });

    return card;
  }

  function buildCards() {
    grid.innerHTML = '';

    const filtered = getFiltered();
    const shown = filtered.slice(0, visibleCount);

    if (!shown.length) {
      grid.innerHTML = loading
        ? '<p class="col-span-full text-center text-white/40 text-sm py-12"><i class="fa-solid fa-spinner fa-spin mr-2"></i>YouTube\'dan videolar yükleniyor…</p>'
        : '<p class="col-span-full text-center text-white/40 text-sm py-12">Bu filtrede video bulunamadı.</p>';
      renderControls(filtered.length);
      return;
    }

    shown.forEach(function (v, i) {
      grid.appendChild(makeCard(v, i));
    });

    fetchViewCounts(shown.map(function (v) { return v.youtubeVideoId; }))
      .then(function () { applyStats(shown); });

    renderControls(filtered.length);
  }

  let isLoadingMore = false;

  function loadMore() {
    if (isLoadingMore) return;
    const filtered = getFiltered();
    if (visibleCount >= filtered.length) {
      renderControls(filtered.length);
      return;
    }
    isLoadingMore = true;
    const slice = filtered.slice(visibleCount, visibleCount + pageSize);
    slice.forEach(function (v, i) {
      grid.appendChild(makeCard(v, visibleCount + i));
    });
    visibleCount += slice.length;
    isLoadingMore = false;

    fetchViewCounts(slice.map(function (v) { return v.youtubeVideoId; }))
      .then(function () { applyStats(slice); });

    renderControls(filtered.length);
  }

  function renderControls(total) {
    if (!moreEl) return;
    moreEl.innerHTML = '';

    if (loading) {
      syncObserver(false);
      return;
    }

    if (total > visibleCount) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'load-more-btn';
      btn.innerHTML = '<i class="fa-solid fa-circle-down mr-1"></i>Daha Fazla Video Yükle' +
        ' <span class="load-more-hint" style="margin:0">(' + visibleCount + ' / ' + total + ')</span>';
      btn.addEventListener('click', loadMore);
      moreEl.appendChild(btn);
      syncObserver(true);
    } else {
      syncObserver(false);
    }
  }

  function setupSentinel() {
    if (!grid || sentinel) return;
    sentinel = document.createElement('div');
    sentinel.id = 'video-sentinel';
    sentinel.style.height = '1px';
    grid.after(sentinel);

    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) loadMore();
        });
      }, { rootMargin: '320px 0px' });
      observer.observe(sentinel);
    }
  }

  function syncObserver(active) {
    if (!observer || !sentinel) return;
    if (active) observer.observe(sentinel);
    else observer.unobserve(sentinel);
  }

  function renderGrid() {
    buildCards();
    updateStatus();
  }

  function updateStatus() {
    if (!statusEl) return;
    statusEl.innerHTML = statusText
      ? '<i class="fa-solid fa-circle-info mr-1.5"></i>' + statusText
      : '';
  }

  function openModal(v) {
    modalTitle.textContent = v.title || 'Video';
    const frame = document.getElementById('video-modal-frame');
    frame.src = 'https://www.youtube.com/embed/' + encodeURIComponent(v.youtubeVideoId) +
      '?autoplay=1&rel=0&playsinline=1&modestbranding=1';
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    const frame = document.getElementById('video-modal-frame');
    if (frame) frame.src = '';
    document.body.style.overflow = '';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }
  function escapeAttr(str) {
    return String(str).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---------- Aktif yayıncı doğrulaması (klip guardrail) ---------- */
  function listVideoIds() {
    const ids = {};
    channelKeys.forEach(function (key) {
      (channels[key].items || []).forEach(function (v) {
        if (v.youtubeVideoId) ids[v.youtubeVideoId] = true;
      });
    });
    return ids;
  }

  function getChannelIdList() {
    return getCanonicalIds();
  }

  // Kural: aktif yayıncının galeri kanallarından birinde varsa izin ver; yoksa
  // YouTube API'den snippet çekip birebir channelId/handle eşleşmesini dene.
  // Anahtar kelime eşleşmesi yalnızca son çare olarak ve uzunluk önceliğiyle
  // (uzun anahtar kelime önce) uygulanır; "peach" alt dizisi "peach kesitleri" ile
  // örtüşse bile yanlış kategoriye atanma engellenir.

  /* En uzun anahtar kelimeyi önce deneyerek (uzunluk önceliği) kelime sınırı
     eşleşmesi. Dizi (text) içinde bir ya da daha fazla keyword geçiyorsa true. */
  function matchKeywords(text) {
    const t = String(text == null ? '' : text).toLowerCase();
    const sorted = activeKeywords.slice().sort(function (a, b) {
      return String(b || '').length - String(a || '').length;
    });
    for (let i = 0; i < sorted.length; i++) {
      if (keywordMatch(t, sorted[i])) return true;
    }
    return false;
  }

  /* Yapılandırılmış tüm kanalların kanonik UC ID seti.
     Handle ile tanımlı kanallar runtime'da YouTube API ile çözülünce
     ch.youtubeId dolar; yapılandırılmış UC id'ler doğrudan kullanılır. */
  function getCanonicalIds() {
    const set = {};
    channelKeys.forEach(function (k) {
      const ch = channels[k];
      const raw = String(ch.youtubeId || ch.id || '').trim();
      if (/^UC[\w-]{22}$/.test(raw)) set[raw] = true;
    });
    return Object.keys(set);
  }

  /* Handle ile yapılandırılan (henüz UC'ye çözülememiş) kanal kolları. */
  function getConfiguredHandles() {
    const set = {};
    channelKeys.forEach(function (k) {
      const ch = channels[k];
      const h = String(ch.handle || ch.id || '').replace(/^@/, '').trim().toLowerCase();
      if (h) set[h] = true;
    });
    return Object.keys(set);
  }

  /* Yapılandırmada, id'si yalnızca @handle olarak yazılmış (UC çözümü bekleyen)
     kanal var mı? Varsa doğrulamada handle → UC çözümleme çağrısı yapılır. */
  function hasHandleOnlyChannels() {
    return channelKeys.some(function (k) {
      const raw = String(channels[k].id || '').trim();
      return raw.charAt(0) === '@' && !/^UC[\w-]{22}$/.test(raw);
    });
  }

  /* Bir videonun sahibi olan kanalın @handle'i (küçük harf, @ olmadan). */
  function resolveVideoChannelHandle(channelId) {
    if (!channelId) return Promise.resolve('');
    return apiCall('channels', 'snippet', 'id=' + encodeURIComponent(channelId), 1)
      .then(function (res) {
        const it = res.items && res.items[0];
        if (!it || !it.snippet) return '';
        return String(it.snippet.customUrl || it.snippet.title || '').replace(/^@/, '').trim().toLowerCase();
      })
      .catch(function () {
        return '';
      });
  }

  function validateCreatorVideo(videoId) {
    videoId = String(videoId || '').trim();
    if (!videoId) return Promise.resolve(false);

    if (listVideoIds()[videoId]) return Promise.resolve(true);

    if (!apiKey) return Promise.resolve(false);

    return apiCall('videos', 'snippet', 'id=' + encodeURIComponent(videoId), 1)
      .then(function (res) {
        const it = res.items && res.items[0];
        if (!it || !it.snippet) return false;

        const channelId = String(it.snippet.channelId || '');

        // 1) Kesin YouTube Kanal ID'si (snippet.channelId) eşleşmesi
        if (getCanonicalIds().indexOf(channelId) !== -1) return true;

        // 2) Handle eşleşmesi: (yalnızca handle ile tanımlı kanal varsa)
        //    videonun kanalı yapılandırılmış kanallardan biri mi?
        if (hasHandleOnlyChannels() && getConfiguredHandles().length) {
          return resolveVideoChannelHandle(channelId).then(function (handle) {
            if (handle && getConfiguredHandles().indexOf(handle) !== -1) return true;

            // 3) Son çare — uzunluk öncelikli anahtar kelime eşleşmesi (title,
            //    yalnızca başlık/kanal adı; asla alt dizi karşılaştırması değil)
            if (matchKeywords(it.snippet.channelTitle || '')) return true;
            return matchKeywords(it.snippet.title || '');
          });
        }

        // 3) Son çare — uzunluk öncelikli anahtar kelime eşleşmesi
        if (matchKeywords(it.snippet.channelTitle || '')) return true;
        return matchKeywords(it.snippet.title || '');
      })
      .catch(function () {
        return false;
      });
  }

  /* ---------- Modül API ---------- */
  window.VideoGalleryModule = {
    init: function (config, siteInfo) {
      cfg = (config && Array.isArray(config)) ? { videos: config } : (config || {});
      apiKey = cfg.youtubeApiKey || (cfg.youtube && cfg.youtube.apiKey) || '';

      visibleCount = pageSize;
      buildTabs();
      setupSentinel();

      if (searchInput) searchInput.addEventListener('input', onFilterChange);
      if (sortSelect) sortSelect.addEventListener('change', onFilterChange);

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
      });
      modal.querySelectorAll('[data-close-modal]').forEach(function (el) {
        el.addEventListener('click', closeModal);
      });
    },
    setChannels: function (channelList, keywords) {
      activeKeywords = Array.isArray(keywords) ? keywords : [];
      makeChannels(channelList);
      visibleCount = pageSize;
      activeFilter = 'all';
      statusText = '';
      loadAll();
    },
    onShow: function () {
      buildTabs();
      renderGrid();
    },
    isChannelVideo: function (videoId) {
      return Boolean(listVideoIds()[String(videoId || '').trim()]);
    },
    getChannelIds: function () {
      return getChannelIdList();
    },
    validateCreatorVideo: validateCreatorVideo,
    validatePeachVideo: validateCreatorVideo
  };
})();