// PicBrowse front end. No framework, no build step.

const $ = (id) => document.getElementById(id);
const grid = $('grid');
const crumbs = $('crumbs');
const statusEl = $('status');
const countEl = $('count');
const sortEl = $('sort');
const viewer = $('viewer');
const stage = $('stage');

const ICONS = {
  folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6l2 2h7.4A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" fill="currentColor"/></svg>',
  image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="10" r="1.7" fill="currentColor"/><path d="M4.5 17.5l5-5 3.5 3.5 2.5-2.5 4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  video: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor"/></svg>',
  play: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1l9 5-9 5z" fill="#fff"/></svg>',
};

// ---------- helpers ----------

const encodePath = (rel) => rel.split('/').map(encodeURIComponent).join('/');
const browseUrl = (rel) => `/browse/${rel ? `${encodePath(rel)}/` : ''}`;
const thumbUrl = (item) => `/thumb/${encodePath(item.path)}?v=${item.mtime}-${item.size}`;
const mediaUrl = (item) => `/media/${encodePath(item.path)}`;
const viewUrl = (item) => (item.type === 'image' && !item.web
  ? `/preview/${encodePath(item.path)}?v=${item.mtime}-${item.size}`
  : mediaUrl(item));

function relFromLocation() {
  let p = location.pathname.replace(/^\/browse\/?/, '').replace(/\/+$/, '');
  if (location.pathname === '/') p = '';
  try {
    return p ? p.split('/').map(decodeURIComponent).join('/') : '';
  } catch {
    return '';
  }
}
function viewFromLocation() {
  const m = /^#view=(.+)$/.exec(location.hash);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

function el(tag, attrs = {}, html = '') {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  if (html) e.insertAdjacentHTML('beforeend', html);
  return e;
}

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

const dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------- state ----------

let data = null;       // last /api/browse response
let items = [];        // media files in display order (what the viewer steps through)
let currentRel = null;
let loadCtl = null;
const scrollMemory = new Map();
history.scrollRestoration = 'manual';

sortEl.value = store.get('picbrowse.sort', 'name');
sortEl.addEventListener('change', () => {
  store.set('picbrowse.sort', sortEl.value);
  if (data) render();
});

// ---------- loading & rendering ----------

async function load(rel) {
  if (currentRel !== null) scrollMemory.set(currentRel, scrollY);
  currentRel = rel;
  loadCtl?.abort();
  loadCtl = new AbortController();
  const slow = setTimeout(() => showStatus('Loading…'), 250);
  try {
    const res = await fetch(`/api/browse?path=${encodeURIComponent(rel)}`, { signal: loadCtl.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    data = body;
    render();
    scrollTo(0, scrollMemory.get(rel) ?? 0);
    syncViewerToLocation();
  } catch (err) {
    if (err.name === 'AbortError') return;
    data = null;
    grid.replaceChildren();
    renderCrumbs([{ name: 'Home', path: '' }]);
    showStatus(err.message === 'Not found' ? 'This folder no longer exists.' : `Could not load folder: ${err.message}`, true);
  } finally {
    clearTimeout(slow);
  }
}

function showStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
  statusEl.hidden = !msg;
}

function sortedFiles(files) {
  const f = [...files];
  if (sortEl.value === 'newest') f.sort((a, b) => b.mtime - a.mtime);
  else if (sortEl.value === 'oldest') f.sort((a, b) => a.mtime - b.mtime);
  return f; // server already returns natural name order
}

function renderCrumbs(list) {
  crumbs.replaceChildren();
  list.forEach((c, i) => {
    if (i > 0) crumbs.append(el('span', { class: 'sep', 'aria-hidden': 'true', text: '›' }));
    const last = i === list.length - 1;
    crumbs.append(el('a', {
      href: browseUrl(c.path), 'data-nav': c.path, text: c.name,
      'aria-current': last ? 'page' : null,
    }));
  });
  // Keep the current folder visible on narrow screens.
  crumbs.scrollLeft = crumbs.scrollWidth;
}

function thumbImg(src, wrap) {
  const img = el('img', { src, alt: '', loading: 'lazy', decoding: 'async' });
  img.addEventListener('load', () => { img.classList.add('loaded'); wrap.classList.add('has-img'); }, { once: true });
  img.addEventListener('error', () => img.remove(), { once: true });
  return img;
}

function render() {
  const { folders, files } = data;
  items = sortedFiles(files);
  renderCrumbs(data.breadcrumbs);
  document.title = data.path ? `${data.name} · PicBrowse` : 'PicBrowse';

  const nImg = items.filter((f) => f.type === 'image').length;
  const nVid = items.length - nImg;
  const parts = [];
  if (folders.length) parts.push(plural(folders.length, 'folder'));
  if (nImg) parts.push(plural(nImg, 'photo'));
  if (nVid) parts.push(plural(nVid, 'video'));
  countEl.textContent = parts.join(' · ');

  const frag = document.createDocumentFragment();

  if (folders.length && items.length) frag.append(el('h2', { class: 'section-label', text: 'Folders' }));
  for (const f of folders) {
    const a = el('a', { class: 'tile folder', href: browseUrl(f.path), 'data-nav': f.path, title: f.name });
    const thumb = el('div', { class: 'thumb' }, `<span class="ph">${ICONS.folder}</span>`);
    if (f.cover) thumb.append(thumbImg(thumbUrl(f.cover), thumb));
    const n = f.counts ? f.counts.folders + f.counts.files : null;
    thumb.append(el('span', { class: 'badge' }, `${ICONS.folder}${n != null ? n : ''}`));
    a.append(thumb, el('div', { class: 'name', text: f.name }));
    frag.append(a);
  }

  if (folders.length && items.length) frag.append(el('h2', { class: 'section-label', text: 'Photos & videos' }));
  items.forEach((f, i) => {
    // Link to the in-app viewer, never to the raw file, so nothing can hand the file to another app.
    const a = el('a', { class: `tile ${f.type}`, href: `${browseUrl(data.path)}#view=${encodeURIComponent(f.name)}`, 'data-index': i, title: f.name });
    const thumb = el('div', { class: 'thumb' }, `<span class="ph">${ICONS[f.type]}</span>`);
    thumb.append(thumbImg(thumbUrl(f), thumb));
    if (f.type === 'video') thumb.append(el('span', { class: 'play' }, ICONS.play));
    a.append(thumb, el('div', { class: 'name', text: f.name }), el('div', { class: 'meta', text: dateFmt.format(f.mtime) }));
    frag.append(a);
  });

  grid.replaceChildren(frag);
  showStatus(folders.length || items.length ? '' : 'This folder has no photos, videos or subfolders.');
}

// ---------- navigation ----------

document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const nav = e.target.closest('a[data-nav]');
  if (nav) {
    e.preventDefault();
    const rel = nav.getAttribute('data-nav');
    if (rel !== currentRel || viewFromLocation()) {
      history.pushState(null, '', browseUrl(rel));
      load(rel);
    }
    return;
  }
  const tile = e.target.closest('a[data-index]');
  if (tile) {
    e.preventDefault();
    openViewer(Number(tile.dataset.index), { push: true, fullscreen: true });
  }
});

window.addEventListener('popstate', () => {
  const rel = relFromLocation();
  if (rel !== currentRel) load(rel);
  else syncViewerToLocation();
});

// ---------- viewer ----------

let vIndex = -1;
let enteredFullscreen = false;
let leavingFullscreenOnPurpose = false;
let touchStart = null;

function syncViewerToLocation() {
  const name = viewFromLocation();
  const i = name ? items.findIndex((f) => f.name === name) : -1;
  if (i >= 0) openViewer(i, { push: false });
  else if (!viewer.hidden) hideViewer();
}

function openViewer(i, { push = false, fullscreen = false } = {}) {
  if (i < 0 || i >= items.length) return;
  const wasOpen = !viewer.hidden;
  vIndex = i;
  const item = items[i];
  const hash = `#view=${encodeURIComponent(item.name)}`;
  if (push && !wasOpen) history.pushState({ view: true }, '', hash);
  else if (location.hash !== hash) history.replaceState(history.state, '', hash);

  viewer.hidden = false;
  document.body.style.overflow = 'hidden';
  if (fullscreen && !document.fullscreenElement && viewer.requestFullscreen) {
    viewer.requestFullscreen().then(() => { enteredFullscreen = true; }).catch(() => { /* not allowed (e.g. iPhone) */ });
  }
  showItem(item);
  poke();
}

function showItem(item) {
  stage.replaceChildren(el('div', { class: 'spinner' }));
  viewer.classList.toggle('is-video', item.type === 'video');
  $('vtitle').textContent = item.name;
  $('vpos').textContent = `${vIndex + 1} / ${items.length}`;
  const dl = $('vdownload');
  dl.href = `${mediaUrl(item)}?download=1`;
  $('vprev').disabled = vIndex <= 0;
  $('vnext').disabled = vIndex >= items.length - 1;

  if (item.type === 'image') {
    const img = new Image();
    img.alt = item.name;
    img.decoding = 'async';
    img.addEventListener('load', () => { if (items[vIndex] === item) stage.replaceChildren(img); });
    img.addEventListener('error', () => {
      if (items[vIndex] === item) showFallback(item, 'This image can’t be displayed', 'Your browser can’t show this file. You can download the original and open it on your device.', 'Download original');
    });
    img.src = viewUrl(item);
    preloadNeighbours();
  } else {
    const v = el('video', { controls: '', autoplay: '', playsinline: '', preload: 'metadata' });
    v.addEventListener('error', () => {
      if (items[vIndex] === item) showFallback(item, 'This video can’t play in the browser', 'Its format isn’t supported here. Open it in your video player instead.', 'Open in video player');
    });
    v.addEventListener('loadedmetadata', () => {
      // Unsupported video codec with a supported audio track: browsers play sound with no picture.
      if (v.videoWidth === 0 && v.videoHeight === 0 && items[vIndex] === item) {
        v.pause();
        showFallback(item, 'This video can’t play in the browser', 'The browser can play its sound but not its picture. Open it in your video player instead.', 'Open in video player');
      }
    });
    v.src = mediaUrl(item);
    stage.replaceChildren(v);
  }
}

function showFallback(item, title, text, button) {
  const box = el('div', { class: 'fallback' });
  box.append(
    el('h2', { text: title }),
    el('p', { text }),
    el('a', { href: `${mediaUrl(item)}?download=1`, text: button }),
  );
  stage.replaceChildren(box);
}

function preloadNeighbours() {
  for (const j of [vIndex + 1, vIndex - 1]) {
    const n = items[j];
    if (n && n.type === 'image') new Image().src = viewUrl(n);
  }
}

function step(delta) {
  const j = vIndex + delta;
  if (j >= 0 && j < items.length) openViewer(j);
}

function hideViewer() {
  stage.querySelector('video')?.pause();
  stage.replaceChildren();
  viewer.hidden = true;
  document.body.style.overflow = '';
  vIndex = -1;
  if (document.fullscreenElement) {
    leavingFullscreenOnPurpose = true;
    document.exitFullscreen().catch(() => {});
  }
  enteredFullscreen = false;
  closing = false;
}

let closing = false;
function closeViewer() {
  if (viewer.hidden || closing) return; // Esc can arrive both as a key and as a fullscreen exit
  closing = true;
  const last = items[vIndex];
  if (history.state?.view) history.back(); // popstate will hide it
  else {
    history.replaceState(null, '', location.pathname);
    hideViewer();
  }
  if (last) {
    const idx = items.indexOf(last);
    grid.querySelector(`a[data-index="${idx}"]`)?.scrollIntoView({ block: 'nearest' });
  }
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    leavingFullscreenOnPurpose = true;
    document.exitFullscreen().catch(() => {});
  } else {
    viewer.requestFullscreen?.().then(() => { enteredFullscreen = true; }).catch(() => {});
  }
}

// Pressing Esc in fullscreen is swallowed by the browser; treat leaving fullscreen as "close".
document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement) return;
  const purposeful = leavingFullscreenOnPurpose;
  leavingFullscreenOnPurpose = false;
  if (!viewer.hidden && enteredFullscreen && !purposeful) closeViewer();
  enteredFullscreen = false;
});

$('vclose').addEventListener('click', closeViewer);
$('vprev').addEventListener('click', () => step(-1));
$('vnext').addEventListener('click', () => step(1));
$('vfull').addEventListener('click', toggleFullscreen);

// Click on the dark area around an image closes the viewer.
stage.addEventListener('click', (e) => {
  if (e.target === stage) closeViewer();
});

document.addEventListener('keydown', (e) => {
  if (viewer.hidden || e.altKey || e.ctrlKey || e.metaKey) return;
  const inVideo = e.target.tagName === 'VIDEO';
  switch (e.key) {
    case 'ArrowLeft': if (!inVideo) { e.preventDefault(); step(-1); } break;
    case 'ArrowRight': if (!inVideo) { e.preventDefault(); step(1); } break;
    case 'PageUp': e.preventDefault(); step(-1); break;
    case 'PageDown': e.preventDefault(); step(1); break;
    case 'Escape': e.preventDefault(); closeViewer(); break;
    case 'f': case 'F': e.preventDefault(); toggleFullscreen(); break;
    default: return;
  }
  poke();
});

// Swipe left/right on photos.
stage.addEventListener('touchstart', (e) => {
  touchStart = e.touches.length === 1 && items[vIndex]?.type === 'image'
    ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null;
}, { passive: true });
stage.addEventListener('touchend', (e) => {
  if (!touchStart || (window.visualViewport && visualViewport.scale > 1.01)) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - touchStart.t < 800) step(dx < 0 ? 1 : -1);
  touchStart = null;
});

// Hide controls after a few seconds without mouse movement.
let idleTimer;
function poke() {
  viewer.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!viewer.hidden && items[vIndex]?.type === 'image') viewer.classList.add('idle');
  }, 2500);
}
viewer.addEventListener('mousemove', poke);
viewer.addEventListener('touchstart', poke, { passive: true });

// ---------- start ----------

load(relFromLocation());
