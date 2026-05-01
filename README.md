# WP Desktop

Small Electron app for two local workflows:

1. A tabbed browser for WordPress work.
2. A WordPress zip installer for XAMPP-style local sites.

## What it does

- Local WordPress tabs keep their login session.
- Every non-local tab gets its own isolated session, so logging into Google in one tab does not log Google in on another tab.
- Right-clicking links shows browser-style actions such as new tab, new window, InPrivate window, split screen window, save link, copy link, and inspect.
- Site credentials can be saved in an encrypted local vault and reused for autofill.
- The installer uses the native Windows folder picker instead of a browser-based directory browser.
- The installer can test MySQL, extract a WordPress zip into the selected folder, create a matching database, and remember MySQL credentials securely.
- Persistent local sessions let Chromium handle passkeys and Windows Hello on sites that support WebAuthn.

## Run

```bash
npm install
npm start
```

## Project layout

- `main.js`: Electron window setup and installer backend logic.
- `preload.js`: Safe IPC bridge for the renderer.
- `src/index.html`: App layout.
- `src/renderer.js`: Browser tabs and installer UI behavior.
- `src/styles.css`: Shared styling.

## Notes

- The browser opens `http://localhost/` by default.
- On startup the app registers itself for `http` and `https` links. This works best once the app is packaged as a normal Windows application.
- Local session persistence is applied to `localhost`, `127.0.0.1`, and `::1`.
- Remote tabs use isolated Electron sessions by tab.
- Database creation uses the folder name as the default database name after sanitizing invalid characters.
- Saved credentials use Electron `safeStorage`, which uses DPAPI on Windows.
