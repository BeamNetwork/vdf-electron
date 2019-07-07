/* eslint-env node, browser */

const { crashReporter } = require('electron');

crashReporter.start({
  productName: 'vdf-electron',
  companyName: 'beam',
  submitURL: 'https://submit.backtrace.io/beam/d025334b0dc61e8c62bb3863b3ee13cc837ff24b684c82d17f9027c03e03a3c4/minidump',
  uploadToServer: true,
});

const backtrace = require('backtrace-js');

backtrace.initialize({
  endpoint: 'https://submit.backtrace.io/beam/d025334b0dc61e8c62bb3863b3ee13cc837ff24b684c82d17f9027c03e03a3c4/json',
  token: 'd025334b0dc61e8c62bb3863b3ee13cc837ff24b684c82d17f9027c03e03a3c4',
  handlePromises: true,
});

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
