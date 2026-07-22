import { initInk } from './ink.js';
import { showHelpPanel } from './help.js';

const canvas = document.getElementById('page');
function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();

const idle = Number(new URLSearchParams(location.search).get('idle')) || 2800;
const ink = initInk(canvas, {
  idleMs: idle,
  onCommit: (uri) => { window.__lastCommit = uri; },
  onHelp: () => showHelpPanel(document.body, { onDismiss: () => {} }),
});
window.__ink = ink;
document.body.dataset.ready = 'true';
