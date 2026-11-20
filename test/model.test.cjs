'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveInput, webURL, settingsFrom, restoreFrom } = require('../src/model.cjs');

test('address bar accepts web URLs, domains, IPv6, IDNs, and local development ports', () => {
  assert.equal(resolveInput(' https://example.org/path '), 'https://example.org/path');
  assert.equal(resolveInput('example.org:8443/docs?tab=a#here'), 'https://example.org:8443/docs?tab=a#here');
  assert.equal(resolveInput('localhost:4321/test'), 'http://localhost:4321/test');
  assert.equal(resolveInput('[::1]:4321'), 'http://[::1]:4321/');
  assert.equal(resolveInput('bücher.de'), 'https://xn--bcher-kva.de/');
});

test('search text uses the configured provider with encoded parameters', () => {
  assert.equal(resolveInput('sea & sky', 'google'), 'https://www.google.com/search?q=sea%20%26%20sky');
  assert.equal(resolveInput('weather', 'constructor'), 'https://duckduckgo.com/?q=weather');
  assert.equal(resolveInput(' '), null);
});

test('privileged schemes, unusable addresses, and credentialed URLs are rejected', () => {
  for (const address of ['file:///tmp/a', 'javascript:alert(1)', 'tideway://app', 'data:text/html,hi', 'https://', 'https://name:pass@example.org/']) {
    assert.equal(resolveInput(address), null);
    assert.equal(webURL(address), null);
  }
});

test('profile inputs use safe defaults and bounded session snapshots', () => {
  assert.deepEqual(settingsFrom({ engine: 'constructor', restore: 'true', theme: 'neon' }),
    { engine: 'duckduckgo', theme: 'system', restore: false });
  assert.deepEqual(restoreFrom({ urls: ['https://example.org', 'file:///tmp/a', ''], index: 99 }),
    { urls: ['https://example.org/', '', ''], index: 2 });
});
