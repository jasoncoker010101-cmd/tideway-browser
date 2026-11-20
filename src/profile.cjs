'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { webURL, settingsFrom, restoreFrom } = require('./model.cjs');

function readState(directory) {
  try {
    const file = path.join(directory, 'profile.json');
    if (fs.statSync(file).size > 12_000_000) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8')) ?? {};
  } catch {
    return {};
  }
}

function webRows(input, limit) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, limit).flatMap(row => {
    const url = webURL(row?.url);
    return url ? [{ url: url.href, title: String(row.title || url.hostname).slice(0, 240), at: Number(row.at) || Date.now() }] : [];
  });
}

class Profile {
  constructor(directory) {
    this.file = path.join(directory, 'profile.json');
    const saved = readState(directory);
    this.settings = settingsFrom(saved.settings);
    this.history = webRows(saved.history, 1000);
    this.bookmarks = webRows(saved.bookmarks, 500);
    this.restore = restoreFrom(saved.restore);
    this.downloads = Array.isArray(saved.downloads) ? saved.downloads.slice(0, 100).filter(row =>
      typeof row?.id === 'string' && typeof row.name === 'string' && typeof row.path === 'string' &&
      ['completed', 'cancelled', 'interrupted'].includes(row.state)) : [];
    this.timer = null;
  }

  queue() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 250);
    this.timer.unref();
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    const payload = { settings: this.settings, history: this.history, bookmarks: this.bookmarks,
      restore: this.settings.restore ? this.restore : undefined, downloads: this.downloads.filter(row => row.state !== 'progressing') };
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(payload), { mode: 0o600 });
      fs.renameSync(`${this.file}.tmp`, this.file);
    } catch (error) {
      console.error('Could not save the Tideway profile:', error.message);
    }
  }

  visit(url, title, updateOnly = false) {
    if (!webURL(url)) return;
    const index = this.history.findIndex(row => row.url === url);
    if (updateOnly) {
      if (index < 0 || this.history[index].title === title || !title) return;
      this.history[index].title = title;
    } else {
      if (index >= 0) this.history.splice(index, 1);
      this.history.unshift({ url, title, at: Date.now() });
      this.history.length = Math.min(this.history.length, 1000);
    }
    this.queue();
  }

  toggleBookmark(url, title) {
    if (!webURL(url)) return;
    const index = this.bookmarks.findIndex(row => row.url === url);
    if (index >= 0) this.bookmarks.splice(index, 1);
    else this.bookmarks.unshift({ url, title, at: Date.now() });
    this.bookmarks.length = Math.min(this.bookmarks.length, 500);
    this.queue();
  }
}

module.exports = { Profile };
