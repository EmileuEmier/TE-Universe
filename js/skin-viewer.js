/* ============================================================
   YUSUFTE UNIVERSE - js/skin-viewer.js
   skinview3d ile 3D skin görüntüleyici + yürüme animasyonu
   Yayıncı değişince setSkin(url) ile skin anında yenilenir.
   ============================================================ */
(function () {
  'use strict';

  window.SkinViewerModule = {
    init: function (config) {
      const cfg = config || {};
      const canvas = document.getElementById('skin-canvas');
      const btnWalk = document.getElementById('btn-walk');
      const status = document.getElementById('skin-status');

      if (!canvas || !btnWalk) return;

      // textureUrl boşsa viewer kurulmaz; yayıncı seçilince setSkin() ile kurulur.
      this.textureUrl = cfg.textureUrl || '';
      this.walkEnabled = cfg.autoWalk !== false;
      this.controlsEnabled = true;

      this.canvas = canvas;
      this.btnWalk = btnWalk;
      this.status = status;
      this.canvasBox = canvas.parentElement;

      this.viewer = null;
      this.walkAnim = null;

      if (typeof window.skinview3d === 'undefined') {
        this.setStatus('SkinView3D kütüphanesi yüklenemedi (internet bağlantısı kontrol edin).', true);
        btnWalk.disabled = true;
        return;
      }

      const self = this;

      this.btnWalk.addEventListener('click', function () {
        self.walkEnabled = !self.walkEnabled;
        self.refreshWalkUI();
        self.applyWalk();
      });

      this.canvasBox.addEventListener('dblclick', function () {
        self.controlsEnabled = !self.controlsEnabled;
        if (self.viewer && self.viewer.controls) {
          if (self.controlsEnabled) self.viewer.controls.enable();
          else self.viewer.controls.disable();
        }
      });

      this.refreshWalkUI();

      if (this.textureUrl) {
        this.buildViewer();
        this.loadSkin(this.textureUrl);
      }
    },

    setSkin: function (url, opts) {
      url = url || this.textureUrl || 'skins/peach.png';
      opts = opts || {};
      if (url === this.textureUrl && this.viewer) return;
      this.textureUrl = url;
      this.buildViewer();
      this.loadSkin(url);
    },

    setStatus: function (msg, isError) {
      if (!this.status) return;
      this.status.className = 'mt-5 text-xs font-mono ' + (isError ? 'text-red-400' : 'text-peach/80');
      this.status.innerHTML = (isError
        ? '<i class="fa-solid fa-triangle-exclamation mr-1.5"></i>'
        : '<i class="fa-solid fa-check mr-1.5"></i>') + msg;
    },

    refreshWalkUI: function () {
      if (!this.btnWalk) return;
      const label = this.walkEnabled ? 'Yürüme: Açık' : 'Yürüme: Kapalı';
      const lbl = this.btnWalk.querySelector('.btn-label');
      if (lbl) lbl.textContent = label;
      this.btnWalk.classList.toggle('active', this.walkEnabled);
    },

    buildViewer: function () {
      const canvas = this.canvas;
      if (this.viewer && typeof this.viewer.dispose === 'function') {
        try { this.viewer.dispose(); } catch (e) { /* yok say */ }
      }
      this.viewer = null;
      this.walkAnim = null;

      if (!canvas || typeof window.skinview3d === 'undefined') return;

      const box = this.canvasBox.getBoundingClientRect();
      this.viewer = new skinview3d.SkinViewer({
        canvas: canvas,
        width: Math.max(box.width, 280),
        height: Math.max(box.height, 320),
        skin: this.textureUrl
      });

      this.viewer.background = 0x0d0d11;
      this.viewer.autoRotate = true;
      this.viewer.rotation = Math.PI / 2;
      this.viewer.zoom = 0.75;
      this.viewer.fov = 55;

      if (this.viewer.controls && typeof this.viewer.controls.enable === 'function' && this.controlsEnabled) {
        this.viewer.controls.enable();
      }
      this.applyWalk();
    },

    getWalkAnim: function () {
      if (!this.viewer || typeof window.skinview3d === 'undefined') return null;
      if (!this.walkAnim && window.skinview3d.WalkingAnimation) {
        this.walkAnim = new skinview3d.WalkingAnimation();
        this.walkAnim.speed = 0.9;
        this.viewer.animation = this.walkAnim;
      }
      return this.walkAnim;
    },

    applyWalk: function () {
      if (!this.viewer) return;
      if (this.walkEnabled) {
        const a = this.getWalkAnim();
        if (a) {
          a.paused = false;
          this.viewer.autoRotate = false;
        }
      } else {
        if (this.walkAnim) this.walkAnim.paused = true;
        this.viewer.autoRotate = true;
      }
    },

    loadSkin: function (url) {
      this.loadedUrl = '';
      if (!this.viewer || typeof window.skinview3d === 'undefined') return;
      const self = this;
      this.setStatus('Skin yükleniyor...');
      this.viewer.loadSkin(url).then(function () {
        self.loadedUrl = url;
        self.setStatus('Skin yüklendi — 3D karakter hazır!');
        if (self.viewer && self.viewer.controls &&
            typeof self.viewer.controls.enable === 'function' && self.controlsEnabled) {
          self.viewer.controls.enable();
        }
      }).catch(function () {
        self.setStatus('Skin görseli yüklenemedi: ' + url, true);
      });
    }
  };

  (function autoInit() {
    document.addEventListener('DOMContentLoaded', function () {
      // app.js bootstrap sırasında SkinViewerModule.init çağrılır; burada bekleme yoktur.
    });
  })();
})();