'use strict';

// Local-only smoke check against the packaged executable, with no Node inspector.
const { test } = require('node:test');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { mkdtemp, rm } = require('node:fs/promises');
const { setTimeout: delay } = require('node:timers/promises');
const path = require('node:path');
const os = require('node:os');

async function waitFor(check, limit = 6000) {
  const until = Date.now() + limit;
  while (Date.now() < until) {
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  throw new Error('Timed out waiting for the native browser.');
}

async function evaluate(endpoint, expression) {
  const socket = new WebSocket(endpoint);
  try {
    const signal = AbortSignal.timeout(4000);
    await once(socket, 'open', { signal });
    const waiting = once(socket, 'message', { signal });
    socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    const [event] = await waiting;
    const data = JSON.parse(event.data);
    if (data.error || data.result.exceptionDetails) throw new Error(JSON.stringify(data.error || data.result.exceptionDetails));
    return data.result.result.value;
  } finally {
    socket.close();
  }
}

test('portable Linux build starts and opens an HTTPS website', { timeout: 35_000 }, async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'tideway-portable-'));
  const target = path.join(__dirname, '../dist/Tideway-linux-x64/Tideway');
  const app = spawn(target, ['--remote-debugging-port=0'], { env: { ...process.env, TIDEWAY_TEST_PROFILE: profile } });
  try {
    let log = '';
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Packaged run did not start:\n${log}`)), 8000);
      app.stderr.on('data', chunk => {
        log += chunk.toString();
        const match = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-f\d-]+)/.exec(log);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      app.once('error', err => { clearTimeout(timer); reject(err); });
    });
    const { host } = new URL(endpoint);
    const targets = async () => (await fetch(`http://${host}/json/list`)).json();
    const ui = await waitFor(async () => (await targets()).find(target => target.url === 'tideway://app/index.html'));
    await waitFor(() => evaluate(ui.webSocketDebuggerUrl, `!!document.querySelector('#address') && !!window.tideway`));
    await evaluate(ui.webSocketDebuggerUrl, `
      document.querySelector('#address').value = 'https://example.com/';
      document.querySelector('#address-form').requestSubmit();
    `);
    await waitFor(async () => {
      const state = await evaluate(ui.webSocketDebuggerUrl, `({
        title: document.querySelector('.tab[data-current=true] .tab-title')?.textContent,
        error: document.querySelector('#error-page')?.hidden ? '' : document.querySelector('#error-detail')?.textContent
      })`);
      if (state.error) throw new Error(state.error);
      return state.title === 'Example Domain';
    }, 12_000);
    const remote = await waitFor(async () => (await targets()).find(target => target.url === 'https://example.com/'));
    const rendered = await evaluate(remote.webSocketDebuggerUrl, `({
      href: location.href, title: document.title, content: document.body?.innerText.slice(0, 180),
      heading: document.querySelector('h1')?.textContent, ready: document.readyState
    })`);
    if (rendered.href !== 'https://example.com/' || rendered.title !== 'Example Domain' || !rendered.content) {
      throw new Error(`Unexpected HTTPS document: ${JSON.stringify(rendered)}`);
    }
  } finally {
    if (app.pid && app.exitCode === null && app.signalCode === null) {
      const done = once(app, 'exit');
      app.kill('SIGTERM');
      await done;
    }
    await rm(profile, { force: true, recursive: true });
  }
});
