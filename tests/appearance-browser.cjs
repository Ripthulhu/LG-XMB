// SPDX-License-Identifier: GPL-3.0-or-later
// Standalone Appearance suite on an ephemeral local port. Does not touch an open preview.
'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { launchOptions } = require('./support/menu-navigation.cjs');
const checkAppearance = require('./settings-appearance-browser.cjs');
const root = path.resolve(__dirname, '../app');
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg'
};
(async () => {
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!target.startsWith(root + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      const data = await fs.readFile(target);
      response
        .writeHead(200, {
          'Content-Type': types[path.extname(target)] || 'application/octet-stream',
          'Cache-Control': 'no-store'
        })
        .end(data);
    } catch {
      response.writeHead(404).end();
    }
  });
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
