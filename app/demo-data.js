/* Desktop preview examples. Never used to discover a TV. SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';
  // Keep demo data outside the live catalog and use the same model as native
  // discovery. The launcher reads this only when it is not running on a TV.
  var examples = root.C5Catalog.reduce(function (apps, category) {
    category.items.forEach(function (item) {
      if (
        !item.action &&
        !apps.some(function (app) {
          return app.id === item.id;
        })
      )
        apps.push({ id: item.id, title: item.title });
    });
    return apps;
  }, []);
  root.LGXMBDemo = {
    apps: function () {
      return examples.map(function (app) {
        return { id: app.id, title: app.title };
      });
    },
    inputs: function () {
      return [1, 2, 3, 4].map(function (port) {
        return { id: 'com.webos.app.hdmi' + port, port: port, kind: 'hdmi', label: 'HDMI ' + port };
      });
    }
  };
})(window);
