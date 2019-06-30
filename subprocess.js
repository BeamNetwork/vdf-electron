/* Worker process for proving VDFs */

const { prove } = require('vdf-solver');

process.on('message', async (m) => {
  const {
    x, t, n, state,
  } = m;

  const callback = async (s) => {
    process.send({
      x, t, n, state: s,
    });
    return false;
  };

  const [y, u] = await prove(x, t, n, callback, state);
  if (y && u) {
    process.send({
      x, t, n, y: y.toString(), u: u.map(v => v.toString()),
    });
  }
});
