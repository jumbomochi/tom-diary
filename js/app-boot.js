// Temporary boot stub for Plan 1; replaced by app.js in Plan 4.
const canvas = document.getElementById('page');
const dpr = window.devicePixelRatio || 1;
canvas.width = canvas.clientWidth * dpr;
canvas.height = canvas.clientHeight * dpr;
canvas.getContext('2d').scale(dpr, dpr);
document.body.dataset.ready = 'true';
