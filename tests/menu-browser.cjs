// SPDX-License-Identifier: GPL-3.0-or-later
// Focused menu checks; separate from the complete regression suite.
'use strict';
const {chromium} = require('playwright');
const createServer = require('../tools/preview.cjs');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const root = path.resolve(__dirname,'..'), checks = [], errors = [];
  fs.mkdirSync(path.join(root,'qa'),{recursive:true});
  const server = createServer();
  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
    });
    browser = await chromium.launch({headless:true,
      ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {}),
      args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    await require('./category-transition-browser.cjs')(browser,checks,errors,
      page => page.goto('http://127.0.0.1:' + server.address().port + '/'));
    const result = {checks,errors,browser:await browser.version(),normalURL:true,testedOnTV:false};
    fs.writeFileSync(path.join(root,'qa/menu-check.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
  } finally {if (browser) await browser.close(); await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error); process.exitCode=1;});
