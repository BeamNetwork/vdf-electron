const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { fork } = require('child_process');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const { Mutex } = require('async-mutex');

const child = fork('subprocess.js');
const stateMutex = new Mutex();
const fileMutex = new Mutex();

const n = '0xc7970ceedcc3b0754490201a7aa613cd73911081c790f5f1a8726f463550bb5b7ff0db8e1ea1189ec72f93d1650011bd721aeeacc2acde32a04107f0648c2813a31f5b0b7765ff8b44b4b6ffc93384b646eb09c7cf5e8592d40ea33c80039f35b4f14a04b51f7bfd781be4d1673164ba8eb991c2c4d730bbbe35f592bdef524af7e8daefd26c66fc02c479af89d64d373f442709439de66ceb955f3ea37d5159f6135809f85334b5cb1813addc80cd05609f10ac6a95ad65872c909525bdad32bc729592642920f24c61dc5b3c3b7923e56b16a4d9d373d8721f24a3fc0f1b3131f55615172866bccc30f95054c824e733a5eb6817f7bc16399d48c6361cc7e5';

let states = { t: 21, n };
let waiting = false;

const statefile = `${__dirname}/states.json`;
const statefileTmp = `${__dirname}/states.json.tmp`;

async function saveState() {
  const release = await fileMutex.acquire();
  await fs.writeFile(statefileTmp, JSON.stringify(states));
  await fs.rename(statefileTmp, statefile);
  release();
}

async function nextStep() {
  const release = await stateMutex.acquire();
  if (!waiting) {
    if (!states[states.t]) {
      states[states.t] = { solved: [] };
    }
    const state = states[states.t];

    if (state.working !== undefined && state.working.t === states.t) {
      child.send({
        x: state.working.x, t: state.working.t, n, state: state.working.state,
      });
      waiting = true;
    } else if (state.solved.length < 10) {
      const x = BigInt(`0x${await crypto.randomBytes(32).toString('hex')}`).toString();
      console.log('Pre-generating solution for', x, states.t);
      state.working = { x };
      child.send({ x, t: states.t, n });
      waiting = true;
    }
  }
  release();
}

child.on('close', (code) => {
  console.log('child exited', code);
  process.exit(0);
});

child.on('message', async (m) => {
  const release = await stateMutex.acquire();
  waiting = false;
  if (m.y) {
    console.log('Got solution for', m.x, m.t);
    states[m.t].working = undefined;
    states[m.t].solved.push({ x: m.x, y: m.y, u: m.u });
  } else {
    states[m.t].working = m;
  }
  saveState();
  nextStep();
  release();
});

// This is a horrible way to do something on init :(

(async () => {
  try {
    const data = await fs.readFile(statefile);
    const savedStates = JSON.parse(data);
    if (savedStates.n === n) {
      states = savedStates;
    } else {
      console.log('Outdated states, starting over');
    }
  } catch (e) {
    console.log('Failed to read stored data, starting from scratch', e);
  }
  nextStep();
})();

const app = express();
const port = 27718;
const url = `http://lvh.me:${port}`;

app.get('/', (req, res) => res.sendFile(path.join(`${__dirname}/test.html`)));

app.use((req, res, next) => {
  if (req.headers.origin !== url) {
    res.status(403).send();
  } else {
    next();
  }
});

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', url);
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS, DELETE');
  res.header('Content-Type', 'application/json');
  next();
});

app.use(bodyParser.json());

app.get('/status', (req, res) => res.send(JSON.stringify(
  {
    working: waiting,
    solved: states[states.t].solved.length,
    t: states.t,
  },
)));

app.get('/vdf', (req, res) => {
  const reply = {};
  Object.keys(states)
    .map(it => Number.parseInt(it, 10))
    .filter(it => Number.isInteger(it))
    .forEach((it) => {
      reply[it] = states[it].solved.map(v => v.x);
    });
  res.send(JSON.stringify(reply));
});

app.route('/vdf/:t/:x')
  .get((req, res) => {
    const state = states[req.params.t];
    if (state) {
      const [solution] = state.solved.filter(s => s.x === req.params.x);
      if (solution) {
        res.send(JSON.stringify({ y: solution.y, u: solution.u }));
        return;
      }
    }
    res.status(404).send();
  })
  .delete(async (req, res) => {
    const release = await stateMutex.acquire();
    const state = states[req.params.t];

    res.status(404);
    if (state) {
      const [solution] = state.solved.filter(s => s.x === req.params.x);
      if (solution) {
        console.log('Removing solution for', req.params.x, req.params.t);
        state.solved = state.solved.filter(s => s.x !== req.params.x);
        await saveState();
        nextStep();
        res.status(200);
      }
    }
    release();
    res.send();
  });

app.route('/t')
  .get((req, res) => res.send(JSON.stringify(states.t)))
  .post(async (req, res) => {
    const release = await stateMutex.acquire();
    const t = Number.parseInt(req.body.t, 10);
    if (Number.isInteger(t) && t > 10 && t < 50) {
      states.t = req.body.t;
      await saveState();
      nextStep();
      res.send();
    } else {
      res.status(404).send();
    }
    release();
  });

app.listen(port, () => console.log(`Please open http://lvh.me:${port}/`));
