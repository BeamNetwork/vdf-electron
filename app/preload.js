/* eslint-env node, browser */

const { ipcRenderer, shell } = require('electron');
const { url } = require('./config.js');

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('test').addEventListener('click', () => shell.openExternal(url));
  document.getElementById('reset').addEventListener('click', () => ipcRenderer.send('reset-state'));

  ipcRenderer.on('state', (ev, s) => {
    const { t } = s;
    const { n } = s;

    const cached = (s[n] && s[n][t]) ? s[n][t].solved.length : 0;
    const progress = (s[n] && s[n][t] && s[n][t].working) ? s[n][t].working.progress : undefined;

    document.getElementById('t').innerText = s.t;
    document.getElementById('cached').innerText = cached;
    document.getElementById('progress').innerText = (progress === undefined) ? '' : (`${(progress * 100).toFixed(1)}%`);
  });

  ipcRenderer.send('request-state');
});
