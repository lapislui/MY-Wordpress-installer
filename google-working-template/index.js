const { app, BrowserWindow, BrowserView, ipcMain } = require('electron');
const path = require('path');

let win;
let view;
let isSourceVisible = false;

function createWindow() {
  win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile('index.html');

  view = new BrowserView();
  win.setBrowserView(view);
  view.setBounds({ x: 0, y: 50, width: 800, height: 550 });
  view.setAutoResize({ width: true, height: true });
  view.webContents.loadURL('https://www.google.com');

  ipcMain.on('navigate', (event, url) => {
    view.webContents.loadURL(url);
  });

  ipcMain.on('back', () => {
    if (view.webContents.canGoBack()) {
      view.webContents.goBack();
    }
  });

  ipcMain.on('forward', () => {
    if (view.webContents.canGoForward()) {
      view.webContents.goForward();
    }
  });

  ipcMain.on('reload', () => {
    view.webContents.reload();
  });

  ipcMain.handle('toggle-source-view', async () => {
    if (isSourceVisible) {
      win.setBrowserView(view); // Re-attach the BrowserView
      isSourceVisible = false;
      return null; // Indicate that the source view should be hidden
    } else {
      const source = await view.webContents.executeJavaScript('document.documentElement.outerHTML');
      win.removeBrowserView(view); // Detach the BrowserView
      isSourceVisible = true;
      return source; // Send the source to the renderer
    }
  });

  view.webContents.on('did-navigate', (event, url) => {
    win.webContents.send('update-url', url);
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
