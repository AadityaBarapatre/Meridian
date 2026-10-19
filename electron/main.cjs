const { app, BrowserWindow } = require('electron');
const path = require('path');

// Set DIST_DIR for server to locate built UI
process.env.DIST_DIR = path.join(__dirname, '../dist');

// Start the bundled backend server
require('./server.cjs');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#050816',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.setMenuBarVisibility(false);

  // Short delay to ensure server is listening on port 4000
  setTimeout(() => {
    win.loadURL('http://localhost:4000');
  }, 400);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
