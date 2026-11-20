'use strict';

const { app, BrowserWindow, WebContentsView, Menu, clipboard, dialog, ipcMain, nativeTheme, net, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { Profile } = require('./profile.cjs');
const { webURL, resolveInput, settingsFrom } = require('./model.cjs');

const INTERNAL = 'tideway://app/index.html';
const MAX_TABS = 35;
const SAFE = Object.freeze({ sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
  webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, devTools: false });
const internalFiles = new Set(['/index.html', '/style.css', '/ui.js']);
const owners = new Map();
const windows = new Map();
const supportedPermissions = { media: 'your camera or microphone', geolocation: 'your location', notifications: 'desktop notifications' };
const mac = process.platform === 'darwin';
let profile;

app.enableSandbox();
app.commandLine.appendSwitch('site-per-process');
protocol.registerSchemesAsPrivileged([{ scheme: 'tideway', privileges: { standard: true, secure: true, codeCache: true } }]);
if (process.env.TIDEWAY_TEST_PROFILE) app.setPath('userData', process.env.TIDEWAY_TEST_PROFILE);

function uriTitle(url) {
  return webURL(url)?.hostname || 'New tab';
}

function changingOrigin(tab) {
  return !!tab.pending && webURL(tab.pending)?.origin !== webURL(tab.url)?.origin;
}

function noPermissions(ses) {
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
}

function configurePages(ses) {
  const decisions = new Map();
  const awaiting = new Set();
  const keyFor = (wc, permission, requestingURL, isMainFrame) => {
    const here = webURL(wc?.getURL());
    const requested = webURL(requestingURL || '');
    if (isMainFrame === false || !Object.hasOwn(supportedPermissions, permission) ||
        !requested || requested.protocol !== 'https:' || requested.origin !== here?.origin) return null;
    return `${requested.origin}|${permission}`;
  };
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) =>
    decisions.get(keyFor(wc, permission, requestingOrigin, details?.isMainFrame)) === true);
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const browser = wc && owners.get(wc.id);
    if (!browser || browser.current()?.view.webContents !== wc) return callback(false);
    const key = keyFor(wc, permission, details?.requestingUrl, details?.isMainFrame);
    if (!key || awaiting.has(key)) return callback(false);
    if (decisions.has(key)) return callback(decisions.get(key));
    awaiting.add(key);
    const origin = webURL(details.requestingUrl).origin;
    dialog.showMessageBox(browser.win, {
      type: 'question', buttons: ['Block', 'Allow for this session'], defaultId: 0, cancelId: 0,
      title: 'Site permission', message: `Allow ${origin} to use ${supportedPermissions[permission]}?`,
      detail: 'Your choice lasts until the browser session closes.'
    }).then(({ response }) => {
      const stillThere = !wc.isDestroyed() && webURL(wc.getURL())?.origin === origin;
      if (stillThere) decisions.set(key, response === 1);
      callback(stillThere && response === 1);
    }, () => callback(false)).finally(() => awaiting.delete(key));
  });
  ses.setDevicePermissionHandler(() => false);
  ses.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  ses.on('will-download', (event, item, wc) => {
    const browser = wc && owners.get(wc.id);
    if (!browser || browser.win.isDestroyed()) {
      event.preventDefault();
      return;
    }
    let filename = path.basename(item.getFilename().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')).slice(0, 220);
    if (!filename || /^\.+$/.test(filename)) filename = 'download';
    item.setSaveDialogOptions({ title: 'Save download', defaultPath: path.join(app.getPath('downloads'), filename) });
    const row = {
      id: randomUUID(), name: filename, path: '', state: 'progressing', at: Date.now(), received: 0, total: item.getTotalBytes()
    };
    const rows = browser.downloads();
    rows.unshift(row);
    if (rows.length > 100) rows.pop();
    browser.changed();
    let tick = 0;
    item.on('updated', () => {
      row.received = item.getReceivedBytes();
      if (Date.now() - tick > 250) {
        tick = Date.now();
        browser.changed();
      }
    });
    item.once('done', (_event, state) => {
      row.state = state;
      row.received = item.getReceivedBytes();
      row.path = item.getSavePath();
      if (!browser.private) profile.queue();
      browser.changed();
    });
  });
}

class Browser {
  constructor(isPrivate = false, restore = false) {
    this.private = isPrivate;
    this.partition = isPrivate ? `private-${randomUUID()}` : 'persist:tideway-pages';
    const privateSession = isPrivate ? session.fromPartition(this.partition, { cache: false }) : null;
    if (privateSession) configurePages(privateSession);
    this.tabs = [];
    this.active = '';
    this.panel = '';
    this.find = false;
    this.closed = [];
    this.privateDownloads = [];
    this.mounted = null;
    this.pendingPush = false;
    this.win = new BrowserWindow({
      width: 1216, height: 820, minWidth: 610, minHeight: 460, show: false,
      title: isPrivate ? 'Tideway (Private)' : 'Tideway', backgroundColor: '#121a23', autoHideMenuBar: true,
      webPreferences: { ...SAFE, partition: 'tideway-chrome', preload: path.join(__dirname, 'preload.cjs') }
    });
    const chrome = this.win.webContents;
    windows.set(chrome.id, this);
    const chromeId = chrome.id;
    chrome.on('will-navigate', event => event.preventDefault());
    chrome.on('will-attach-webview', event => event.preventDefault());
    chrome.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.keys(chrome);
    this.win.on('resize', () => this.layout());
    this.win.on('page-title-updated', event => event.preventDefault());
    this.win.once('ready-to-show', () => this.win.show());
    this.win.on('close', () => {
      if (!this.private) this.remember();
    });
    this.win.on('closed', () => {
      windows.delete(chromeId);
      for (const tab of this.tabs) this.destroyTab(tab);
      if (privateSession) {
        void privateSession.closeAllConnections().catch(() => {});
        void privateSession.clearStorageData().catch(() => {});
        void privateSession.clearAuthCache().catch(() => {});
      }
    });
    if (restore && profile.settings.restore && profile.restore.urls.length) {
      // Copy before addTab() or activate() can change the current snapshot.
      const snapshot = profile.restore;
      for (const url of snapshot.urls) this.addTab(url, false);
      this.activate(this.tabs[snapshot.index], false);
    } else {
      this.addTab();
    }
    chrome.loadURL(INTERNAL).catch(error => console.error('Could not open browser chrome:', error.message));
  }

  current() { return this.tabs.find(tab => tab.id === this.active); }
  downloads() { return this.private ? this.privateDownloads : profile.downloads; }

  pagePreferences() { return { ...SAFE, partition: this.partition, navigateOnDragDrop: false }; }

  addTab(url = '', select = true, options = {}) {
    if (this.tabs.length >= MAX_TABS || this.win.isDestroyed()) return null;
    const view = new WebContentsView(options.webContents ? { webContents: options.webContents } : { webPreferences: this.pagePreferences() });
    view.setBackgroundColor('#ffffff');
    const tab = { id: randomUUID(), view, url: '', pending: '', title: '', busy: false, error: '',
      home: !url && !options.popup, findId: 0, matches: null, fullscreen: false };
    const wc = view.webContents;
    const wcId = wc.id;
    owners.set(wcId, this);
    wc.once('destroyed', () => owners.delete(wcId));
    this.tabs.push(tab);
    this.attach(tab);
    if (select) this.activate(tab, false);
    if (url) this.browse(tab, url);
    if (select && tab.home) this.focus('address');
    this.changed();
    return tab;
  }

  attach(tab) {
    const wc = tab.view.webContents;
    this.keys(wc);
    wc.on('will-attach-webview', event => event.preventDefault());
    const guard = (event, to, _same, isMainFrame) => {
      const url = event.url ?? to;
      if ((event.isMainFrame ?? isMainFrame) !== false && url !== 'about:blank' && !webURL(url)) event.preventDefault();
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.on('did-start-loading', () => { tab.busy = true; tab.error = ''; this.changed(); });
    wc.on('did-stop-loading', () => {
      tab.busy = false;
      if (!tab.error) tab.pending = '';
      this.layout();
      this.changed();
    });
    wc.on('did-start-navigation', (event, to, same, principal) => {
      const url = event.url ?? to;
      if ((event.isMainFrame ?? principal) && !(event.isSameDocument ?? same) && webURL(url)) {
        tab.pending = url;
        tab.error = '';
        this.layout();
        this.changed();
      }
    });
    const visited = (url, newDocument = true) => {
      tab.url = webURL(url)?.href ?? '';
      tab.pending = '';
      tab.error = '';
      tab.home = false;
      if (newDocument) {
        tab.title = '';
        tab.matches = null;
        tab.findId = 0;
      }
      if (!this.private && tab.url) profile.visit(tab.url, tab.title || uriTitle(tab.url));
      this.remember();
      this.layout();
      if (tab.focusOnCommit && this.mounted === tab.view) wc.focus();
      tab.focusOnCommit = false;
      this.changed();
    };
    wc.on('did-navigate', (_event, url) => visited(url));
    wc.on('did-navigate-in-page', (_event, url, isMainFrame) => { if (isMainFrame) visited(url, false); });
    wc.on('page-title-updated', (_event, title) => {
      tab.title = title.trim().slice(0, 240);
      if (!this.private && tab.url) profile.visit(tab.url, tab.title, true);
      this.changed();
    });
    wc.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      tab.pending = '';
      tab.url = webURL(url)?.href ?? tab.url;
      tab.title = '';
      tab.error = description;
      tab.busy = false;
      this.layout();
      this.changed();
    });
    wc.on('render-process-gone', () => {
      tab.error = 'The page process closed unexpectedly.';
      tab.busy = false;
      tab.fullscreen = false;
      this.layout();
      this.changed();
    });
    wc.on('enter-html-full-screen', () => { tab.fullscreen = true; this.layout(); });
    wc.on('leave-html-full-screen', () => { tab.fullscreen = false; this.layout(); });
    wc.on('found-in-page', (_event, result) => {
      if (result.requestId === tab.findId) {
        tab.matches = { current: result.activeMatchOrdinal, total: result.matches };
        this.changed();
      }
    });
    wc.setWindowOpenHandler(details => {
      if ((!webURL(details.url) && details.url !== 'about:blank') || this.current() !== tab || this.tabs.length >= MAX_TABS) {
        return { action: 'deny' };
      }
      return { action: 'allow', outlivesOpener: true, overrideBrowserWindowOptions: { webPreferences: this.pagePreferences() }, createWindow: options => {
        const child = this.addTab('', details.disposition !== 'background-tab', { popup: true, webContents: options.webContents });
        if (!child) throw new Error('Cannot open another tab');
        return child.view.webContents;
      } };
    });
    wc.on('close', () => this.closeTab(tab));
    wc.on('context-menu', (_event, params) => {
      if (this.win.isDestroyed()) return;
      const items = [];
      if (webURL(params.linkURL)) items.push(
        { label: 'Open link in new tab', click: () => this.addTab(params.linkURL, false) },
        { label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) });
      if (params.isEditable) items.push(
        { label: 'Cut', enabled: params.editFlags.canCut, click: () => wc.cut() },
        { label: 'Copy', enabled: params.editFlags.canCopy, click: () => wc.copy() },
        { label: 'Paste', enabled: params.editFlags.canPaste, click: () => wc.paste() });
      else if (params.selectionText) items.push(
        { label: 'Copy', click: () => wc.copy() },
        { label: 'Search for selection', click: () => this.addTab(resolveInput(` ${params.selectionText.slice(0, 1024)} `, profile.settings.engine) || '') });
      if (!items.length) items.push(
        { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
        { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
        { label: 'Reload', click: () => wc.reload() });
      Menu.buildFromTemplate(items).popup({ window: this.win });
    });
  }

  activate(tab, focusPage = true) {
    if (!tab) return;
    if (this.current() && this.current() !== tab) {
      this.current().fullscreen = false;
      this.clearFind();
    }
    this.active = tab.id;
    this.panel = '';
    this.layout();
    if (focusPage && this.mounted) tab.view.webContents.focus();
    this.remember();
    this.changed();
  }

  destroyTab(tab) {
    const wc = tab.view.webContents;
    if (!wc.isDestroyed()) wc.close({ waitForBeforeUnload: false });
  }

  closeTab(tab) {
    const index = this.tabs.indexOf(tab);
    if (index < 0 || this.win.isDestroyed()) return;
    if (webURL(tab.pending || tab.url)) {
      this.closed.unshift(tab.pending || tab.url);
      this.closed.length = Math.min(this.closed.length, 20);
    }
    if (this.active === tab.id) this.clearFind();
    this.tabs.splice(index, 1);
    if (this.active === tab.id) {
      if (this.tabs.length) this.activate(this.tabs[Math.min(index, this.tabs.length - 1)]);
      else this.addTab();
    }
    this.destroyTab(tab);
    this.remember();
    this.changed();
  }

  browse(tab, candidate) {
    const url = webURL(candidate)?.href;
    if (!tab || !url) return false;
    this.panel = '';
    tab.home = false;
    tab.pending = url;
    tab.error = '';
    tab.busy = true;
    tab.focusOnCommit = this.current() === tab;
    tab.view.webContents.loadURL(url).catch(() => {});
    this.layout();
    if (this.mounted === tab.view) tab.view.webContents.focus();
    this.changed();
    return true;
  }

  clearFind() {
    this.find = false;
    const tab = this.current();
    if (tab && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.stopFindInPage('clearSelection');
      tab.matches = null;
      tab.findId = 0;
    }
  }

  layout() {
    if (this.win.isDestroyed()) return;
    const tab = this.current();
    const next = !this.panel && tab && !tab.home && !tab.error && !changingOrigin(tab) ? tab.view : null;
    if (this.mounted !== next) {
      if (this.mounted) this.win.contentView.removeChildView(this.mounted);
      if (next) this.win.contentView.addChildView(next);
      this.mounted = next;
    }
    if (!next) return;
    const [width, height] = this.win.getContentSize();
    const top = tab.fullscreen && !this.find ? 0 : this.find ? 136 : 88;
    next.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
  }

  remember() {
    if (this.private || !profile.settings.restore || !this.tabs.length) return;
    profile.restore = { urls: this.tabs.map(tab => tab.pending || tab.url), index: Math.max(0, this.tabs.findIndex(tab => tab.id === this.active)) };
    profile.queue();
  }

  state() {
    const current = this.current();
    const wc = current?.view.webContents;
    const display = tab => ({ id: tab.id, title: (!changingOrigin(tab) && tab.title) || uriTitle(tab.pending || tab.url), url: tab.pending || tab.url,
      home: tab.home, error: tab.error, busy: tab.busy, switching: changingOrigin(tab) });
    return {
      tabs: this.tabs.map(display), active: current ? display(current) : null, private: this.private, panel: this.panel,
      back: wc?.navigationHistory.canGoBack() || false, forward: wc?.navigationHistory.canGoForward() || false,
      bookmarked: !this.private && profile.bookmarks.some(row => row.url === current?.url),
      find: this.find, matches: current?.matches, zoom: wc ? Math.round(wc.getZoomFactor() * 100) : 100,
      settings: profile.settings, dark: this.private || nativeTheme.shouldUseDarkColors,
      history: this.panel === 'history' && !this.private ? profile.history : [],
      recent: this.private ? [] : profile.history.slice(0, 4),
      bookmarks: this.panel === 'bookmarks' && !this.private ? profile.bookmarks : [],
      downloads: this.panel === 'downloads' ? this.downloads().map(({ path: _file, ...row }) => row) : []
    };
  }

  changed() {
    if (this.pendingPush || this.win.isDestroyed()) return;
    this.pendingPush = true;
    setImmediate(() => {
      this.pendingPush = false;
      if (!this.win.isDestroyed() && this.win.webContents.getURL() === INTERNAL) {
        this.win.webContents.send('tideway:state', this.state());
      }
    });
  }

  focus(field) {
    if (this.win.isDestroyed()) return;
    const tab = this.current();
    if (tab) tab.focusOnCommit = false;
    this.win.webContents.focus();
    this.win.webContents.send('tideway:focus', field);
  }

  openPanel(panel) {
    if (this.private && ['history', 'bookmarks', 'settings'].includes(panel)) return;
    this.clearFind();
    this.panel = this.panel === panel ? '' : panel;
    this.layout();
    if (this.panel) this.focus('panel');
    else if (this.mounted) this.mounted.webContents.focus();
  }

  keys(wc) {
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.isComposing) return;
      const key = input.key.toLowerCase();
      const mod = mac ? input.meta : input.control;
      const main = { l: 'address', t: 'newTab', n: 'newWindow', w: 'closeTab', r: 'reload', d: 'bookmark',
        h: 'history', j: 'downloads', f: 'findBar', '=': 'zoomIn', '+': 'zoomIn', '-': 'zoomOut', '0': 'zoomReset' };
      const shifted = { t: 'reopen', n: 'privateWindow', r: 'hardReload', o: 'bookmarks', '=': 'zoomIn', '+': 'zoomIn' };
      let action = '';
      if (input.control && key === 'tab') action = input.shift ? 'previousTab' : 'nextTab';
      else if (mod && !input.alt) {
        action = (input.shift ? shifted : main)[key] || '';
        if (!input.shift && /^[1-9]$/.test(key)) {
          event.preventDefault();
          this.activate(key === '9' ? this.tabs.at(-1) : this.tabs[Number(key) - 1]);
          return;
        }
        if (mac && key === '[') action = 'back';
        if (mac && key === ']') action = 'forward';
      } else if (input.alt && !mac && key === 'arrowleft') action = 'back';
      else if (input.alt && !mac && key === 'arrowright') action = 'forward';
      else if (key === 'f5') action = input.shift ? 'hardReload' : 'reload';
      else if (key === 'escape' && (this.panel || this.find)) action = 'dismiss';
      if (action) {
        event.preventDefault();
        this.command(action);
      }
    });
  }

  command(name, value) {
    const tab = this.current();
    const wc = tab?.view.webContents;
    switch (name) {
      case 'address': this.focus('address'); break;
      case 'newTab': this.addTab(); break;
      case 'newWindow': new Browser(this.private); break;
      case 'privateWindow': new Browser(true); break;
      case 'switchTab': this.activate(this.tabs.find(item => item.id === value)); break;
      case 'closeTab': this.closeTab(value ? this.tabs.find(item => item.id === value) : tab); break;
      case 'nextTab': case 'previousTab': {
        const length = this.tabs.length;
        this.activate(this.tabs[(this.tabs.indexOf(tab) + (name === 'nextTab' ? 1 : -1) + length) % length]);
        break;
      }
      case 'reopen': if (this.closed.length) this.addTab(this.closed.shift()); break;
      case 'navigate': {
        const url = resolveInput(value, profile.settings.engine);
        if (!url) return { error: 'Enter a website address or a search. Only HTTP and HTTPS addresses are supported.' };
        this.browse(tab, url);
        break;
      }
      case 'back': if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); break;
      case 'forward': if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); break;
      case 'stop': wc?.stop(); break;
      case 'retry': if (tab) this.browse(tab, tab.url); break;
      case 'reload': case 'hardReload':
        if (tab?.error) this.browse(tab, tab.url);
        else if (tab && !tab.home) name === 'reload' ? wc.reload() : wc.reloadIgnoringCache();
        break;
      case 'bookmark': if (!this.private && tab && !tab.error && tab.url) profile.toggleBookmark(tab.url, tab.title || uriTitle(tab.url)); break;
      case 'bookmarks': case 'history': case 'downloads': case 'settings': case 'menu': this.openPanel(name); break;
      case 'removeBookmark':
        if (!this.private) { profile.bookmarks = profile.bookmarks.filter(row => row.url !== value); profile.queue(); }
        break;
      case 'clearHistory':
        if (!this.private) { profile.history = []; this.closed = []; profile.queue(); }
        break;
      case 'showDownload': {
        const row = this.downloads().find(item => item.id === value && item.state === 'completed');
        if (row?.path && path.isAbsolute(row.path) && fs.existsSync(row.path)) shell.showItemInFolder(row.path);
        else if (row) return { error: 'That file is no longer at its saved location.' };
        break;
      }
      case 'setSettings':
        if (!this.private) {
          profile.settings = settingsFrom(value);
          nativeTheme.themeSource = profile.settings.theme;
          this.remember();
          profile.queue();
          for (const browser of windows.values()) browser.changed();
        }
        break;
      case 'findBar':
        if (tab && !tab.home && !tab.error) {
          this.panel = '';
          this.find = true;
          this.layout();
          this.focus('find');
        }
        break;
      case 'findText': case 'findNext': case 'findPrevious':
        if (this.find && tab && typeof value === 'string') {
          if (!value) { wc.stopFindInPage('clearSelection'); tab.findId = 0; tab.matches = null; }
          else tab.findId = wc.findInPage(value.slice(0, 512), { forward: name !== 'findPrevious', findNext: name !== 'findText' });
        }
        break;
      case 'zoomIn': case 'zoomOut': case 'zoomReset':
        if (wc && !tab.home) {
          const factor = wc.getZoomFactor();
          wc.setZoomFactor(name === 'zoomReset' ? 1 : Math.max(0.5, Math.min(3, factor + (name === 'zoomIn' ? 0.1 : -0.1))));
        }
        break;
      case 'dismiss':
        if (this.panel) this.panel = '';
        else this.clearFind();
        this.layout();
        if (this.mounted) this.mounted.webContents.focus();
        break;
      default: return null;
    }
    this.changed();
    return null;
  }
}

function senderBrowser(event) {
  const browser = windows.get(event.sender.id);
  const frame = event.senderFrame;
  return browser && frame && frame === event.sender.mainFrame && frame.url === INTERNAL ? browser : null;
}

app.whenReady().then(() => {
  profile = new Profile(app.getPath('userData'));
  nativeTheme.themeSource = profile.settings.theme;
  nativeTheme.on('updated', () => { for (const browser of windows.values()) browser.changed(); });
  const chromeSession = session.fromPartition('tideway-chrome');
  noPermissions(chromeSession);
  chromeSession.protocol.handle('tideway', request => {
    const url = new URL(request.url);
    if (url.host !== 'app' || !internalFiles.has(url.pathname)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(path.join(__dirname, 'chrome', path.basename(url.pathname))).href);
  });
  configurePages(session.fromPartition('persist:tideway-pages'));
  ipcMain.handle('tideway:ready', event => senderBrowser(event)?.state() ?? null);
  ipcMain.handle('tideway:command', (event, name, value) => senderBrowser(event)?.command(name, value) ?? null);
  Menu.setApplicationMenu(mac ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
  new Browser(false, true);
});
app.on('before-quit', () => { for (const browser of windows.values()) if (!browser.private) browser.remember(); profile?.flush(); });
app.on('window-all-closed', () => { profile?.flush(); if (!mac) app.quit(); });
app.on('activate', () => { if (profile && !windows.size) new Browser(false, true); });
