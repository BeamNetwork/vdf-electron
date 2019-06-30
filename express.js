const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { fork } = require('child_process');
const crypto = require('crypto');

const child = fork('subprocess.js');

const t = 22;
const n = '0xc7970ceedcc3b0754490201a7aa613cd73911081c790f5f1a8726f463550bb5b7ff0db8e1ea1189ec72f93d1650011bd721aeeacc2acde32a04107f0648c2813a31f5b0b7765ff8b44b4b6ffc93384b646eb09c7cf5e8592d40ea33c80039f35b4f14a04b51f7bfd781be4d1673164ba8eb991c2c4d730bbbe35f592bdef524af7e8daefd26c66fc02c479af89d64d373f442709439de66ceb955f3ea37d5159f6135809f85334b5cb1813addc80cd05609f10ac6a95ad65872c909525bdad32bc729592642920f24c61dc5b3c3b7923e56b16a4d9d373d8721f24a3fc0f1b3131f55615172866bccc30f95054c824e733a5eb6817f7bc16399d48c6361cc7e5';

let states = { n };
let waiting = false;

const statefile = `${__dirname}/states.json`;
const statefileTmp = `${__dirname}/states.json.tmp`;

async function nextStep() {
  if (waiting) {
    return;
  }

  if (!states[t]) {
    states[t] = { solved: [] };
  }

  const state = states[t];
  if (state.working !== undefined) {
    child.send({
      x: state.working.x, t, n, state: state.working.state,
    });
    waiting = true;
    return;
  } if (state.solved.length < 10) {
    const x = BigInt(`0x${await crypto.randomBytes(32).toString('hex')}`).toString();
    console.log('Pre-generating solution for', x);
    state.working = { x };
    child.send({ x, t, n });
    waiting = true;
    return;
  }
  console.log('Worker idle');
}

child.on('close', (code) => {
  console.log('child exited', code);
  process.exit(0);
});

child.on('message', async (m) => {
  waiting = false;
  if (m.y) {
    console.log('Got solution for', m.x);
    states[m.t].working = undefined;
    states[m.t].solved.push({ x: m.x, y: m.y, u: m.u });
  } else {
    states[m.t].working = m;
  }
  await fs.writeFile(statefileTmp, JSON.stringify(states));
  await fs.rename(statefileTmp, statefile);
  nextStep();
});

(async () => {
  try {
    const data = await fs.readFile(statefile);
    states = JSON.parse(data);
    if (states.n !== n) {
      console.log('Outdated states, starting over');
      states = { n };
    }
  } catch (e) {
    console.log('Failed to read stored data, starting from scratch', e);
  }
  nextStep();
})();

console.log('State dir', __dirname);

const app = express();
const port = 3000;

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'http://lvh.me:3000');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

app.get('/status', (req, res) => res.send(JSON.stringify(
  {
    working: waiting,
    solved: states[t].solved.length,
    t,
  },
)));

app.get('/', (req, res) => res.sendFile(path.join(`${__dirname}/test.html`)));

app.listen(port, () => console.log('Please open http://lvh.me:3000/'));
