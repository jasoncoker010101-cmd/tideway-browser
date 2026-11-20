'use strict';

const engines = Object.freeze({
  duckduckgo: 'https://duckduckgo.com/?q=',
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q='
});
const defaultSettings = Object.freeze({ engine: 'duckduckgo', theme: 'system', restore: false });

function webURL(value) {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function resolveInput(input, engine = 'duckduckgo') {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (!value || value.length > 4096) return null;
  if (/^https?:/i.test(value)) return webURL(value)?.href ?? null;
  // Interpret domains with an optional port before rejecting other URI schemes.
  const host = value.split(/[/?#]/, 1)[0];
  const isLocal = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i.test(host);
  if (!/\s/.test(value) && (isLocal || /^(?:[\p{L}\d-]+\.)+[\p{L}\d-]+(?::\d+)?$/iu.test(host) || /^\[[\da-f:]+\](?::\d+)?$/i.test(host))) {
    return webURL(`${isLocal ? 'http' : 'https'}://${value}`)?.href ?? null;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return null;
  return `${Object.hasOwn(engines, engine) ? engines[engine] : engines.duckduckgo}${encodeURIComponent(value)}`;
}

function settingsFrom(input) {
  const raw = input && typeof input === 'object' ? input : {};
  return {
    engine: Object.hasOwn(engines, raw.engine) ? raw.engine : defaultSettings.engine,
    theme: ['system', 'dark', 'light'].includes(raw.theme) ? raw.theme : defaultSettings.theme,
    restore: raw.restore === true
  };
}

function restoreFrom(input) {
  const urls = Array.isArray(input?.urls) ? input.urls.slice(0, 35).map(url => webURL(url)?.href ?? '') : [];
  return { urls, index: Number.isInteger(input?.index) ? Math.min(Math.max(0, input.index), Math.max(0, urls.length - 1)) : 0 };
}

module.exports = { webURL, resolveInput, settingsFrom, restoreFrom };
