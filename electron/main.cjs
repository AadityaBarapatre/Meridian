const { app, BrowserWindow } = require('electron');
const path = require('path');

process.env.DIST_DIR = path.join(__dirname, '../dist');

// Start the bundled backend server
require('./server.cjs');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#050816',
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.setMenuBarVisibility(false);

  const load = () => {
    win.loadURL('http://localhost:4000').catch((err) => {
      console.log('Retrying loadURL...', err.message);
      setTimeout(load, 500);
    });
  };

  load();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
