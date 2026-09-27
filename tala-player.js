/* ============================================================
   tala-player.js — reusable Tala Metronome widget
   No external dependencies. Uses the Web Audio API to generate
   click tones on the fly (no audio files) and a lookahead
   scheduler for sample-accurate timing, with the on-screen beat
   highlight driven off the same clock via requestAnimationFrame.

   Usage (see basics.html for live examples):

     <div id="my-metronome"></div>
     <script src="tala-player.js"></script>
     <script>
       TalaPlayer.init('my-metronome', {
         title: 'Adi Tala',
         groups: [4, 2, 2],   // beat groups, e.g. Adi = 4+2+2
         bpm: 60
       });
     </script>

   `groups` is an array of positive integers; each number is the
   size of one anga (limb) of the tala. The first beat of every
   group is accented (higher pitched "clap" click); the rest of
   the beats in a group play a softer, lower click.
   ============================================================ */

(function (global) {
  "use strict";

  var PRESET_TALAS = {
    adi: { label: "Adi Tala (8: 4+2+2)", groups: [4, 2, 2] },
    rupaka: { label: "Rupaka Tala (3: 1+2)", groups: [1, 2] },
    triputa: { label: "Triputa Tala (7: 3+2+2)", groups: [3, 2, 2] },
    custom: { label: "Custom…", groups: null }
  };

  var SCHEDULE_AHEAD_TIME = 0.15; // seconds — how far ahead we schedule audio
  var TIMER_INTERVAL_MS = 25; // how often the scheduler wakes up

  function flattenGroups(groups) {
    // Returns an array the length of the total beat count, where each
    // entry is true if that beat is the first beat of its group.
    var flags = [];
    groups.forEach(function (size) {
      for (var i = 0; i < size; i++) {
        flags.push(i === 0);
      }
    });
    return flags;
  }

  function parseCustomPattern(text) {
    var parts = String(text || "")
      .split(",")
      .map(function (s) {
        return parseInt(s.trim(), 10);
      })
      .filter(function (n) {
        return Number.isFinite(n) && n > 0;
      });
    return parts.length ? parts : [4];
  }

  function TalaPlayerInstance(container, options) {
    this.container = container;
    this.options = options || {};
    this.groups = this.options.groups || PRESET_TALAS.adi.groups;
    this.bpm = this.options.bpm || 60;
    this.audioCtx = null;
    this.isPlaying = false;
    this.currentBeat = -1; // index into flattened beat array
    this.nextNoteTime = 0.0;
    this.beatFlags = flattenGroups(this.groups);
    this.schedulerTimer = null;
    this.rafId = null;
    this.lookaheadQueue = []; // {beatIndex, time}
    this._buildDom();
  }

  TalaPlayerInstance.prototype._buildDom = function () {
    var self = this;
    var opts = this.options;
    var uid = "tp_" + Math.random().toString(36).slice(2, 9);

    var wrap = document.createElement("div");
    wrap.className = "tala-player";

    var title = opts.title || "Tala Metronome";
    var showTalaSelect = opts.showTalaSelect !== false;

    var html = '<h4>' + escapeHtml(title) + '</h4>';
    html += '<div class="controls">';

    if (showTalaSelect) {
      html += '<label>Tala' +
        '<select class="tala-select" id="' + uid + '_tala"></select>' +
        '</label>';
      html += '<label class="custom-pattern-field">Beat groups (comma separated)' +
        '<input type="text" class="custom-pattern" id="' + uid + '_pattern" placeholder="e.g. 4,2,2" />' +
        '</label>';
    }

    html += '<label>Tempo' +
      '<span><input type="range" class="bpm-range" id="' + uid + '_bpmrange" min="30" max="220" value="' + this.bpm + '" />' +
      ' <span class="bpm-value" id="' + uid + '_bpmval">' + this.bpm + '</span> BPM</span>' +
      '</label>';

    html += '<div class="buttons">' +
      '<button type="button" class="btn-play" id="' + uid + '_play">▶ Play</button>' +
      '<button type="button" class="btn-stop" id="' + uid + '_stop">■ Stop</button>' +
      '</div>';

    html += '</div>'; // .controls

    html += '<div class="beat-display" id="' + uid + '_beats" aria-live="polite"></div>';

    wrap.innerHTML = html;
    this.container.innerHTML = "";
    this.container.appendChild(wrap);

    this.el = {
      wrap: wrap,
      talaSelect: wrap.querySelector("#" + uid + "_tala"),
      customPattern: wrap.querySelector("#" + uid + "_pattern"),
      bpmRange: wrap.querySelector("#" + uid + "_bpmrange"),
      bpmVal: wrap.querySelector("#" + uid + "_bpmval"),
      playBtn: wrap.querySelector("#" + uid + "_play"),
      stopBtn: wrap.querySelector("#" + uid + "_stop"),
      beats: wrap.querySelector("#" + uid + "_beats")
    };

    if (showTalaSelect) {
      var presetKey = opts.presetKey || "custom";
      Object.keys(PRESET_TALAS).forEach(function (key) {
        var o = document.createElement("option");
        o.value = key;
        o.textContent = PRESET_TALAS[key].label;
        self.el.talaSelect.appendChild(o);
      });
      this.el.talaSelect.value = presetKey;
      if (presetKey === "custom") {
        wrap.classList.add("custom-mode");
        this.el.customPattern.value = this.groups.join(",");
      }

      this.el.talaSelect.addEventListener("change", function () {
        var key = self.el.talaSelect.value;
        if (key === "custom") {
          wrap.classList.add("custom-mode");
          self.setGroups(parseCustomPattern(self.el.customPattern.value));
        } else {
          wrap.classList.remove("custom-mode");
          self.setGroups(PRESET_TALAS[key].groups.slice());
        }
      });

      this.el.customPattern.addEventListener("input", function () {
        if (self.el.talaSelect.value === "custom") {
          self.setGroups(parseCustomPattern(self.el.customPattern.value));
        }
      });
    } else {
      this.el.wrap.querySelector(".controls").style.setProperty("--no-select", "1");
    }

    this.el.bpmRange.addEventListener("input", function () {
      self.bpm = parseInt(self.el.bpmRange.value, 10);
      self.el.bpmVal.textContent = self.bpm;
    });

    this.el.playBtn.addEventListener("click", function () {
      self.start();
    });
    this.el.stopBtn.addEventListener("click", function () {
      self.stop();
    });

    this._renderBeats();
  };

  TalaPlayerInstance.prototype.setGroups = function (groups) {
    this.groups = groups;
    this.beatFlags = flattenGroups(groups);
    this.currentBeat = -1;
    this._renderBeats();
  };

  TalaPlayerInstance.prototype._renderBeats = function () {
    var html = "";
    var beatIndex = 0;
    this.groups.forEach(function (size, gi) {
      if (gi > 0) {
        html += '<span class="group-sep">|</span>';
      }
      for (var i = 0; i < size; i++) {
        var classes = ["beat"];
        if (i === 0) classes.push("group-start");
        if (beatIndex === this.currentBeat) classes.push("active");
        html += '<span class="' + classes.join(" ") + '" data-beat="' + beatIndex + '">' + (beatIndex + 1) + "</span>";
        beatIndex++;
      }
    }, this);
    this.el.beats.innerHTML = html;
  };

  TalaPlayerInstance.prototype._ensureAudioContext = function () {
    if (!this.audioCtx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      this.audioCtx = new AC();
    }
    if (this.audioCtx.state === "suspended") {
      this.audioCtx.resume();
    }
  };

  TalaPlayerInstance.prototype._playClick = function (time, accented) {
    var ctx = this.audioCtx;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = accented ? 1400 : 900;
    gain.gain.setValueAtTime(accented ? 0.35 : 0.18, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.09);
  };

  TalaPlayerInstance.prototype._scheduleNote = function (beatIndex, time) {
    this._playClick(time, this.beatFlags[beatIndex]);
    this.lookaheadQueue.push({ beatIndex: beatIndex, time: time });
  };

  TalaPlayerInstance.prototype._secondsPerBeat = function () {
    return 60.0 / this.bpm;
  };

  TalaPlayerInstance.prototype._scheduler = function () {
    while (this.nextNoteTime < this.audioCtx.currentTime + SCHEDULE_AHEAD_TIME) {
      var beatIndex = (this.currentBeat + 1) % this.beatFlags.length;
      this._scheduleNote(beatIndex, this.nextNoteTime);
      this.currentBeat = beatIndex;
      this.nextNoteTime += this._secondsPerBeat();
    }
  };

  TalaPlayerInstance.prototype._raf = function () {
    if (!this.isPlaying) return;
    var now = this.audioCtx.currentTime;
    // Find the most recent scheduled beat whose time has passed, to
    // sync the visual highlight with the audio clock.
    while (this.lookaheadQueue.length && this.lookaheadQueue[0].time <= now) {
      var next = this.lookaheadQueue.shift();
      this._displayBeat = next.beatIndex;
    }
    if (this._displayBeat !== this._lastDisplayedBeat) {
      this._lastDisplayedBeat = this._displayBeat;
      this.currentBeat = this._displayBeat;
      this._renderBeats();
    }
    this.rafId = global.requestAnimationFrame(this._raf.bind(this));
  };

  TalaPlayerInstance.prototype.start = function () {
    if (this.isPlaying) return;
    this._ensureAudioContext();
    this.isPlaying = true;
    this.currentBeat = -1;
    this._displayBeat = -1;
    this._lastDisplayedBeat = -1;
    this.lookaheadQueue = [];
    this.nextNoteTime = this.audioCtx.currentTime + 0.05;

    var self = this;
    this.schedulerTimer = global.setInterval(function () {
      self._scheduler();
    }, TIMER_INTERVAL_MS);

    this.rafId = global.requestAnimationFrame(this._raf.bind(this));

    this.el.playBtn.disabled = true;
    this.el.stopBtn.disabled = false;
  };

  TalaPlayerInstance.prototype.stop = function () {
    this.isPlaying = false;
    if (this.schedulerTimer) {
      global.clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    if (this.rafId) {
      global.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.currentBeat = -1;
    this._renderBeats();
    this.el.playBtn.disabled = false;
    this.el.stopBtn.disabled = true;
  };

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var TalaPlayer = {
    /**
     * Initialize a metronome widget inside the element with the given id.
     * options:
     *   title          - heading text shown above the controls
     *   groups         - array of beat-group sizes, e.g. [4,2,2] for Adi
     *   bpm            - starting tempo
     *   presetKey      - "adi" | "rupaka" | "triputa" | "custom" (selects dropdown default)
     *   showTalaSelect - set false to hide the tala dropdown (fixed tala widget)
     */
    init: function (elementId, options) {
      var container = typeof elementId === "string" ? document.getElementById(elementId) : elementId;
      if (!container) {
        throw new Error("TalaPlayer.init: element not found: " + elementId);
      }
      var instance = new TalaPlayerInstance(container, options || {});
      container._talaPlayerInstance = instance;
      return instance;
    },
    presets: PRESET_TALAS
  };

  global.TalaPlayer = TalaPlayer;
})(window);
