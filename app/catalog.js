/* Curated TV shortcuts in XMB order. SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';

  /* Curated TV shortcuts in XMB order. SPDX-License-Identifier: GPL-3.0-or-later */
  // Media Player is shared intentionally: no undocumented photo/music/video
  // launch parameters. Other discovered apps remain in Apps.
  var categories = [
    {
      id: 'settings',
      title: 'Settings',
      icon: 'settings',
      items: [
        {
          id: 'appearance',
          title: 'Appearance',
          icon: 'palette',
          type: 'SETTING',
          description: 'Choose a theme and configure the animated background.',
          action: 'appearance'
        },
        {
          id: 'sound',
          title: 'Sound',
          icon: 'sound',
          type: 'SETTING',
          description: 'Configure navigation sounds and background music.',
          action: 'sound'
        },
        {
          id: 'previews',
          title: 'Input previews',
          icon: 'hdmi',
          type: 'SETTING',
          description: 'Choose cached pictures or live video.',
          action: 'previews'
        },
        {
          id: 'remote',
          title: 'Back button',
          icon: 'remote',
          type: 'SETTING',
          description: 'Choose whether Back keeps Home open or shows the TV exit prompt.',
          action: 'remote'
        },
        {
          id: 'datetime',
          title: 'Date & time',
          icon: 'clock',
          type: 'SETTING',
          description: 'Set the TV date and time.',
          action: 'datetime'
        },
        {
          id: 'com.palm.app.settings',
          title: 'TV Settings',
          icon: 'settings',
          type: 'SETTING',
          description: 'Open picture, sound, and TV settings.'
        }
      ]
    },
    {
      id: 'photo',
      title: 'Photo',
      icon: 'image',
      items: [
        {
          id: 'com.webos.app.lifeonscreen',
          title: 'LG Gallery+',
          icon: 'image',
          type: 'PHOTO',
          description: 'Open LG Gallery+.'
        },
        {
          id: 'com.webos.app.mediadiscovery',
          title: 'Media Player',
          icon: 'media',
          type: 'PHOTO',
          description: 'Open the TV media browser for photos, music, and videos.'
        }
      ]
    },
    {
      id: 'music',
      title: 'Music',
      icon: 'music',
      items: [
        {
          id: 'com.webos.app.totalmusic',
          title: 'Music',
          icon: 'music',
          type: 'MUSIC',
          description: 'Open the music player.'
        },
        {
          id: 'com.webos.app.mediadiscovery',
          title: 'Media Player',
          icon: 'media',
          type: 'MUSIC',
          description: 'Open the TV media browser for photos, music, and videos.'
        }
      ]
    },
    {
      id: 'video',
      title: 'Video',
      icon: 'media',
      items: [
        {
          id: 'com.webos.app.mediadiscovery',
          title: 'Media Player',
          icon: 'media',
          type: 'VIDEO',
          description: 'Open the TV media browser for photos, music, and videos.'
        }
      ]
    },
    {
      id: 'tv',
      title: 'TV',
      icon: 'live',
      items: [
        {
          id: 'com.webos.app.livetv',
          title: 'Live TV',
          icon: 'live',
          type: 'TV',
          description: 'Watch television channels.'
        },
        {
          id: 'com.webos.app.lgchannels',
          title: 'LG Channels',
          icon: 'channels',
          type: 'TV',
          description: 'Open LG Channels.'
        },
        {
          id: 'com.webos.app.hdmi1',
          title: 'HDMI 1',
          icon: 'hdmi',
          type: 'INPUT',
          description: 'Switch to HDMI 1.',
          action: 'input'
        },
        {
          id: 'com.webos.app.hdmi2',
          title: 'HDMI 2',
          icon: 'hdmi',
          type: 'INPUT',
          description: 'Switch to HDMI 2.',
          action: 'input'
        },
        {
          id: 'com.webos.app.hdmi3',
          title: 'HDMI 3',
          icon: 'hdmi',
          type: 'INPUT',
          description: 'Switch to HDMI 3.',
          action: 'input'
        },
        {
          id: 'com.webos.app.hdmi4',
          title: 'HDMI 4',
          icon: 'hdmi',
          type: 'INPUT',
          description: 'Switch to HDMI 4.',
          action: 'input'
        }
      ]
    },
    {
      id: 'apps',
      title: 'Apps',
      icon: 'apps',
      items: [
        {
          id: 'com.webos.app.homeconnect',
          title: 'Home Hub',
          icon: 'homehub',
          type: 'APP',
          description: 'Open connected devices.'
        }
      ]
    },
    {
      id: 'browser',
      title: 'Browser',
      icon: 'globe',
      items: [
        {
          id: 'com.webos.app.browser',
          title: 'Web Browser',
          icon: 'globe',
          type: 'APP',
          description: 'Open the web browser.'
        }
      ]
    },
    {
      id: 'network',
      title: 'Network',
      icon: 'network',
      items: [
        {
          id: 'org.webosbrew.hbchannel',
          title: 'Homebrew Channel',
          icon: 'brew',
          type: 'APP',
          description: 'Browse and install homebrew apps.'
        },
        {
          id: 'com.webos.app.discovery',
          title: 'LG Apps',
          icon: 'shop',
          type: 'APP',
          description: 'Browse and install TV apps.'
        }
      ]
    }
  ];

  // Icons for apps without a curated shortcut. Reuse a catalog entry when two
  // apps should share artwork; adding a shortcut then updates both automatically.
  var iconAliases = {
    'org.webosbrew.safeupdate': 'org.webosbrew.hbchannel'
  };
  var appIcons = Object.create(null);
  categories.forEach(function (category) {
    category.items.forEach(function (item) {
      if (!item.action && !appIcons[item.id]) appIcons[item.id] = item.icon;
    });
  });

  function iconForApp(id) {
    var source = Object.prototype.hasOwnProperty.call(iconAliases, id) ? iconAliases[id] : id;
    return appIcons[source] || 'application';
  }

  // C5Catalog remains the mutable menu data used by the launcher. The API also
  // exposes icon lookup without coupling the category model to SVG rendering.
  var api = { categories: categories, iconForApp: iconForApp };
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.C5Catalog = categories;
    root.LGXMBCatalog = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
