'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron: electron } = require('playwright');

test('desktop browser handles real pages, local data, downloads and private sessions', { timeout: 100_000 }, async t => {
  const first = '<title>First fixture</title><h1>First fixture</h1><p>A tide mark</p><p>Another tide mark</p>' +
    '<a href="/second">Next page</a> · <a href="/popup" target="_blank">Pop-up tab</a> · <a href="/download">Download sample</a>' +
    '<script>window.siteIsolation = [typeof process, typeof require, typeof tideway];</script>';
  const server = http.createServer((req, res) => {
    if (req.url === '/download') {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename="tideway-test.txt"' });
      res.end('download fixture\n');
      return;
    }
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/second' }); res.end(); return; }
    if (req.url === '/cookie') {
      res.setHeader('Set-Cookie', 'tideway_fixture=regular; Path=/; SameSite=Lax');
      res.end('<title>Cookie fixture</title><h1>Cookie fixture</h1>');
      return;
    }
    if (req.url === '/disconnect') { res.destroy(); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Frame-Options', 'DENY');
    res.end(req.url === '/second' ? '<title>Second fixture</title><h1>Second fixture</h1>' :
      req.url === '/popup' ? '<title>Popup fixture</title><h1>Popup fixture</h1>' :
      req.url === '/private' ? '<title>Private fixture</title><h1>Private fixture</h1>' : first);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tideway-test-'));
  const launch = () => electron.launch({
    args: [path.join(__dirname, '..')],
    chromiumSandbox: process.env.TIDEWAY_TEST_NO_SANDBOX !== '1',
    env: { ...process.env, TIDEWAY_TEST_PROFILE: directory },
    timeout: 20_000
  });
  let desktop = await launch();
  t.after(async () => {
    await desktop.close().catch(() => {});
    await fs.rm(directory, { force: true, recursive: true });
  });
  const getUi = async () => {
    const context = desktop.context();
    return new Promise((resolve, reject) => {
      const watch = page => {
        void page.locator('#address').waitFor({ state: 'attached', timeout: 8000 })
          .then(() => finish(page), () => {});
      };
      const finish = page => {
        clearTimeout(timer);
        context.off('page', watch);
        if (page) resolve(page);
        else reject(new Error('Could not find the native browser interface.'));
      };
      const timer = setTimeout(() => finish(null), 8500);
      context.on('page', watch);
      for (const page of context.pages()) watch(page);
    });
  };
  let ui = await getUi();
  desktop.context().setDefaultTimeout(8000);
  const awaitTitle = title => ui.locator('.tab[data-current=true] .tab-title').filter({ hasText: title }).waitFor();
  const address = () => ui.getByRole('textbox', { name: 'Address and search bar' });
  const go = async url => {
    await address().fill(url);
    await address().press('Enter');
  };
  const shortcut = async (keyCode, shift = false) => {
    const window = await desktop.browserWindow(ui);
    await window.evaluate((win, input) => {
      win.focus();
      win.webContents.focus();
      const modifiers = [process.platform === 'darwin' ? 'meta' : 'control'];
      if (input.shift) modifiers.push('shift');
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: input.keyCode, modifiers });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: input.keyCode, modifiers });
    }, { keyCode, shift });
  };
  const pageAt = url => desktop.context().waitForEvent('page', { predicate: page => page.url() === url, timeout: 1500 }).catch(() =>
    desktop.context().pages().find(page => page.url() === url));
  const guest = async url => {
    const immediate = desktop.context().pages().find(page => page.url() === url);
    if (immediate) return immediate;
    const page = await pageAt(url);
    assert.ok(page, `Missing WebContents for ${url}`);
    return page;
  };
  await ui.getByRole('heading', { name: 'Start exploring.' }).waitFor();
  if (process.env.TIDEWAY_TEST_SCREENSHOT) await ui.screenshot({ path: process.env.TIDEWAY_TEST_SCREENSHOT });
  if (process.env.TIDEWAY_TEST_SCREENSHOT_SMALL) {
    await desktop.browserWindow(ui).then(window => window.evaluate(win => win.setSize(610, 460)));
    await ui.waitForFunction(() => innerWidth === 610 && innerHeight === 460);
    await ui.screenshot({ path: process.env.TIDEWAY_TEST_SCREENSHOT_SMALL });
    await desktop.browserWindow(ui).then(window => window.evaluate(win => win.setSize(1216, 820)));
  }
  await ui.getByRole('textbox', { name: 'Search the web or enter a URL' }).fill(base);
  await ui.getByRole('button', { name: 'Go', exact: true }).click();
  await awaitTitle('First fixture');
  const firstPage = await guest(`${base}/`);
  assert.deepEqual(await firstPage.evaluate(() => window.siteIsolation), ['undefined', 'undefined', 'undefined']);
  assert.equal(await firstPage.getByRole('heading', { name: 'First fixture' }).textContent(), 'First fixture');
  assert.equal(await ui.locator('#insecure').textContent(), 'Not secure');
  await ui.getByRole('button', { name: 'Bookmark this page' }).click();
  await ui.locator('#bookmark[aria-pressed=true]').waitFor();
  await ui.getByRole('button', { name: 'Bookmarks', exact: true }).click();
  await ui.getByRole('button', { name: /First fixture/ }).last().waitFor();
  await ui.getByRole('button', { name: 'Close panel' }).click();
  await firstPage.getByRole('link', { name: 'Next page' }).click();
  await awaitTitle('Second fixture');
  await ui.getByRole('button', { name: 'Back', exact: true }).click();
  await awaitTitle('First fixture');
  await ui.getByRole('button', { name: 'Forward', exact: true }).click();
  await awaitTitle('Second fixture');
  await go(`${base}/redirect`);
  await ui.waitForFunction(url => document.querySelector('#address').value === url, `${base}/second`);
  await go(`${base}/`);
  await awaitTitle('First fixture');
  await shortcut('F');
  await ui.getByRole('searchbox', { name: 'Find text on this page' }).fill('tide mark');
  await ui.getByText('1 of 2', { exact: true }).waitFor();
  await ui.getByRole('button', { name: 'Next match' }).click();
  await ui.getByText('2 of 2', { exact: true }).waitFor();
  await ui.getByRole('button', { name: 'Close find bar' }).click();
  await firstPage.getByRole('link', { name: 'Pop-up tab' }).click();
  await awaitTitle('Popup fixture');
  assert.equal(await ui.locator('.tab').count(), 2);
  await ui.getByRole('button', { name: 'Close tab: Popup fixture' }).click();
  await awaitTitle('First fixture');
  await shortcut('T', true);
  await awaitTitle('Popup fixture');
  await ui.getByRole('button', { name: 'Close tab: Popup fixture' }).click();
  await awaitTitle('First fixture');

  // Supply a destination in automation; normal launches always display the native Save dialog.
  await desktop.evaluate(({ session }, folder) => {
    session.fromPartition('persist:tideway-pages').prependOnceListener('will-download', (_event, item) =>
      item.setSavePath(`${folder}/tideway-test.txt`));
  }, directory);
  await firstPage.getByRole('link', { name: 'Download sample' }).click();
  await ui.getByRole('button', { name: 'Downloads', exact: true }).click();
  await ui.getByText('tideway-test.txt', { exact: true }).waitFor();
  await ui.getByRole('button', { name: 'Show in folder' }).waitFor();
  assert.equal(await fs.readFile(path.join(directory, 'tideway-test.txt'), 'utf8'), 'download fixture\n');
  await ui.getByRole('button', { name: 'Close panel' }).click();

  await go(`${base}/disconnect`);
  await ui.getByRole('heading', { name: 'Couldn’t load this page.' }).waitFor();
  await ui.getByRole('button', { name: 'Try again' }).click();
  await ui.getByRole('heading', { name: 'Couldn’t load this page.' }).waitFor();
  await go('file:///etc/hosts');
  await ui.getByRole('status').filter({ hasText: 'Only HTTP and HTTPS' }).waitFor();
  await go(`${base}/cookie`);
  await awaitTitle('Cookie fixture');
  assert.equal(await (await guest(`${base}/cookie`)).evaluate(() => document.cookie), 'tideway_fixture=regular');

  const privateWindowEvent = desktop.waitForEvent('window');
  await shortcut('N', true);
  const privateUi = await privateWindowEvent;
  await privateUi.getByRole('heading', { name: 'Browse privately.' }).waitFor();
  const privateNative = await desktop.browserWindow(privateUi);
  assert.equal(await privateNative.evaluate(window => window.getTitle()), 'Tideway (Private)');
  const privateAddress = privateUi.getByRole('textbox', { name: 'Address and search bar' });
  await privateAddress.fill(`${base}/private`);
  await privateAddress.press('Enter');
  await privateUi.locator('.tab-title').filter({ hasText: 'Private fixture' }).waitFor();
  assert.equal(await (await guest(`${base}/private`)).evaluate(() => document.cookie), '');
  await privateNative.evaluate(window => window.close());

  await shortcut('H');
  await ui.getByRole('heading', { name: 'History', exact: true }).waitFor();
  await ui.locator('#panel-body').getByText('Cookie fixture', { exact: true }).waitFor();
  assert.equal(await ui.locator('#panel-body').getByText('Private fixture', { exact: true }).count(), 0);
  await ui.getByRole('button', { name: 'Close panel' }).click();
  await ui.getByRole('button', { name: 'Browser menu' }).click();
  await ui.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await ui.getByText('Page zoom: 110%', { exact: true }).waitFor();
  await ui.getByRole('button', { name: 'Reset', exact: true }).click();
  await ui.getByText('Page zoom: 100%', { exact: true }).waitFor();
  await ui.getByRole('button', { name: 'Settings', exact: true }).click();
  await ui.getByLabel(/Appearance/).selectOption('dark');
  await ui.getByLabel(/Search engine/).selectOption('bing');
  await ui.getByLabel(/Restore tabs on startup/).check();
  await ui.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await ui.getByRole('button', { name: 'Close panel' }).click();
  await ui.getByRole('button', { name: 'New tab', exact: true }).click();
  await ui.getByText('Search with Bing', { exact: true }).waitFor();
  if (process.env.TIDEWAY_TEST_SCREENSHOT_DARK) await ui.screenshot({ path: process.env.TIDEWAY_TEST_SCREENSHOT_DARK });
  await go(`${base}/second`);
  await awaitTitle('Second fixture');
  await desktop.close();

  desktop = await launch();
  ui = await getUi();
  desktop.context().setDefaultTimeout(8000);
  await awaitTitle('Second fixture');
  assert.equal(await ui.locator('.tab').count(), 2);
  await ui.getByRole('button', { name: 'Bookmarks', exact: true }).click();
  await ui.locator('#panel-body').getByText('First fixture', { exact: true }).waitFor();
  await ui.getByRole('button', { name: 'Remove', exact: true }).click();
  await ui.getByText('No bookmarks yet.', { exact: true }).waitFor();
  await shortcut('H');
  await ui.getByRole('button', { name: 'Clear history', exact: true }).click();
  await ui.getByRole('button', { name: 'Confirm clear history', exact: true }).click();
  await ui.getByText('No history yet.', { exact: true }).waitFor();
});
