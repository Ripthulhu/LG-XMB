/* SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';

  // Fixed app-relative aliases prepared by helper-startup.py. No directory
  // scan, downloaded assets, media elements, or native audio-focus changes.
  var FILES = Object.freeze({cursor:'snd_cursor.wav',category:'snd_category_decide.wav',
    decide:'snd_decide.wav',cancel:'snd_cancel.wav',option:'snd_option.wav',error:'snd_error.wav'});
  var LIMIT = 512 * 1024, DEADLINE = 5000, MAX_VOICES = 4;
  function now() { return root.performance ? root.performance.now() : Date.now(); }

  function MenuSounds(options) {
    options = options || {};
    this.document = options.document || root.document;
    this.createContext = options.createContext || function () {
      var Context = root.AudioContext || root.webkitAudioContext;
      return Context ? new Context({latencyHint:'interactive'}) : null;
    };
    this.createRequest = options.createRequest || function () { return new root.XMLHttpRequest(); };
    this.onChange = options.onChange || function () {};
    this.enabled = options.enabled === true;
    this.active = true;
    this.destroyed = false;
    this.context = null;
    this.buffers = Object.create(null);
    this.failures = Object.create(null);
    this.requests = new Set();
    this.voices = [];
    this.generation = 0;
    this.playGeneration = 0;
    this.loading = false;
    this.prepared = false;
    this.resumePending = null;
    this.lastCursor = -Infinity;
    this.phase = this.enabled ? 'idle' : 'off';
    this.ready = Promise.resolve();
  }
  MenuSounds.prototype.allowed = function () {
    return this.enabled && this.active && !this.destroyed && !this.document.hidden;
  };
  MenuSounds.prototype.getState = function () {
    return {enabled:this.enabled,phase:this.phase,loaded:Object.keys(this.buffers).length,
      total:Object.keys(FILES).length,missing:Object.keys(this.failures).map(function (key) {return FILES[key];}),
      directory:'/media/internal/lg-xmb/Sounds/',fallback:'generated navigation click'};
  };
  MenuSounds.prototype.report = function (phase) {
    this.phase = phase;
    try { this.onChange(this.getState()); } catch (ignore) {}
  };
  MenuSounds.prototype.ensureContext = function () {
    if (this.context || this.destroyed) return this.context;
    try { this.context = this.createContext(); } catch (ignore) {}
    if (!this.context) this.report('unsupported');
    return this.context;
  };
  MenuSounds.prototype.cancelLoads = function () {
    this.generation++;
    this.requests.forEach(function (cancel) {cancel();});
    this.requests.clear();
    this.loading = false;
  };
  MenuSounds.prototype.loadOne = function (key, generation) {
    var self = this;
    return new Promise(function (resolve) {
      var xhr, timer, done = false;
      function finish(buffer) {
        if (done) return;
        done = true; root.clearTimeout(timer); self.requests.delete(cancel);
        if (xhr) {
          xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = xhr.onprogress = null;
          try { xhr.abort(); } catch (ignore) {}
        }
        if (!self.destroyed && self.generation === generation) {
          if (buffer) {self.buffers[key] = buffer; delete self.failures[key];}
          else self.failures[key] = true;
        }
        resolve();
      }
      function cancel() { finish(null); }
      function decoded(buffer) {
        // Bound retained PCM memory as well as encoded size. A malformed or
        // unexpectedly long clip must not allocate a soundtrack-sized cache.
        if (!buffer || !Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > 5 ||
            buffer.numberOfChannels < 1 || buffer.numberOfChannels > 2 ||
            !Number.isFinite(buffer.length) || buffer.length * buffer.numberOfChannels > 960000) {
          finish(null); return;
        }
        finish(buffer);
      }
      self.requests.add(cancel);
      timer = root.setTimeout(cancel, DEADLINE);
      try {
        xhr = self.createRequest();
        xhr.open('GET', 'user-sounds/' + FILES[key] + '?v=' + generation, true);
        xhr.responseType = 'arraybuffer';
        xhr.timeout = DEADLINE;
        xhr.onprogress = function (event) {if (event.loaded > LIMIT || (event.lengthComputable && event.total > LIMIT)) finish(null);};
        xhr.onerror = xhr.onabort = xhr.ontimeout = cancel;
        xhr.onload = function () {
          if (done || self.generation !== generation) { finish(null); return; }
          var data = xhr.response;
          // file: requests report status zero; HTTP preview requests must be 2xx.
          if (!(xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) ||
              !data || data.byteLength < 12 || data.byteLength > LIMIT) { finish(null); return; }
          var b = new Uint8Array(data,0,12);
          if (b[0]!==82 || b[1]!==73 || b[2]!==70 || b[3]!==70 ||
              b[8]!==87 || b[9]!==65 || b[10]!==86 || b[11]!==69) { finish(null); return; }
          try {
            // Callback form works on older webOS Chromium; some implementations
            // also return a promise. Consume rejection without completing twice.
            var result = self.context.decodeAudioData(data, decoded, cancel);
            if (result && typeof result.catch === 'function') result.catch(cancel);
          } catch (ignore) { finish(null); }
        };
        xhr.send();
      } catch (ignore) { finish(null); }
    });
  };
  MenuSounds.prototype.prepare = function () {
    if (!this.allowed() || this.prepared || this.loading || !this.ensureContext()) return this.ready;
    var self = this, generation = ++this.generation, keys = Object.keys(FILES), cursor = 0;
    this.loading = true; this.report('loading');
    // Two bounded loads at a time, never a disk read or decode on each keypress.
    async function worker() {
      while (!self.destroyed && generation === self.generation && cursor < keys.length) {
        var key = keys[cursor++];
        if (!self.buffers[key]) await self.loadOne(key,generation);
      }
    }
    this.ready = Promise.all([worker(),worker()]).then(function () {
      if (self.destroyed || generation !== self.generation) return;
      self.prepared = true; self.loading = false;
      var count = Object.keys(self.buffers).length;
      self.report(!self.enabled ? 'off' : count===keys.length ? 'ready' : count ? 'partial' : 'fallback');
    });
    return this.ready;
  };
  MenuSounds.prototype.stop = function () {
    this.playGeneration++;
    var voices = this.voices.splice(0);
    voices.forEach(function (v) {
      v.source.onended = null;
      try {v.source.stop();} catch (ignore) {}
      try {v.source.disconnect();if(v.gain)v.gain.disconnect();} catch (ignore) {}
    });
  };
  MenuSounds.prototype.suspend = function () {
    this.stop();
    if (this.context) {
      try {var result=this.context.suspend();if(result&&result.catch)result.catch(function(){});} catch(ignore){}
    }
  };
  MenuSounds.prototype.setActive = function (active) {
    this.active = active === true;
    if (!this.allowed()) this.suspend();
    else this.prepare(); // Do not auto-resume or replay a sound on foreground.
  };
  MenuSounds.prototype.setEnabled = function (enabled) {
    if (this.destroyed || typeof enabled !== 'boolean' || this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {this.cancelLoads();this.prepared=false;this.suspend();this.report('off');}
    else {this.failures=Object.create(null);this.prepared=false;this.prepare();}
  };
  MenuSounds.prototype.retry = function () {
    if (!this.allowed()) return this.ready;
    this.cancelLoads(); this.stop(); this.buffers=Object.create(null);this.failures=Object.create(null);this.prepared=false;
    return this.prepare();
  };
  MenuSounds.prototype.play = function (kind) {
    if (!Object.prototype.hasOwnProperty.call(FILES,kind) || !this.allowed()) return false;
    var stamp = now();
    if (kind==='cursor' && stamp-this.lastCursor<25) return false;
    if (kind==='cursor') this.lastCursor=stamp;
    var context = this.ensureContext(), self = this;
    if (!context) return false;
    this.prepare();
    var generation = ++this.playGeneration;
    function trigger() {
      if (!self.allowed() || generation !== self.playGeneration || now()-stamp > 120) return;
      self.trigger(kind);
    }
    if (context.state === 'running') {trigger(); return true;}
    if (!this.resumePending) {
      try {
        this.resumePending = Promise.resolve(context.resume()).then(function () {
          self.resumePending=null;
          // A hide/toggle may have raced an in-flight resume request.
          if (!self.allowed()) self.suspend();
        },function () {self.resumePending=null;});
      } catch(ignore) {return false;}
    }
    this.resumePending.then(function(){if(context.state==='running')trigger();});
    return true;
  };
  MenuSounds.prototype.trigger = function (kind) {
    var context = this.context, buffer = this.buffers[kind], source, gain=null, self=this;
    // Keep the old navigation click only for unavailable cursor/category clips.
    // Missing confirmations/errors stay silent instead of sounding successful.
    if (!buffer && kind!=='cursor' && kind!=='category') return;
    try {
      if (buffer) {source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);}
      else {
        source=context.createOscillator();gain=context.createGain();var at=context.currentTime;
        source.type='sine';source.frequency.setValueAtTime(660,at);source.frequency.exponentialRampToValueAtTime(440,at+.065);
        gain.gain.setValueAtTime(.018,at);gain.gain.exponentialRampToValueAtTime(.0001,at+.065);
        source.connect(gain);gain.connect(context.destination);
      }
      while (this.voices.length >= MAX_VOICES) {
        var old=this.voices.shift();old.source.onended=null;try{old.source.stop();}catch(ignore){}
        old.source.disconnect();if(old.gain)old.gain.disconnect();
      }
      var voice={source:source,gain:gain};this.voices.push(voice);
      source.onended=function(){var i=self.voices.indexOf(voice);if(i>=0)self.voices.splice(i,1);source.disconnect();if(gain)gain.disconnect();};
      source.start();if(!buffer)source.stop(context.currentTime+.07);
    } catch(ignore) {
      if(source){try{source.disconnect();}catch(ignored){}}
      if(gain){try{gain.disconnect();}catch(ignored){}}
    }
  };
  MenuSounds.prototype.destroy = function () {
    if(this.destroyed)return;
    this.destroyed=true;this.cancelLoads();this.stop();this.buffers=Object.create(null);
    if(this.context){try{var result=this.context.close();if(result&&result.catch)result.catch(function(){});}catch(ignore){}}
  };
  MenuSounds.FILES=FILES;
  root.LGXMBMenuSounds=MenuSounds;
  if(typeof module==='object'&&module.exports)module.exports=MenuSounds;
})(typeof window!=='undefined'?window:globalThis);
