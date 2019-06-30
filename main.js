const {
  app, Menu, Tray,
} = require('electron');
const path = require('path');
const { prove } = require('vdf-solver');

let appIcon;

function createTray() {
  const iconName = process.platform === 'win32' ? 'windows-icon.png' : 'iconTemplate.png';
  const iconPath = path.join(__dirname, iconName);
  appIcon = new Tray(iconPath);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Version',
      enabled: 'false',
    },
    {
      label: 'Quit',
      role: 'quit',
      click: () => {
        app.quit();
      },
    }]);

  appIcon.setToolTip('VDF Solver');
  appIcon.setContextMenu(contextMenu);

  app.dock.hide();

  console.log(prove('3', 5, '123'));
}

app.on('ready', createTray);
