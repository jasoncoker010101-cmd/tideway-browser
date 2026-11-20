'use strict';

const icons = {
  left: '<path d="M19 12H5m7 7-7-7 7-7"/>', right: '<path d="M5 12h14m-7-7 7 7-7 7"/>',
  up: '<path d="m6 15 6-6 6 6"/>', down: '<path d="m6 9 6 6 6-6"/>',
  arrowup: '<path d="M6 18 18 6M8 6h10v10"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', reload: '<path d="M20 12a8 8 0 1 1-2-5m2-4v5h-5"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4"/>',
  bookmarks: '<path d="M7 4h10a2 2 0 0 1 2 2v15l-7-4-7 4V6a2 2 0 0 1 2-2Z"/>',
  menu: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2 2 3 4.5 3 8s-1 6-3 8c-2-2-3-4.5-3-8s1-6 3-8Z"/>',
  lock: '<rect x="6" y="10" width="12" height="10" rx="2"/><path d="M9 10V7a3 3 0 0 1 6 0v3m-3 3v3"/>',
  history: '<path d="M4 11a8 8 0 1 1 2 6m-2-1v-5h5m3-4v5l3 2"/>',
  window: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 9h16"/>',
  private: '<path d="M5 11h14l-2-6-5 2-5-2-2 6Zm-2 0h18m-8 6h-2"/><circle cx="8" cy="17" r="2.5"/><circle cx="16" cy="17" r="2.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2m0-12-2 2m-8 8-2 2"/>',
  info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5m0-8h.01"/>'
};
const $ = id => document.getElementById(id);
const address = $('address');
const find = $('find');
const tabStrip = $('tabs');
const panelBody = $('panel-body');
const mac = /Mac/.test(navigator.platform);
const modifier = mac ? '⌘' : 'Ctrl';
const engines = { duckduckgo: 'DuckDuckGo', google: 'Google', bing: 'Bing' };
const titles = {
  history: ['Library', 'History', 'Websites you’ve visited in regular windows.'],
  bookmarks: ['Library', 'Bookmarks', 'Save a page with the star in the address bar.'],
  downloads: ['Library', 'Downloads', 'Files you’ve downloaded during your browsing.'],
  settings: ['Preferences', 'Settings', 'Choose how Tideway looks and starts.'],
  menu: ['Browser', 'Tideway menu', 'Open a new window or jump to your browser tools.']
};
let state;
let noticeTimer;
let panelKey;
let recentKey;
let lastActive;
let lastAddress = '';
let addressDirty = false;
const tabNodes = new Map();

function paint(node, icon) {
  if (!node || node.dataset.drawn === icon) return;
  node.dataset.drawn = icon;
  node.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[icon] || ''}</svg>`;
}
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (typeof text === 'string') element.textContent = text;
  return element;
}
function action(label, name, value, { icon, className = 'quiet', onlyIcon = false } = {}) {
  const button = node('button', className, onlyIcon ? undefined : label);
  button.type = 'button';
  button.dataset.action = name;
  if (value !== undefined) button.dataset.value = value;
  if (onlyIcon) button.setAttribute('aria-label', label);
  button.title = label;
  if (icon && onlyIcon) paint(button, icon);
  if (icon && !onlyIcon) {
    const image = node('span');
    paint(image, icon);
    button.prepend(image);
  }
  return button;
}
function host(value) {
  try { return new URL(value).hostname; } catch { return ''; }
}
function time(value) { return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
function showNotice(message) {
  clearTimeout(noticeTimer);
  $('notice').textContent = message;
  $('notice').hidden = false;
  noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 3300);
}
function run(name, value) {
  return window.tideway.command(name, value).then(result => {
    if (result?.error) showNotice(result.error);
    else if (name === 'navigate') $('notice').hidden = true;
    return !result?.error;
  });
}

function renderTabs(data) {
  const valid = new Set(data.tabs.map(tab => tab.id));
  for (const [id, row] of tabNodes) {
    if (!valid.has(id)) { row.remove(); tabNodes.delete(id); }
  }
  for (const tab of data.tabs) {
    const active = data.active?.id === tab.id;
    let row = tabNodes.get(tab.id);
    if (!row) {
      row = node('div', 'tab');
      const main = action('', 'switchTab', tab.id, { className: 'tab-main' });
      const icon = node('span');
      const title = node('span', 'tab-title');
      main.append(icon, title);
      const close = action('Close tab', 'closeTab', tab.id, { icon: 'close', onlyIcon: true, className: 'icon tab-close' });
      row.append(main, close);
      tabStrip.append(row);
      tabNodes.set(tab.id, row);
    }
    row.dataset.current = String(active);
    const [main, close] = row.children;
    main.setAttribute('aria-current', String(active));
    main.title = tab.title;
    close.setAttribute('aria-label', `Close tab: ${tab.title}`);
    paint(main.firstElementChild, data.private && tab.home ? 'private' : tab.home ? 'window' : tab.error ? 'info' : 'globe');
    main.lastElementChild.textContent = tab.title;
    if (active && lastActive !== tab.id) {
      const outer = tabStrip.getBoundingClientRect();
      const inner = row.getBoundingClientRect();
      if (inner.right > outer.right) tabStrip.scrollLeft += inner.right - outer.right;
      if (inner.left < outer.left) tabStrip.scrollLeft -= outer.left - inner.left;
    }
  }
}

function renderRecent(rows) {
  const key = JSON.stringify(rows);
  if (recentKey === key) return;
  recentKey = key;
  const list = $('recent-list');
  list.replaceChildren();
  for (const row of rows) {
    const button = action('', 'navigate', row.url, { className: 'recent-tile' });
    button.title = row.url;
    const badge = node('span', 'badge');
    paint(badge, 'globe');
    const content = node('span');
    content.append(node('strong', 'ellipsis', row.title), node('small', 'ellipsis', host(row.url)));
    button.append(badge, content);
    list.append(button);
  }
  if (!rows.length) list.append(node('div', 'empty', 'No recent visits yet. Pages you visit will appear here.'));
}

function rowFor(title, detail, command, value) {
  const row = node('div', 'row');
  const main = command ? action('', command, value, { className: 'row-main' }) : node('div', 'row-main');
  if (command) main.title = value;
  main.append(node('strong', 'ellipsis', title), node('small', 'ellipsis', detail));
  row.append(main);
  return row;
}

function renderSettings(data) {
  const form = node('div', 'settings');
  const fields = [
    ['engine', 'Search engine', 'Used for the address bar and new-tab search.', engines],
    ['theme', 'Appearance', 'Choose a light, dark, or system theme.', { system: 'System', light: 'Light', dark: 'Dark' }],
    ['restore', 'Restore tabs on startup', 'Reopen the last regular window when Tideway starts.', null]
  ];
  for (const [key, labelText, detail, options] of fields) {
    const row = node('div', 'setting');
    const label = node('label', '', labelText);
    label.htmlFor = `setting-${key}`;
    label.append(node('small', '', detail));
    const control = node(options ? 'select' : 'input');
    control.id = label.htmlFor;
    if (options) {
      for (const [value, text] of Object.entries(options)) {
        const option = node('option', '', text);
        option.value = value;
        control.append(option);
      }
      control.value = data.settings[key];
    } else { control.type = 'checkbox'; control.checked = data.settings[key]; }
    control.addEventListener('change', () => run('setSettings',
      { ...state.settings, [key]: options ? control.value : control.checked }));
    row.append(label, control);
    form.append(row);
  }
  panelBody.append(form);
}

function renderMenu(data) {
  const menu = node('div', 'menu-grid');
  const entries = [
    ['New tab', 'newTab', 'plus', 'T'], ['New window', 'newWindow', 'window', 'N'],
    ['New private window', 'privateWindow', 'private', 'Shift N'], ['Find on page', 'findBar', 'search', 'F'],
    ['Bookmarks', 'bookmarks', 'bookmarks', 'Shift O'], ['History', 'history', 'history', 'H'],
    ['Downloads', 'downloads', 'download', 'J'], ['Settings', 'settings', 'settings', '']
  ];
  for (const [label, name, icon, shortcut] of entries) {
    const row = node('div', 'row');
    const button = action(label, name, undefined, { icon, className: 'row-main' });
    button.disabled = (data.private && ['bookmarks', 'history', 'settings'].includes(name)) ||
      (name === 'findBar' && (!data.active || data.active.home || !!data.active.error));
    if (shortcut) {
      const keys = node('span', 'shortcut');
      keys.append(node('kbd', '', modifier), ...shortcut.split(' ').map(key => node('kbd', '', key)));
      button.append(keys);
    }
    row.append(button);
    menu.append(row);
  }
  const zoom = rowFor(`Page zoom: ${data.zoom}%`, 'Changes the current website.');
  for (const [label, name] of [['Zoom out', 'zoomOut'], ['Reset', 'zoomReset'], ['Zoom in', 'zoomIn']]) {
    const button = action(label, name);
    button.disabled = !data.active || data.active.home || !!data.active.error;
    zoom.append(button);
  }
  panelBody.append(menu, zoom);
}

function renderPanel(data) {
  const key = JSON.stringify([data.panel, data[data.panel], data.panel === 'menu' ? [data.zoom, data.active?.home, data.active?.error] : null]);
  if (panelKey === key) return;
  if (data.panel === 'settings' && $('setting-engine')) {
    $('setting-engine').value = data.settings.engine;
    $('setting-theme').value = data.settings.theme;
    $('setting-restore').checked = data.settings.restore;
    panelKey = key;
    return;
  }
  panelKey = key;
  panelBody.replaceChildren();
  if (!data.panel) return;
  const [label, title, detail] = titles[data.panel];
  $('panel-label').textContent = label.toUpperCase();
  $('panel-title').textContent = title;
  $('panel-description').textContent = detail;
  if (data.panel === 'settings') { renderSettings(data); return; }
  if (data.panel === 'menu') { renderMenu(data); return; }
  const rows = data[data.panel];
  if (!rows.length) {
    panelBody.append(node('div', 'empty', `No ${data.panel === 'history' ? 'history' : data.panel} yet.`));
    return;
  }
  if (data.panel === 'history') {
    const controls = node('div', 'list-actions');
    controls.append(action('Clear history', 'confirmClear'));
    panelBody.append(controls);
  }
  for (const row of rows) {
    if (data.panel === 'downloads') {
      const status = row.state === 'progressing' ? (row.total > 0 ? `${Math.min(100, Math.floor(row.received / row.total * 100))}%` : 'Downloading') :
        { completed: 'Saved', cancelled: 'Cancelled', interrupted: 'Interrupted' }[row.state];
      const wrapper = rowFor(row.name, `${status} · ${time(row.at)}`);
      if (row.state === 'completed') wrapper.append(action('Show in folder', 'showDownload', row.id));
      panelBody.append(wrapper);
    } else {
      const wrapper = rowFor(row.title, data.panel === 'history' ? `${host(row.url)} · ${time(row.at)}` : host(row.url), 'navigate', row.url);
      if (data.panel === 'bookmarks') wrapper.append(action('Remove', 'removeBookmark', row.url));
      panelBody.append(wrapper);
    }
  }
}

function render(data) {
  if (!data) return;
  state = data;
  const active = data.active;
  const url = active?.url || '';
  if (lastActive !== active?.id || lastAddress !== url) addressDirty = false;
  if (!addressDirty && address.value !== url) address.value = url;
  document.documentElement.classList.toggle('dark', data.dark);
  document.documentElement.classList.toggle('private', data.private);
  $('window-name').textContent = data.private ? 'PRIVATE WINDOW' : 'TIDEWAY';
  $('insecure').hidden = !url.startsWith('http:');
  paint($('address-symbol'), url.startsWith('https:') && !active?.error && !active?.switching ? 'lock' : 'globe');
  $('back').disabled = !data.back;
  $('forward').disabled = !data.forward;
  $('reload').disabled = !active || active.home;
  $('reload').dataset.action = active?.busy ? 'stop' : 'reload';
  $('reload').setAttribute('aria-label', active?.busy ? 'Stop loading' : 'Reload');
  $('reload').title = active?.busy ? 'Stop loading' : 'Reload';
  paint($('reload'), active?.busy ? 'close' : 'reload');
  $('bookmark').hidden = data.private;
  $('bookmark').disabled = !url || !!active?.error || !!active?.busy;
  $('bookmark').setAttribute('aria-pressed', String(data.bookmarked));
  document.querySelector('.tool-library').hidden = data.private;
  for (const button of document.querySelectorAll('.tools [data-action]')) {
    button.setAttribute('aria-pressed', String(data.panel === button.dataset.action));
  }
  if (!data.find && !$('find-bar').hidden) find.value = '';
  $('find-bar').hidden = !data.find;
  $('matches').textContent = data.matches ? `${data.matches.current} of ${data.matches.total}` : '';
  $('start').hidden = !active?.home || !!data.panel;
  $('loading-page').hidden = !active?.switching || !!data.panel;
  if (active?.switching) $('loading-host').textContent = host(url);
  $('error-page').hidden = !active?.error || !!data.panel;
  $('panel').hidden = !data.panel;
  if (active?.error) {
    $('error-url').textContent = url;
    $('error-detail').textContent = active.error;
  }
  $('recent').hidden = data.private;
  $('start-mode').textContent = data.private ? 'PRIVATE WINDOW' : 'NEW TAB';
  $('start-title').textContent = data.private ? 'Browse privately.' : 'Start exploring.';
  $('start-description').textContent = data.private
    ? 'Tideway won’t keep this window’s history or site data after it closes. Downloads you save stay on your device.'
    : 'Enter a website or search the web.';
  $('provider').textContent = `Search with ${engines[data.settings.engine]}`;
  renderTabs(data);
  renderRecent(data.recent);
  renderPanel(data);
  lastActive = active?.id;
  lastAddress = url;
}

document.querySelectorAll('[data-icon]').forEach(element => {
  paint(element, element.dataset.icon);
  if (element instanceof HTMLButtonElement) element.title = element.getAttribute('aria-label') || '';
});
$('shortcut-prefix').textContent = modifier;
document.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action: name, value } = button.dataset;
  if (name === 'confirmClear') {
    button.textContent = 'Confirm clear history';
    button.dataset.action = 'clearHistory';
    return;
  }
  if (name === 'findNext' || name === 'findPrevious') { run(name, find.value); return; }
  run(name, value);
});

address.addEventListener('input', () => { addressDirty = true; });
address.addEventListener('keydown', event => {
  if (event.key === 'Escape') { addressDirty = false; address.value = state?.active?.url || ''; address.select(); }
});
$('address-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!address.value.trim()) return;
  run('navigate', address.value).then(ok => { if (ok) { addressDirty = false; address.blur(); } });
});
$('start-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = $('start-search');
  if (input.value.trim()) run('navigate', input.value).then(ok => { if (ok) input.value = ''; });
});
find.addEventListener('input', () => run('findText', find.value));
find.addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  run(event.shiftKey ? 'findPrevious' : 'findNext', find.value);
});

window.tideway.state(render);
window.tideway.focus(field => {
  requestAnimationFrame(() => {
    const focus = field === 'find' ? find : field === 'panel' ? $('panel-title') : address;
    focus.focus();
    if (focus instanceof HTMLInputElement) focus.select();
  });
});
window.tideway.ready().then(render);
