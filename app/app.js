/* lg-xmb web application, 2026. SPDX-License-Identifier: GPL-3.0-or-later */
(function () {
  'use strict';
  var categories = window.C5Catalog,
    selectedCategory = Math.max(
      0,
      categories.findIndex(function (category) {
        return category.id === 'tv';
      })
    ),
    selections = categories.map(function () {
      return 0;
    }),
    busy = false,
    modalOpen = false,
    lastDirection = 0,
    toastTimer,
    announceTimer;
  var themes = LGXMBPreferences.createThemes();
  // Access storage lazily: webOS/browser privacy settings can deny the getter.
  var preferenceStorage = {
    getItem: function (key) {
      return localStorage.getItem(key);
    },
    setItem: function (key, value) {
      localStorage.setItem(key, value);
    }
  };
  var preferences = LGXMBPreferences.load(
    preferenceStorage,
    function () {
      return matchMedia('(prefers-reduced-motion: reduce)').matches;
    },
    LGXMBWaveColors.normalize
  );
  var $ = function (id) {
    return document.getElementById(id);
  };
  var wave = new C5Wave($('wave'), { quality: '1080p', adaptive: false }),
    livePreviewActive = false;
  var inputPreview = new C5InputPreview($('inputPreview'), {
    isTV: function () {
      return C5TV.isTV();
    },
    onActivityChange: function (active) {
      livePreviewActive = active;
      syncWavePlayback();
    }
  });
  var thumbnail = new C5Thumbnail($('inputThumbnail'), $('thumbnailFallback'), {
    isTV: function () {
      return C5TV.isTV();
    }
  });
  var categoryTransition = new LGXMBCategoryTransition($('categories'));
  var music = new LGXMBBackgroundMusic({
    enabled: preferences.musicEnabled,
    volume: preferences.musicVolume,
    onChange: updateMusicStatus
  });
  var detailItemId = null,
    launchGeneration = 0,
    pageActive = !document.hidden,
    musicAway = false,
    lastReturnAt = -Infinity;
  document.querySelector('.input-preview-symbol').innerHTML = C5Icon('hdmi');
  document.querySelector('.thumbnail-symbol').innerHTML = C5Icon('hdmi');
  var inputLabelRead = null;
  var menuOrder = new LGXMBMenuOrder(categories, {
      getItem: function (k) {
        return localStorage.getItem(k);
      },
      setItem: function (k, v) {
        localStorage.setItem(k, v);
      }
    }),
    hold = new LGXMBHoldGesture(),
    pointerHold = null,
    suppressHoldClick = false;
  var appCategories = new LGXMBAppCategories(categories, menuOrder, {
    getItem: function (k) {
      return localStorage.getItem(k);
    },
    setItem: function (k, v) {
      localStorage.setItem(k, v);
    }
  });
  var appRefresh = new LGXMBAppRefresh({
    read: function () {
      return C5TV.listApps();
    },
    canApply: function () {
      return (
        pageActive &&
        !document.hidden &&
        !busy &&
        !musicAway &&
        !modalOpen &&
        !hold.state &&
        !waveOnly &&
        !itemOptions.removal &&
        (lastDirection === 0 || performance.now() - lastDirection >= 500)
      );
    },
    apply: function (apps) {
      var changed = appCategories.reconcile(apps, selections);
      if (changed) {
        categoryTransition.cancel();
        buildItems();
        render();
      }
      return changed;
    }
  });
  var itemOptions = new LGXMBItemOptions({
    manager: LGXMBAppManager,
    sound: tick,
    canHide: function (item) {
      return appCategories.canHide(item);
    },
    getHidden: function () {
      return appCategories.hiddenApps();
    },
    onHide: function (item) {
      appCategories.hide(item, selections);
      categoryTransition.cancel();
    },
    onRestore: function (id) {
      appCategories.restore(id, selections);
      categoryTransition.cancel();
    },
    canAssign: function (item) {
      return appCategories.canAssign(item);
    },
    getCategories: function () {
      return appCategories.choices();
    },
    getCategory: function (id) {
      return appCategories.get(id);
    },
    getCategoryLocations: function (id) {
      return appCategories.locations(id);
    },
    getDefaultCategories: function (id) {
      return appCategories.defaultLocations(id);
    },
    onCategory: function (item, id) {
      var ci = appCategories.assign(item, id, selections, categories[selectedCategory].id);
      categoryTransition.cancel();
      if (ci >= 0) selectedCategory = ci;
    },
    onRefresh: function () {
      appRefresh.refresh();
    },
    getSort: function (id) {
      return menuOrder.modes[id];
    },
    onOpen: function () {
      cancelNavigation();
      document.body.classList.add('item-options-visible');
      categoryTransition.cancel();
      clearToast();
      clearTimeout(detailTimer);
      detailTimer = 0;
      modalOpen = true;
      modalType = 'item-options';
      document.querySelector('.screen').setAttribute('aria-hidden', 'true');
      syncInputPreview();
    },
    onClose: function (reason) {
      cancelNavigation();
      document.body.classList.remove('item-options-visible');
      modalOpen = false;
      modalType = '';
      document.querySelector('.screen').classList.remove('modal-dimmed');
      document.querySelector('.screen').removeAttribute('aria-hidden');
      if (reason !== 'lifecycle' && pageActive && !document.hidden) {
        $('items').focus();
        if (reason !== 'start') {
          buildItems();
          render();
        }
      }
    },
    onStart: function (item) {
      if (currentItem().id === item.id) activate();
    },
    onSort: function (cat, mode, id) {
      var ci = categories.indexOf(cat);
      selections[ci] = menuOrder.set(cat, mode, id);
      buildItems();
      render();
    },
    onDeleted: function (id, title) {
      appRefresh.invalidate();
      appCategories.deleted(id, selections);
      buildItems();
      if (pageActive && !document.hidden) {
        render();
        toast(title + ' was deleted.');
      }
    }
  });
  var dateTimeSettings = new LGXMBDateTimeSettings({
    api: LGXMBSystemTime,
    sound: tick,
    onApplied: function () {
      updateClock();
      seasonal();
      wave.setTheme(
        Object.assign({}, themes[preferences.theme], { colors: preferences.waveColors })
      );
    }
  });
  function openItemOptions() {
    if (busy || modalOpen || waveOnly || !pageActive || document.hidden) return;
    if (itemOptions.removal) {
      toast('App deletion is still in progress.');
      return;
    }
    itemOptions.open(currentItem(), categories[selectedCategory]);
  }
  function cancelHold() {
    hold.cancel();
    pointerHold = null;
  }
  var sounds = new LGXMBMenuSounds({ enabled: preferences.sound, onChange: updateSoundStatus });
  function tick(kind) {
    sounds.play(kind || 'cursor');
  }
  function save() {
    try {
      LGXMBPreferences.save(preferenceStorage, preferences);
    } catch (ignore) {
      toast('This device could not save your preference.');
    }
  }
  function seasonal() {
    LGXMBPreferences.updateSeasonal(themes, new Date());
  }
  function applyPreferences() {
    sounds.setEnabled(preferences.sound);
    if (preferences.motion === 'reduced') categoryTransition.cancel();
    seasonal();
    var theme = themes[preferences.theme];
    document.documentElement.style.setProperty('--accent', '#ffffff');
    document.documentElement.style.setProperty('--accent-rgb', '255,255,255');
    document.documentElement.style.setProperty('--background', theme.background);
    document.documentElement.style.setProperty(
      '--background-rgb',
      theme.background
        .match(/[a-f0-9]{2}/gi)
        .map(function (x) {
          return parseInt(x, 16);
        })
        .join(',')
    );
    document.body.classList.toggle('reduced-motion', preferences.motion === 'reduced');
    wave.setTheme(Object.assign({}, theme, { colors: preferences.waveColors }));
    wave.setStyle(LGXMBPreferences.waveStyle(preferences));
    wave.setQuality(LGXMBPreferences.waveQuality(preferences));
    wave.setReducedMotion(preferences.motion === 'reduced');
  }
  function toast(message) {
    $('toast').textContent = message;
    $('toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      $('toast').classList.remove('show');
    }, 4200);
  }
  function clearToast() {
    clearTimeout(toastTimer);
    $('toast').classList.remove('show');
    if ($('toast').textContent) $('toast').textContent = '';
  }
  var recentOrderDirty = false;
  function recordRecent(item) {
    menuOrder.record(item.id);
    recentOrderDirty = true;
  }
  function refreshRecent() {
    if (!recentOrderDirty) return;
    recentOrderDirty = false;
    var changed = false;
    categories.forEach(function (cat, ci) {
      if (menuOrder.modes[cat.id] === 'recent') {
        var before = cat.items
          .map(function (i) {
            return i.id;
          })
          .join('|');
        selections[ci] = menuOrder.apply(
          cat,
          cat.items[selections[ci]] && cat.items[selections[ci]].id
        );
        if (
          before !==
          cat.items
            .map(function (i) {
              return i.id;
            })
            .join('|')
        )
          changed = true;
      }
    });
    if (changed) {
      buildItems();
      renderRows(selectedCategory);
      $('items').setAttribute('aria-activedescendant', 'item-' + selections[selectedCategory]);
    }
  }
  function invalidateLaunch() {
    launchGeneration++;
    busy = false;
    $('items').removeAttribute('aria-busy');
  }
  function currentItem() {
    return categories[selectedCategory].items[selections[selectedCategory]];
  }
  function currentPort() {
    var item = currentItem(),
      match = item.action === 'input' && /^com\.webos\.app\.hdmi([1-4])$/.exec(item.id);
    return match ? Number(match[1]) : null;
  }
  function stopInputPreview() {
    inputPreview.stop();
    $('previewPanel').classList.remove('live-preview');
  }
  function syncWavePlayback() {
    // Page suspension is immediate; a live preview eases the motion to rest.
    // Releasing video while hidden must not restart rendering. Neither pause
    // changes the saved animation or quality settings.
    wave.setPaused(!pageActive || document.hidden);
    wave.setMotionHeld(livePreviewActive);
  }
  function syncInputPreview() {
    var port = currentPort(),
      shown = !!port && !modalOpen,
      active = shown && !waveOnly && pageActive && !document.hidden && !busy,
      live = active && preferences.previewMode === 'live';
    document.querySelector('.detail').classList.toggle('has-input-preview', shown);
    $('previewPanel').hidden = !shown;
    $('previewPanel').classList.toggle('live-preview', live);
    $('previewButton').setAttribute('aria-label', 'Open ' + currentItem().title + ' full-screen');
    if (!active || live) {
      thumbnail.setPaused(true);
      thumbnail.select(shown ? port : null);
    } else {
      thumbnail.select(port);
      thumbnail.setPaused(false);
    }
    if (live) {
      music.setContext(pageActive && !busy && !musicAway, C5TV.isTV());
      inputPreview.select(port);
    } else {
      inputPreview.stop();
      music.setContext(pageActive && !busy && !musicAway, false);
    }
  }
  function renderDetailText() {
    var item = currentItem();
    launcherView.detail(item);
    detailItemId = item.id;
  }
  // Delay detail text by 140 ms so rapid navigation repaints it once,
  // separately from the moving rows.
  var detailTimer = 0;
  function renderDetail() {
    clearTimeout(detailTimer);
    detailTimer = 0;
    renderDetailText();
    syncInputPreview();
  }
  // Only the text waits. The preview has to hear about the new row at once, cause
  // leaving an HDMI row must stop a live preview immediately.
  function scheduleDetail() {
    clearTimeout(detailTimer);
    detailTimer = setTimeout(function () {
      detailTimer = 0;
      renderDetailText();
    }, 140);
    syncInputPreview();
  }
  var launcherView = new LGXMBLauncherView({
    categories: categories,
    selections: selections,
    getCategory: function () {
      return selectedCategory;
    },
    isBusy: function () {
      return busy;
    },
    canActivate: function () {
      return !busy && !modalOpen && pageActive && !document.hidden;
    },
    selectCategory: selectCategory,
    cancelHold: cancelHold,
    activateItem: function (index) {
      selections[selectedCategory] = index;
      render();
      activate();
    }
  });
  var buildCategories = launcherView.buildCategories,
    buildItems = launcherView.buildItems,
    renderRows = launcherView.renderRows;
  function render(deferDetail) {
    launcherView.render();
    if (deferDetail === true) scheduleDetail();
    else renderDetail();
    announceSelection();
    wave.setMenuObjects(launcherView.menuObjects());
  }
  function announceSelection() {
    var cat = categories[selectedCategory],
      index = selections[selectedCategory],
      item = cat.items[index];
    clearTimeout(announceTimer);
    announceTimer = setTimeout(function () {
      $('selectionLive').textContent =
        cat.title + ', ' + item.title + ', ' + (index + 1) + ' of ' + cat.items.length;
    }, 180);
  }
  function selectCategory(index) {
    if (busy || modalOpen || !pageActive || document.hidden) return;
    cancelWheelNavigation();
    if (index === selectedCategory) return;
    cancelHold();
    var direction = index - selectedCategory;
    categoryTransition.change(
      direction,
      function () {
        selectedCategory = index;
        launcherView.activateCategory();
        render(true);
      },
      preferences.motion === 'full'
    );
    wave.navigated(direction > 0 ? 'right' : 'left');
    tick('category');
  }
  function navigate(direction, steps) {
    if (busy || !pageActive || document.hidden) return;
    cancelHold();
    var next;
    if (direction === 'left' || direction === 'right') {
      next = Math.max(
        0,
        Math.min(categories.length - 1, selectedCategory + (direction === 'right' ? 1 : -1))
      );
      selectCategory(next);
      return;
    }
    next = Math.max(
      0,
      Math.min(
        categories[selectedCategory].items.length - 1,
        selections[selectedCategory] + (direction === 'down' ? 1 : -1) * (steps || 1)
      )
    );
    if (next === selections[selectedCategory]) return;
    selections[selectedCategory] = next;
    render(true);
    wave.navigated(direction);
    tick();
  }
  var settingsUI = new LGXMBSettingsUI($('modalContent'), {
    getPanel: function () {
      return modalType;
    },
    sound: tick,
    focus: LGXMBMenuFocus
  });
  var row = settingsUI.row,
    choiceGroup = settingsUI.choiceGroup,
    selectChoice = settingsUI.selectChoice;
  var statusText = settingsUI.statusText,
    reserveAction = settingsUI.reserveAction;
  var modalType = '';
  var appearanceSettings = new LGXMBAppearanceSettings({
    preferences: preferences,
    themes: themes,
    wave: wave,
    ui: settingsUI,
    content: $('modalContent'),
    save: save,
    applyPreferences: applyPreferences,
    openPanel: openModal,
    setWaveOnly: setWaveOnly
  });
  function openModal(type) {
    cancelNavigation();
    cancelHold();
    categoryTransition.cancel();
    if (!modalOpen || modalType !== type) clearToast();
    if (modalType === 'remote') C5RemoteSettings.close();
    if (modalType === 'datetime') dateTimeSettings.close();
    watchHelperStatus(false);
    stopInputPreview();
    modalType = type;
    $('modal').classList.toggle(
      'waves-settings',
      type === 'appearance' || type === 'sound' || type === 'wave-colors'
    );
    $('modal').classList.toggle('appearance-settings', type === 'appearance');
    modalOpen = true;
    syncInputPreview();
    document.querySelector('.screen').setAttribute('aria-hidden', 'true');
    $('modalBackdrop').hidden = false;
    $('modalContent').textContent = '';
    $('modalContent').classList.remove('theme-options');
    $('modalTitle').textContent = {
      datetime: 'Date & time',
      appearance: 'Appearance',
      theme: 'Theme',
      'wave-colors': 'Wave colours',
      sound: 'Sound',
      previews: 'Input previews',
      remote: 'Back button'
    }[type];
    $('modalIntro').textContent = {
      datetime: '',
      appearance: '',
      theme: '',
      'wave-colors': '',
      sound: '',
      previews: '',
      remote: ''
    }[type];
    if (type === 'theme') {
      appearanceSettings.openTheme();
    } else if (type === 'appearance') {
      row('Theme', null, false, function () {
        openModal('theme');
      }).id = 'openTheme';
      appearanceSettings.open();
    } else if (type === 'datetime') {
      dateTimeSettings.open($('modalContent'));
    } else if (type === 'wave-colors') {
      LGXMBWaveColorSettings.open($('modalContent'), preferences.waveColors, function (value) {
        preferences.waveColors = value;
        wave.setTheme(Object.assign({}, themes[preferences.theme], { colors: value }));
        save();
      });
    } else if (type === 'sound') {
      openSoundSettings();
    } else if (type === 'previews') {
      [
        ['cached', 'Cached'],
        ['live', 'Live']
      ].forEach(function (choice) {
        var button = row(choice[1], null, preferences.previewMode === choice[0], function () {
          if (preferences.previewMode === choice[0]) return;
          preferences.previewMode = choice[0];
          save();
          selectChoice($('modalContent'), choice[0]);
          updateHelperStatus();
        });
        button.setAttribute('data-choice', choice[0]);
      });
      helperStatusPanel();
    } else if (type === 'remote') {
      C5RemoteSettings.open({
        getBack: function () {
          return preferences.backBehavior;
        },
        setBack: function (value) {
          if (['previous', 'stay', 'lg'].indexOf(value) === -1)
            throw new Error('Choose a valid Back button setting.');
          var next = Object.assign({}, preferences, { backBehavior: value });
          try {
            LGXMBPreferences.save(preferenceStorage, next);
          } catch (ignore) {
            throw new Error('This device could not save the Back button setting.');
          }
          preferences.backBehavior = value;
        }
      });
    }
    var chosen =
      (type === 'appearance' && $('openTheme')) ||
      (type === 'datetime' && $('modalContent').querySelector('.date-time-value')) ||
      $('modalContent').querySelector('[aria-pressed="true"]') ||
      $('modalContent').querySelector('button') ||
      $('modal');
    LGXMBMenuFocus(chosen);
  }
  // Hide with visibility to avoid text-opacity compositing on the C5.
  // Ignore navigation while hidden so the menu retains its selection.
  var waveOnly = false;
  function setWaveOnly(on) {
    on = on === true;
    if (waveOnly === on) return;
    cancelNavigation();
    waveOnly = on;
    if (on && modalOpen) closeModal(true);
    document.body.classList.toggle('wave-only', on);
    syncInputPreview();
    if (on) toast('Press Back to return.');
    else {
      clearToast();
      $('items').focus();
    }
  }
  // Avoid replacing identical text nodes on repeated service/status callbacks.
  function updateSoundStatus() {
    var status = $('soundStatus');
    if (!status || !sounds) return;
    var state = sounds.getState();
    var message =
      state.enabled && state.phase === 'unsupported' ? 'Navigation sound unavailable.' : '';
    statusText(status, message);
  }
  function openSoundSettings() {
    choiceGroup(
      'Navigation sound',
      [
        [false, 'Off'],
        [true, 'On']
      ],
      preferences.sound,
      function (value) {
        preferences.sound = value;
        sounds.setEnabled(value);
        save();
        updateSoundStatus();
      }
    );
    openMusicSettings();
    var status = document.createElement('p');
    status.id = 'soundStatus';
    status.className = 'wave-quality-note';
    status.setAttribute('role', 'status');
    $('modalContent').appendChild(status);
    var reload = row('Reload sounds', null, false, function () {
      sounds.retry();
      updateSoundStatus();
    });
    reload.id = 'reloadSounds';
    $('modalContent').insertBefore(reload, $('musicStatus'));
    $('modalContent').appendChild(status);
    updateSoundStatus();
  }
  // The Home identity's audio is never connected by the TV, see connectMusicAudio.
  // The pipeline can show up a moment after the element says it's playing, so
  // one miss gets one more try.
  var musicConnectTimer = 0,
    musicPhase = '',
    musicRouteEpoch = 0,
    musicRouteError = '';
  function connectMusic(again) {
    clearTimeout(musicConnectTimer);
    var epoch = musicRouteEpoch,
      generation = music.getState().generation;
    function current() {
      return (
        epoch === musicRouteEpoch &&
        music.allowed() &&
        music.getState().generation === generation &&
        music.getState().phase === 'playing'
      );
    }
    C5TV.connectMusicAudio(current)
      .then(function (result) {
        if (!current()) return;
        if (result && result.reason === 'no-pipeline') {
          if (again)
            musicConnectTimer = setTimeout(function () {
              if (current()) connectMusic(false);
            }, 2000);
          else {
            musicRouteError = 'Audio unavailable. Retry playback.';
            updateMusicStatus();
          }
        }
      })
      .catch(function () {
        if (current()) {
          musicRouteError = 'Audio unavailable. Retry playback.';
          updateMusicStatus();
        }
      });
  }
  function updateMusicStatus() {
    if (music) {
      var phase = music.getState().phase;
      if (phase !== musicPhase) {
        musicRouteEpoch++;
        clearTimeout(musicConnectTimer);
        musicRouteError = '';
        if (phase === 'playing') connectMusic(true);
      }
      musicPhase = phase;
    }
    var status = $('musicStatus'),
      retry = $('retryMusic');
    if (!status || !music) return;
    var state = music.getState();
    var message =
      musicRouteError ||
      {
        blocked: 'Choose Retry playback.',
        unavailable:
          state.failure &&
          state.failure.kind === 'media' &&
          (state.failure.code === 3 || state.failure.code === 4)
            ? 'Check the MP3 at /media/internal/lg-xmb/background.mp3.'
            : 'Music unavailable. Retry playback.'
      }[state.phase] ||
      '';
    statusText(status, message);
    if (retry) {
      var hide = state.phase !== 'blocked' && state.phase !== 'unavailable' && !musicRouteError;
      if (hide && document.activeElement === retry) {
        var choice = $('modalContent').querySelector('[aria-pressed="true"]');
        if (choice) LGXMBMenuFocus(choice);
      }
      retry.hidden = hide;
    }
  }
  function openMusicSettings() {
    choiceGroup(
      'Background music',
      [
        [true, 'On'],
        [false, 'Off']
      ],
      preferences.musicEnabled,
      function (value) {
        preferences.musicEnabled = value;
        music.setEnabled(value);
        save();
        updateMusicStatus();
      }
    );
    choiceGroup(
      'Music volume',
      [
        [0.1, '10%'],
        [0.25, '25%'],
        [0.5, '50%'],
        [0.75, '75%'],
        [1, '100%']
      ],
      preferences.musicVolume,
      function (value) {
        preferences.musicVolume = value;
        music.setVolume(value);
        save();
      }
    );
    var status = document.createElement('p');
    status.id = 'musicStatus';
    status.className = 'wave-quality-note';
    status.setAttribute('role', 'status');
    $('modalContent').appendChild(status);
    var retry = row('Retry playback', null, false, function () {
      music.retry();
      updateMusicStatus();
    });
    retry.id = 'retryMusic';
    reserveAction(retry);
    updateMusicStatus();
  }
  // Bubble after navigation/launch handlers, so a gesture that leaves Home cannot
  // revive an autoplay-blocked track on the way out.
  function musicGesture(event) {
    // This dialog has an explicit retry. Arrow navigation must not hide the
    // focused retry button by starting a new autoplay attempt on every key.
    if (!modalOpen || modalType !== 'sound') music.gesture(event);
  }
  window.addEventListener('keydown', musicGesture);
  window.addEventListener('click', musicGesture);
  function helperStatusMessage(state) {
    if (preferences.previewMode !== 'cached' || state.captureHealth === 'running') return '';
    if (state.phase === 'starting') return 'Preparing preview helper...';
    if (state.captureRecovering) return '';
    if (state.phase === 'failed') return 'Preview helper unavailable. Retry setup.';
    if (state.phase === 'waiting') return 'Preview helper is still starting.';
    if (state.ready && !state.captureRunning) return 'Preview capture did not start.';
    return (
      {
        stale: 'Cached preview helper is not responding.',
        stopped: 'Cached preview helper stopped.',
        missing: 'Preview status is missing. Retry setup.',
        skipped: 'Cached preview could not be updated.',
        waiting: 'Preview helper is still starting.',
        unknown: state.ready ? 'Preview status unavailable. Retry setup.' : ''
      }[state.captureHealth] || ''
    );
  }
  function updateHelperStatus() {
    var status = $('helperStatus'),
      retry = $('retryHelper');
    if (!status || !window.LGXMBHelper) return;
    var state = LGXMBHelper.getState(),
      message = helperStatusMessage(state);
    statusText(status, message);
    if (retry) {
      var hidden = !message || state.phase === 'starting';
      if (hidden && document.activeElement === retry) {
        var choice = $('modalContent').querySelector('[aria-pressed="true"]');
        if (choice) LGXMBMenuFocus(choice);
      }
      retry.hidden = hidden;
    }
  }
  function watchHelperStatus(value) {
    if (window.LGXMBHelper && typeof LGXMBHelper.watchCapture === 'function')
      LGXMBHelper.watchCapture(value);
  }
  function helperLifecycle(method) {
    if (C5TV.isTV() && window.LGXMBHelper && typeof LGXMBHelper[method] === 'function')
      LGXMBHelper[method]();
  }
  function helperStatusPanel() {
    if (!C5TV.isTV() || !window.LGXMBHelper) return;
    var status = document.createElement('p');
    status.id = 'helperStatus';
    status.className = 'modal-intro';
    status.setAttribute('role', 'status');
    $('modalContent').appendChild(status);
    var retry = row('Retry helper setup', null, false, function () {
      LGXMBHelper.retry()
        .then(
          function () {
            return LGXMBHelper.checkCapture();
          },
          function () {
            return LGXMBHelper.checkCapture();
          }
        )
        .then(updateHelperStatus);
    });
    retry.id = 'retryHelper';
    reserveAction(retry);
    watchHelperStatus(true);
    LGXMBHelper.checkCapture().then(updateHelperStatus);
    updateHelperStatus();
  }
  function refreshHelperAssets(generation) {
    if (preferences.sound) sounds.retry();
    if (
      (generation === undefined || generation === launchGeneration) &&
      pageActive &&
      !document.hidden &&
      !busy &&
      currentPort() &&
      preferences.previewMode === 'cached'
    )
      thumbnail.refresh();
  }
  function startHelper() {
    if (!C5TV.isTV() || !window.LGXMBHelper) return;
    var generation = launchGeneration;
    LGXMBHelper.ensure().then(
      function () {
        // The aliases may have appeared after the first attempted preload.
        refreshHelperAssets(generation);
      },
      function () {
        /* Settings show setup failures; navigation stays usable. */
      }
    );
  }
  document.addEventListener('lg-xmb-helper-recovered', function () {
    refreshHelperAssets();
  });
  document.addEventListener('lg-xmb-helper-status', updateHelperStatus);
  function closeModal(quiet) {
    cancelNavigation();
    if (itemOptions.opened) {
      itemOptions.close(quiet === true ? 'lifecycle' : 'back');
      return;
    }
    if (quiet !== true) tick('cancel');
    if (modalType === 'wave-colors' || modalType === 'theme') {
      var returnId = modalType === 'theme' ? 'openTheme' : 'openWaveColors';
      openModal('appearance');
      LGXMBMenuFocus($(returnId));
      return;
    }
    if (modalType === 'remote') C5RemoteSettings.close();
    if (modalType === 'datetime') dateTimeSettings.close();
    watchHelperStatus(false);
    modalOpen = false;
    $('modalBackdrop').hidden = true;
    document.querySelector('.screen').classList.remove('modal-dimmed');
    document.querySelector('.screen').removeAttribute('aria-hidden');
    $('items').focus();
    refreshRecent();
    renderDetail();
  }
  function modalKey(event) {
    if (event.key === 'Escape' || event.key === 'Backspace' || event.keyCode === 461) {
      event.preventDefault();
      closeModal();
      return;
    }
    if (modalType === 'datetime') {
      dateTimeSettings.key(event);
      return;
    }
    if (modalType === 'wave-colors') {
      LGXMBWaveColorSettings.key(event, $('modal'));
      return;
    }
    settingsUI.key(event, $('modal'));
  }

  async function activate() {
    if (busy || !pageActive || document.hidden || itemOptions.opened) return;
    if (itemOptions.removal) {
      toast('App deletion is still in progress.');
      return;
    }
    cancelHold();
    if (currentItem().action === 'empty') return;
    categoryTransition.cancel();
    var item = currentItem();
    if (['appearance', 'sound', 'previews', 'remote', 'datetime'].indexOf(item.action) !== -1) {
      tick('option');
      openModal(item.action);
      recordRecent(item);
      return;
    }
    tick('decide');
    await leaveHome(
      function () {
        return item.action === 'input' ? C5TV.openInput(item.id) : C5TV.launch(item.id);
      },
      function (result, generation) {
        if (!result.preview) {
          recordRecent(item);
          if (
            generation !== launchGeneration &&
            pageActive &&
            !document.hidden &&
            !busy &&
            !modalOpen
          )
            refreshRecent();
        } else if (generation === launchGeneration && pageActive && !document.hidden) {
          toast('Preview · ' + item.title + ' opens on your TV.');
        }
      },
      'Could not open ' + item.title + '. '
    );
  }
  // Both explicit launches and idle-screen Back leave through the same media
  // lifecycle. A Home press invalidates pending work before it can launch late.
  async function leaveHome(operation, onResult, failureMessage) {
    cancelNavigation();
    cancelHold();
    categoryTransition.cancel();
    var generation = ++launchGeneration;
    clearToast();
    busy = true;
    musicAway = true;
    syncInputPreview();
    var launched = false;
    $('items').setAttribute('aria-busy', 'true');
    try {
      var result = await operation(function () {
        return generation === launchGeneration && pageActive && !document.hidden;
      });
      if (onResult) onResult(result, generation);
      if (generation !== launchGeneration || !pageActive || document.hidden) return;
      launched = !result.preview && result.returned !== false;
    } catch (error) {
      if (generation === launchGeneration && pageActive && !document.hidden) {
        tick('error');
        toast(failureMessage + (error.message || 'Please try again.'));
      }
    } finally {
      if (generation === launchGeneration) {
        busy = false;
        $('items').removeAttribute('aria-busy');
        if (!launched && pageActive && !document.hidden) {
          musicAway = false;
          renderDetail();
          $('items').focus();
        }
      }
    }
  }
  function back() {
    if (modalOpen) {
      closeModal();
      return;
    }
    if (busy || !pageActive || document.hidden || preferences.backBehavior === 'stay') return;
    tick('cancel');
    if (preferences.backBehavior === 'previous') {
      leaveHome(
        function (isCurrent) {
          return C5TV.returnToPrevious(isCurrent);
        },
        null,
        'Could not return to the previous app. '
      );
      return;
    }
    var generation = ++launchGeneration;
    C5TV.platformBack().catch(function (error) {
      if (generation === launchGeneration && pageActive && !document.hidden)
        toast(error.message || 'Could not open the TV exit prompt.');
    });
  }
  // Main-menu activation happens on release; otherwise a long OK would launch
  // the app before the options timer had a chance to fire.
  var directionRepeat = new LGXMBDirectionalRepeat({ onDirection: handleKey });
  var wheelNavigation = new LGXMBWheelNavigation({
    pixelStep: C5TV.isTV() ? 120 : 100,
    onSteps: function (steps) {
      if (busy || modalOpen || waveOnly || !pageActive || document.hidden) return;
      if (!wheelInputActive) {
        wheelInputActive = true;
        document.body.classList.add('wheel-navigation');
      }
      // Apply a fast spin's distance once, so skipped rows do not start previews
      // or produce extra sounds and layout work within the same frame.
      navigate(steps > 0 ? 'down' : 'up', Math.abs(steps));
    }
  });
  var wheelInputActive = false;
  function cancelWheelNavigation() {
    if (wheelNavigation) wheelNavigation.cancel();
    if (wheelInputActive) {
      wheelInputActive = false;
      document.body.classList.remove('wheel-navigation');
    }
  }
  function cancelNavigation() {
    if (directionRepeat) directionRepeat.cancel();
    cancelWheelNavigation();
  }
  function handleKey(event) {
    if (!pageActive || document.hidden) {
      directionRepeat.cancel();
      return;
    }
    var isActivate = event.key === 'Enter' || event.keyCode === 13,
      isBack = event.key === 'Escape' || event.key === 'Backspace' || event.keyCode === 461;
    if (!pointerHold) suppressHoldClick = false;
    if (waveOnly) {
      event.preventDefault();
      if (isBack && !event.repeat) setWaveOnly(false);
      return;
    }
    if (isActivate && hold.state) {
      event.preventDefault();
      return;
    }
    if (itemOptions.opened) {
      itemOptions.key(event);
      return;
    }
    if (event.repeat && (isActivate || isBack)) {
      event.preventDefault();
      return;
    }
    if (modalOpen) {
      modalKey(event);
      return;
    }
    if (event.key === 'ContextMenu' || event.key === 'F2') {
      event.preventDefault();
      cancelHold();
      if (!event.repeat) openItemOptions();
      return;
    }
    var direction = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[
      event.key
    ];
    if (direction) {
      event.preventDefault();
      cancelHold();
      lastDirection = performance.now();
      navigate(direction);
      if (document.activeElement !== $('items')) $('items').focus();
    } else if (isActivate) {
      event.preventDefault();
      if (busy || !pageActive || document.hidden) return;
      if (itemOptions.removal) {
        toast('App deletion is still in progress.');
        return;
      }
      var identity = categories[selectedCategory].id + ':' + currentItem().id;
      function stillSelected() {
        return identity === categories[selectedCategory].id + ':' + currentItem().id;
      }
      itemOptions.prepare(currentItem(), categories[selectedCategory]);
      hold.down(
        'key',
        function () {
          if (stillSelected()) activate();
        },
        function () {
          if (stillSelected()) openItemOptions();
        }
      );
    } else if (isBack) {
      event.preventDefault();
      cancelHold();
      back();
    }
  }
  document.addEventListener('keydown', function (event) {
    cancelWheelNavigation();
    if (!pageActive || document.hidden) {
      directionRepeat.cancel();
      return;
    }
    if (directionRepeat.handle(event)) return;
    // An action changes the target of navigation; never deliver an old arrow afterward.
    directionRepeat.cancel();
    handleKey(event);
  });

  document.addEventListener('keyup', function (event) {
    directionRepeat.keyup(event);
    if (event.key === 'Enter' || event.keyCode === 13) {
      event.preventDefault();
      hold.up('key');
    }
  });
  window.addEventListener('blur', function () {
    cancelNavigation();
  });
  // Holding an item with the Magic Remote, mouse or touch uses the same timer.
  function pointerItem(target) {
    return target.closest && target.closest('#items>.rows:not(.parked)>.item');
  }
  document.addEventListener(
    'pointerdown',
    function (e) {
      cancelNavigation();
      suppressHoldClick = false;
      if (
        e.button !== 0 ||
        e.isPrimary === false ||
        busy ||
        modalOpen ||
        waveOnly ||
        !pageActive ||
        document.hidden
      )
        return;
      var b = pointerItem(e.target);
      if (!b) return;
      var index = categories[selectedCategory].items.findIndex(function (i) {
        return i.id === b.dataset.item;
      });
      if (index < 0) return;
      cancelHold();
      selections[selectedCategory] = index;
      render();
      pointerHold = { id: e.pointerId, x: e.clientX, y: e.clientY };
      itemOptions.prepare(currentItem(), categories[selectedCategory]);
      hold.down(
        'pointer',
        function () {},
        function () {
          suppressHoldClick = true;
          openItemOptions();
        }
      );
    },
    true
  );
  document.addEventListener(
    'pointermove',
    function (e) {
      if (
        pointerHold &&
        e.pointerId === pointerHold.id &&
        Math.hypot(e.clientX - pointerHold.x, e.clientY - pointerHold.y) > 12
      ) {
        suppressHoldClick = true;
        cancelHold();
      }
    },
    true
  );
  document.addEventListener(
    'pointerup',
    function (e) {
      if (pointerHold && e.pointerId === pointerHold.id) {
        hold.up('pointer');
        pointerHold = null;
      }
    },
    true
  );
  document.addEventListener(
    'pointercancel',
    function () {
      suppressHoldClick = true;
      cancelHold();
    },
    true
  );
  document.addEventListener(
    'click',
    function (e) {
      cancelWheelNavigation();
      if (suppressHoldClick) {
        suppressHoldClick = false;
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true
  );
  document.addEventListener('contextmenu', function (e) {
    if (itemOptions.opened) {
      e.preventDefault();
      return;
    }
    if (modalOpen || waveOnly || busy || !pageActive || document.hidden) return;
    var b = pointerItem(e.target);
    if (!b && !$('items').contains(e.target)) return;
    e.preventDefault();
    cancelHold();
    if (b) {
      var at = categories[selectedCategory].items.findIndex(function (i) {
        return i.id === b.dataset.item;
      });
      if (at >= 0) {
        selections[selectedCategory] = at;
        render();
      }
    }
    suppressHoldClick = true;
    openItemOptions();
  });
  window.addEventListener('blur', cancelHold);
  document.addEventListener(
    'click',
    function (event) {
      if (waveOnly) {
        event.preventDefault();
        event.stopPropagation();
        setWaveOnly(false);
      }
    },
    true
  );
  document.addEventListener(
    'wheel',
    function (event) {
      if (waveOnly || busy || !pageActive || document.hidden) {
        cancelWheelNavigation();
        event.preventDefault();
        return;
      }
      if (modalOpen) {
        cancelNavigation();
        if (itemOptions.opened && itemOptions.panel.contains(event.target)) return;
        if ($('modal').contains(event.target)) return;
        event.preventDefault();
        return;
      }
      if (wheelNavigation.handle(event)) {
        directionRepeat.cancel();
        cancelHold();
        lastDirection = performance.now();
      }
    },
    { passive: false }
  );
  $('modalBackdrop').addEventListener('click', function (event) {
    if (event.target === $('modalBackdrop')) closeModal();
  });
  $('previewButton').addEventListener('click', function () {
    if (busy || modalOpen) return;
    activate();
  });
  var themeMonth = new Date().getMonth();
  function updateClock() {
    var now = new Date();
    if (themeMonth !== now.getMonth()) {
      themeMonth = now.getMonth();
      if (preferences.theme === 'seasonal') {
        seasonal();
        wave.setTheme(Object.assign({}, themes.seasonal, { colors: preferences.waveColors }));
      }
    }
    var time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      date = now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
    if ($('time').textContent !== time) {
      $('time').textContent = time;
      $('time').dateTime = now.toISOString();
    }
    if ($('date').textContent !== date) $('date').textContent = date;
  }
  function restoreFocus() {
    if (itemOptions.opened) {
      if (!itemOptions.panel.contains(document.activeElement)) itemOptions.focus();
      return;
    }
    if (modalOpen) {
      if (!$('modal').contains(document.activeElement)) {
        var control =
          $('modalContent').querySelector('[aria-pressed="true"]') ||
          $('modalContent').querySelector('button') ||
          $('modal');
        LGXMBMenuFocus(control);
      }
    } else if (document.activeElement !== $('items')) $('items').focus();
  }
  async function refreshInputLabels() {
    if (!pageActive || document.hidden || inputLabelRead) return;
    var read;
    try {
      read = C5TV.listInputLabels();
      inputLabelRead = read;
      var result = await read;
      if (inputLabelRead !== read || !pageActive || document.hidden || result.preview) return;
      var inputCategory = categories.find(function (category) {
        return category.id === 'tv';
      });
      if (!inputCategory) return;
      var visible = categories[selectedCategory] === inputCategory,
        changed = false;
      inputCategory.items.forEach(function (item, index) {
        if (item.action !== 'input') return;
        var input = result.inputs.find(function (entry) {
          return entry.id === item.id;
        });
        if (!input) return;
        var type = input.label === 'HDMI ' + input.port ? 'INPUT' : 'HDMI ' + input.port;
        if (item.title === input.label && item.type === type) return;
        item.title = input.label;
        item.type = type;
        changed = true;
        // Update text in place: keep row nodes, selection, focus and port bindings.
        if (visible) {
          launcherView.updateItemLabel(selectedCategory, index, item);
        }
      });
      if (changed && menuOrder.modes[inputCategory.id] !== 'default') {
        var ci = categories.indexOf(inputCategory),
          id = inputCategory.items[selections[ci]] && inputCategory.items[selections[ci]].id;
        selections[ci] = menuOrder.apply(inputCategory, id);
        buildItems();
        renderRows(selectedCategory);
        $('items').setAttribute('aria-activedescendant', 'item-' + selections[selectedCategory]);
      }
      if (visible && changed) {
        // Metadata must not restart media after a successful launch but before hide.
        renderDetailText();
        if (!modalOpen) announceSelection();
      }
    } catch (error) {
      // Optional firmware API: keep defaults or the last successful names.
    } finally {
      if (inputLabelRead === read) inputLabelRead = null;
    }
  }
  function cancelInputLabels() {
    var read = inputLabelRead;
    inputLabelRead = null;
    if (read && typeof read.cancel === 'function') {
      try {
        read.cancel();
      } catch (ignore) {}
    }
  }
  function restorePage(refreshStill) {
    if (document.hidden) return;
    var now = performance.now(),
      wasActive = pageActive,
      before = thumbnail.getState();
    pageActive = true;
    refreshRecent();
    sounds.setActive(true);
    musicAway = false;
    syncWavePlayback();
    renderDetail();
    if (
      refreshStill &&
      wasActive &&
      now - lastReturnAt >= 250 &&
      preferences.previewMode === 'cached' &&
      before.port === currentPort() &&
      before.port !== null &&
      before.status !== 'loading'
    )
      thumbnail.refresh();
    lastReturnAt = now;
    updateClock();
    restoreFocus();
    if (!wasActive || refreshStill) refreshInputLabels();
    if (C5TV.isTV()) appRefresh.resume();
    helperLifecycle('resume');
  }
  function suspendPage() {
    helperLifecycle('suspend');
    cancelNavigation();
    appRefresh.pause();
    if (modalType === 'datetime') {
      dateTimeSettings.close();
      modalOpen = false;
      modalType = '';
      $('modalBackdrop').hidden = true;
      document.querySelector('.screen').classList.remove('modal-dimmed');
      document.querySelector('.screen').removeAttribute('aria-hidden');
    }
    cancelHold();
    itemOptions.close('lifecycle');
    categoryTransition.cancel();
    var wasActive = pageActive;
    pageActive = false;
    sounds.setActive(false);
    music.setContext(false, false);
    cancelInputLabels();
    invalidateLaunch();
    clearToast();
    clearTimeout(announceTimer);
    if (wasActive) {
      stopInputPreview();
      thumbnail.setPaused(true);
      syncWavePlayback();
    }
  }
  function handleRelaunch() {
    cancelNavigation();
    cancelHold();
    if (itemOptions.opened) itemOptions.close('lifecycle');
    setWaveOnly(false);
    categoryTransition.cancel();
    invalidateLaunch();
    clearToast();
    if (modalOpen) closeModal(true);
    restorePage(true);
  }
  // handlesRelaunch stays false: webOS brings the app forward automatically.
  // A Home press while already visible still needs to leave any open dialog.
  document.addEventListener('webOSRelaunch', handleRelaunch, true);
  appCategories.rebuild(selections);
  categories.forEach(function (c, ci) {
    selections[ci] = menuOrder.apply(c, c.items[selections[ci]] && c.items[selections[ci]].id);
  });
  buildCategories();
  buildItems();
  applyPreferences();
  render();
  sounds.prepare();
  updateClock();
  var clockTimer = setInterval(updateClock, 10000);
  $('items').focus();
  if (C5TV.isTV()) appRefresh.resume();
  refreshInputLabels();
  startHelper();
  helperLifecycle('resume');
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      suspendPage();
    } else restorePage(false);
  });
  window.addEventListener('resize', function () {
    cancelNavigation();
    cancelHold();
    categoryTransition.cancel();
  });
  window.addEventListener('pagehide', suspendPage);
  window.addEventListener('pageshow', function () {
    restorePage(false);
  });
  window.addEventListener('beforeunload', function () {
    clearInterval(clockTimer);
    suspendPage();
    helperLifecycle('destroy');
    appRefresh.destroy();
    categoryTransition.destroy();
    itemOptions.destroy();
    sounds.destroy();
    music.destroy();
    thumbnail.destroy();
    inputPreview.destroy();
    wave.destroy();
  });
  window.C5App = {
    getState: function () {
      return {
        category: categories[selectedCategory].id,
        item: currentItem().id,
        modal: modalOpen ? modalType : null,
        remote: modalOpen && modalType === 'remote' ? C5RemoteSettings.getState() : null,
        preferences: Object.assign({}, preferences),
        busy: busy,
        appRefresh: appRefresh.getState(),
        appCategories: appCategories.snapshot(),
        itemOptions: itemOptions.getState(),
        detailPending: detailTimer !== 0,
        detailItem: detailItemId,
        music: music.getState(),
        sounds: sounds.getState(),
        thumbnail: thumbnail.getState(),
        inputPreview: inputPreview.getState(),
        waveOnly: waveOnly,
        waveMode: wave.mode,
        waveError: wave.error || null,
        waveDiagnostics: wave.getDiagnostics()
      };
    }
  };
})();
