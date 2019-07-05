const electron = require('electron');
const {
  app, BrowserWindow, ipcMain, Tray, dialog,
} = require('electron');
const express = require('express');
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const Emittery = require('emittery');
const deepcopy = require('deepcopy');
const equal = require('deep-equal');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
const { port, url } = require('./config.js');

const stateEmitter = new Emittery();

const defn = '0xc7970ceedcc3b0754490201a7aa613cd73911081c790f5f1a8726f463550bb5b7ff0db8e1ea1189ec72f93d1650011bd721aeeacc2acde32a04107f0648c2813a31f5b0b7765ff8b44b4b6ffc93384b646eb09c7cf5e8592d40ea33c80039f35b4f14a04b51f7bfd781be4d1673164ba8eb991c2c4d730bbbe35f592bdef524af7e8daefd26c66fc02c479af89d64d373f442709439de66ceb955f3ea37d5159f6135809f85334b5cb1813addc80cd05609f10ac6a95ad65872c909525bdad32bc729592642920f24c61dc5b3c3b7923e56b16a4d9d373d8721f24a3fc0f1b3131f55615172866bccc30f95054c824e733a5eb6817f7bc16399d48c6361cc7e5';

// State update utility functions
let withStates;
let refreshState;
let loadState;
{
  // This contains the current working parameters as well as previously solved VDFs
  // It is shared between the express handlers and the subprocess handlers.
  let states = { t: 21, n: BigInt(defn).toString() };

  const statefile = path.join(app.getPath('userData'), 'states.json');
  const statefileTmp = path.join(app.getPath('userData'), 'states.tmp');

  withStates = (f) => {
    const before = deepcopy(states);
    f(states);
    if (!equal(states, before)) {
      refreshState();
    }
  };

  refreshState = () => {
    stateEmitter.emit('stateChanged', deepcopy(states));
  };

  stateEmitter.on('stateChanged', (state) => {
    fs.writeFileSync(statefileTmp, JSON.stringify(state));
    fs.renameSync(statefileTmp, statefile);
  });

  loadState = () => {
    try {
      log.info(`Trying to read state from ${statefile}`);
      const data = fs.readFileSync(statefile);
      states = JSON.parse(data);
    } catch (e) {
      log.info('Failed to read stored data, starting from scratch', e);
    }
    refreshState();
  };
}

// Handle subprocess
const initChild = () => {
  let waiting = false;

  const child = fork(path.join(__dirname, 'subprocess.js'));

  child.on('close', (code) => {
    log.info('child exited', code);
    dialog.showErrorBox('Background solver failed', 'The VDF solver failed to execute');
    app.quit();
  });

  stateEmitter.on('stateChanged', () => {
    withStates((states) => {
      if (!waiting) {
        if (!states[states.n]) {
          states[states.n] = {};
        }
        const sn = states[states.n];
        if (!sn[states.t]) {
          sn[states.t] = { solved: [] };
        }
        const state = sn[states.t];

        if (state.working !== undefined && state.working.t === states.t) {
          child.send({
            x: state.working.x, t: state.working.t, n: states.n, state: state.working.state,
          });
          waiting = true;
        } else if (state.solved.length < 10) {
          const x = BigInt(`0x${crypto.randomBytes(32).toString('hex')}`).toString();
          log.info('Pre-generating solution for', states.n, x, states.t);
          state.working = { x, progress: 0 };
          child.send({ x, t: states.t, n: states.n });
          waiting = true;
        }
      }
    });
  });

  child.on('message', (m) => {
    withStates((states) => {
      waiting = false;
      if (m.y) {
        log.info('Got solution for', m.n, m.x, m.t);
        states[m.n][m.t].working = undefined;
        states[m.n][m.t].solved.push({ x: m.x, y: m.y, u: m.u });
      } else {
        states[m.n][m.t].working = m;
        states[m.n][m.t].working.progress = m.step / m.steps;

        const secondsPerStep = Number(BigInt(m.elapsed)) / 1000000000;

        states[m.n][m.t].working.eta = (m.steps - m.step) * secondsPerStep;
      }
    });
  });
};

const initExpress = () => {
  const eApp = express();

  eApp.get('/', (req, res) => res.sendFile(path.join(__dirname, 'test.html')));

  eApp.use((req, res, next) => {
    if (req.headers.origin !== url) {
      //      res.status(403).send();
      next();
    } else {
      next();
    }
  });

  eApp.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', url);
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS, DELETE');
    res.header('Content-Type', 'application/json');
    next();
  });

  eApp.use(bodyParser.json({ strict: false }));

  eApp.use((req, res, next) => {
    withStates((states) => {
      req.states = states;
      next();
    });
  });

  eApp.get('/status', (req, res) => {
    const { states } = req;
    const { t, n } = states;
    res.send(JSON.stringify(
      {
        solved: (states[n] && states[n][t] && states[n][t].solved) ? states[n][t].solved.length : 0,
        n: states.n,
        t: states.t,
      },
    ));
  });

  const mapX = (n, t, e) => ({
    n: n.toString(),
    t: t.toString(),
    x: e.x.toString(),
    y: e.y.toString(),
    u: e.u.map(i => i.toString()),
  });

  const mapT = (n, t, e) => {
    const result = {};
    e.solved.forEach((it) => {
      result[it.x] = mapX(n, t, it);
    });
    return result;
  };

  const mapN = (n, e) => {
    const result = {};
    Object.keys(e)
      .map(it => Number.parseInt(it, 10))
      .filter(it => Number.isInteger(it))
      .forEach((it) => {
        result[it] = mapT(n, it, e[it]);
      });
    return result;
  };

  const mapAll = (e) => {
    const result = {};
    Object.keys(e)
      .map((it) => {
        try {
          return BigInt(it);
        } catch (err) {
          return undefined;
        }
      })
      .filter(it => it !== undefined && e[it])
      .forEach((it) => {
        result[it] = mapN(it, e[it]);
      });
    return result;
  };

  eApp.get('/vdf', (req, res) => {
    res.send(JSON.stringify(mapAll(req.states), null, 2));
  });

  eApp.get('/vdf/:n', (req, res) => {
    if (req.states[req.params.n]) {
      res.send(JSON.stringify(mapN(req.params.n, req.states[req.params.n]), null, 2));
    } else {
      res.status(404).send();
    }
  });

  eApp.get('/vdf/:n/:t', (req, res) => {
    if (req.states[req.params.n] && req.states[req.params.n][req.params.t]) {
      res.send(JSON.stringify(
        mapT(req.params.n, req.params.t, req.states[req.params.n][req.params.t]),
        null, 2,
      ));
    } else {
      res.status(404).send();
    }
  });

  eApp.get('/vdf/:n/:t/:x', (req, res) => {
    const sn = req.states[req.params.n];
    if (sn) {
      const state = sn[req.params.t];
      if (state) {
        let solution = state.solved[req.params.x];
        if (!solution) {
          [solution] = state.solved.filter(s => s.x === req.params.x);
        }
        if (solution) {
          res.send(JSON.stringify(mapX(req.params.n, req.params.t, solution), null, 2));
          return;
        }
      }
    }
    res.status(404).send();
  });

  // Get or delete a VDF solution
  // It is imperative that VDF seeds or solutions are never reused
  eApp.delete('/vdf/:n/:t/:x', (req, res) => {
    res.status(404);

    const sn = req.states[req.params.n];
    if (sn) {
      const state = sn[req.params.t];

      if (state) {
        const [solution] = state.solved.filter(s => s.x === req.params.x);
        if (solution) {
          log.info('Removing solution for', req.params.n, req.params.x, req.params.t);
          state.solved = state.solved.filter(s => s.x !== req.params.x);
          res.status(200);
        }
      }
    }
    res.send();
  });

  // Get or update difficulty parameter
  eApp.route('/t')
    .get((req, res) => res.send(JSON.stringify(req.states.t)))
    .post((req, res) => {
      const t = Number.parseInt(req.body, 10);
      if (Number.isInteger(t) && t > 10 && t < 50) {
        req.states.t = t;
        res.send();
      } else {
        res.status(400).send();
      }
    });

  // Get or update difficulty parameter
  eApp.route('/n')
    .get((req, res) => res.send(JSON.stringify(req.states.n)))
    .post((req, res) => {
      try {
        const n = BigInt(req.body);
        if (n > 1n) {
          req.states.n = n.toString();
        } else {
          res.status(400);
        }
      } catch (e) {
        res.status(400);
      } finally {
        res.send();
      }
    });

  eApp.listen(port, '127.0.0.1');
};

// Global since otherwise Electron will garbage collect it...
let tray;
let popup;

// Handle Electron app and updates
{
  const createTray = () => {
    if (app.dock) {
      app.dock.hide();
    }

    popup = new BrowserWindow({
      width: 250,
      height: 200,
      show: false,
      frame: false,
      fullscreenable: false,
      resizable: false,
      transparent: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        backgroundThrottling: false,
      },
    });
    popup.loadURL(`file://${path.join(__dirname, 'index.html')}`);

    popup.on('blur', () => {
      popup.hide();
    });

    const toggleWindow = (event, bounds) => {
      if (popup.isVisible()) {
        popup.hide();
      } else {
        const area = electron.screen.getDisplayMatching(bounds).workArea;

        const windowBounds = popup.getBounds();
        const trayBounds = tray.getBounds();

        const w = windowBounds.width;
        const h = windowBounds.height;

        let x = Math.round(trayBounds.x + (trayBounds.width / 2) - (w / 2));
        let y = Math.round(trayBounds.y + (trayBounds.height / 2) - (h / 2));

        const pad = 5;

        // Pull up from bottom
        if ((y + h) > (area.y + area.height)) {
          y = area.y + area.height - h - pad;
        }
        // Pull out from right
        if ((x + w) > (area.x + area.width)) {
          x = area.x + area.width - w - pad;
        }
        // Pull down from top
        if (y < area.y) {
          y = area.y + pad;
        }
        // Put out from left
        if (x < area.x) {
          x = area.x + pad;
        }

        popup.setPosition(x, y, false);
        popup.show();
        popup.focus();
      }
    };

    stateEmitter.on('stateChanged', (state) => {
      popup.webContents.send('state', state);
    });

    ipcMain.on('request-state', (event) => {
      withStates(
        s => event.reply('state', s),
      );
    });

    const iconPath = path.join(__dirname, process.platform === 'win32' ? 'windows-vdf@2x.png' : 'vdf.png');
    tray = new Tray(iconPath);
    tray.setToolTip('VDF Solver');

    tray.on('right-click', () => {
      toggleWindow();

      if (popup.isVisible() && process.defaultApp) {
        popup.openDevTools({ mode: 'detach' });
      }
    });
    tray.on('double-click', toggleWindow);
    tray.on('click', toggleWindow);

    loadState();
    initChild();
    initExpress();
    refreshState();

    autoUpdater.logger = log;
    autoUpdater.logger.transports.file.level = 'info';
    try {
      autoUpdater.checkForUpdatesAndNotify();
    } catch (e) {
      log.warn('Autoupdate failed', e);
    }

    log.info('Application ready');
  };

  app.on('ready', createTray);
  app.on('window-all-closed', () => {
    app.quit();
  });
}

log.info('Starting application');
