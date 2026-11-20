# Tideway Browser

Tideway is a desktop web browser built with Electron and Chromium. It opens HTTP and HTTPS sites directly in isolated browser tabs, rather than embedding them in a webpage.

## Download and run

Open the repository’s [Build Tideway workflow](https://github.com/jasoncoker010101-cmd/tideway-browser/actions/workflows/build.yml), choose a successful run, and download the artifact for your computer. Unzip the GitHub download first; it contains the platform-specific archive below.

| Computer | Run Tideway |
| --- | --- |
| Windows x64 | Unzip `Tideway-windows-x64.zip` and open `Tideway.exe`. Keep the other files beside it. |
| macOS Apple Silicon or Intel | Extract the matching `.tar.gz`, then open `Tideway.app` inside the extracted folder. |
| Linux x64 | Extract `Tideway-linux-x64.tar.gz` and run `./Tideway` from the `Tideway-linux-x64` folder. |

These are portable development builds, not signed installers. Windows or macOS may warn about an unrecognized developer. On a managed device, ask the administrator to approve the software; Tideway does not bypass device policies. On Linux, the Chromium sandbox requires a distribution that permits the necessary user namespaces or a correctly installed sandbox helper. Do not disable the sandbox for everyday browsing.

## Run from source

Install Node.js 22.12 or newer. From the cloned repository:

```sh
npm ci
npm start
```

Run `npm test` for the address and settings tests. Run `npm run test:desktop` in a graphical session, or `xvfb-run -a npm run test:desktop` on headless Linux with a working Chromium sandbox. `npm run package` builds a portable app for the current operating system in `dist/`. On Linux x64, `node --test test/package-smoke.cjs` checks that the packaged app starts and opens a public HTTPS page.

## What works

- Tabbed browsing, separate windows, search from the address bar or new-tab page, and back, forward, reload, and stop controls.
- Bookmarks, recent sites, browsing history, and file downloads. A download asks where to save; files never open automatically.
- Find on page, zoom, a light or dark theme, three search providers, and optional tab restoration.
- Private windows use separate in-memory site sessions and do not add to regular history. Downloads deliberately saved to disk remain there. Private browsing does not hide activity from sites or networks.

| Shortcut | Action |
| --- | --- |
| `Ctrl/⌘ + L` | Focus the address bar |
| `Ctrl/⌘ + T` / `Ctrl/⌘ + W` | Open or close a tab |
| `Ctrl/⌘ + Shift + T` | Reopen a closed tab |
| `Ctrl/⌘ + Shift + N` | Open a private window |
| `Ctrl/⌘ + F` | Find on page |
| `Ctrl/⌘ + D` | Bookmark this page |
| `Ctrl/⌘ + H` / `Ctrl/⌘ + J` | Open history or downloads |

## Scope and security

Tideway is an early browser project, not a drop-in replacement for Chrome, Edge, Firefox, or Safari. It does not include browser extensions, a password manager, account sync, automatic security updates, or a dedicated malicious-site reputation service. Some websites, identity providers, and DRM streaming platforms may not work. Keep Electron updated before using the project for sensitive browsing.

The interface and website content use separate sessions. Website renderers run with sandboxing, context isolation, and no Node APIs or app preload. Top-level browsing is limited to HTTP and HTTPS, Chromium’s certificate checks remain enabled, and selected permissions require explicit approval. See the [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security) for the risks of loading untrusted web content.
