// SPDX-License-Identifier: GPL-3.0-or-later
// Standalone Appearance suite on an ephemeral local port. Does not touch an open preview.
'use strict';
const createServer = require('../tools/preview.cjs');
const { chromium } = require('playwright');
const { launchOptions } = require('./support/menu-navigation.cjs');
const checkAppearance = require('./settings-appearance-browser.cjs');
(async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch(launchOptions());
    const checks = [],
      errors = [];
    await checkAppearance(browser, checks, errors, 'http://127.0.0.1:' + server.address().port);
    console.log(JSON.stringify({ checks, errors, testedOnTV: false }, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
