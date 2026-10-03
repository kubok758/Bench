// Minimal UI: loader, intro card, style toast, fading hint.
const $ = (id) => document.getElementById(id);

export const ui = {
  progress(p, label) {
    $('progress').style.width = `${Math.round(p * 100)}%`;
    if (label) $('status').textContent = label;
  },
  loaded() {
    $('loader').classList.add('done');
  },
  showIntro(show) {
    $('intro').classList.toggle('show', show);
  },
  onEnter(cb) {
    $('enter').addEventListener('click', (e) => { e.stopPropagation(); cb(); });
  },
  exploring() {
    this.showIntro(false);
    $('crosshair').classList.add('show');
    const hint = $('hint');
    hint.classList.add('show');
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => hint.classList.remove('show'), 9000);
  },
  touring() {
    $('crosshair').classList.remove('show');
  },
  toast(n, name, sub) {
    $('toast-n').textContent = `${n} · ${sub}`;
    $('toast-s').textContent = name;
    const t = $('toast');
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), 1900);
  },
  toggleHidden() {
    document.body.classList.toggle('hide-ui');
  },
  fail() {
    $('fail').classList.add('show');
  },
};
