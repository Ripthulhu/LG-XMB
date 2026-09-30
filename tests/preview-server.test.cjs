// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const createServer = require('../tools/preview.cjs');

test('shared preview serves app files and rejects invalid paths', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const request = (path) =>
    new Promise((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port: server.address().port, path }, (response) => {
          let body = '';
          response.setEncoding('utf8').on('data', (chunk) => {
            body += chunk;
          });
          response.on('end', () =>
            resolve({ status: response.statusCode, headers: response.headers, body })
          );
        })
        .on('error', reject);
    });
  try {
    const home = await request('/');
    assert.equal(home.status, 200);
    assert.equal(home.headers['content-type'], 'text/html');
    assert.ok(home.body.includes('<title>'));
    assert.equal((await request('/app.js')).headers['content-type'], 'text/javascript');
    assert.equal((await request('/missing-file')).status, 404);
    assert.equal((await request('/%')).status, 400);
    assert.equal((await request('/..%2fpackage.json')).status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
