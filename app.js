'use strict';

const $ = (selector) => document.querySelector(selector);
const total = 20;
const pageRatio = 841.89 / 595.276;
const book = $('#book');
const viewport = $('#viewport');
const thumbnails = [];
let flip;
let current = 0; // First visible PDF page (zero-based), including individual covers.
let visiblePages = [1];
let soundEnabled = true;
let audioContext;
let soundBuffer;
let activeSound;
let lastSoundTime = -Infinity;
let zoomReturnFocus;

try { soundEnabled = localStorage.getItem('rawabi-paper-sound') !== 'muted'; } catch {}

// Cache the local recording. The AudioContext is resumed only by a user gesture.
const soundBytes = fetch('assets/page-turn.wav')
  .then((response) => response.ok ? response.arrayBuffer() : null)
  .catch(() => null);

async function unlockSound() {
  if (!soundEnabled) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    if (!audioContext) audioContext = new AudioContextClass();
    if (audioContext.state === 'suspended') await audioContext.resume();
    if (!soundBuffer) {
      const data = await soundBytes;
      if (data) soundBuffer = await audioContext.decodeAudioData(data.slice(0));
    }
  } catch { /* Reading and page turns remain available if audio is unsupported. */ }
}

async function playPaperSound() {
  await unlockSound();
  if (!soundEnabled || !audioContext || !soundBuffer || audioContext.state !== 'running') return;
  const now = audioContext.currentTime;
  if (now - lastSoundTime < 0.25) return;
  lastSoundTime = now;
  const source = audioContext.createBufferSource();
  const gain = audioContext.createGain();
  source.buffer = soundBuffer;
  gain.gain.value = 0.6;
  source.connect(gain);
  gain.connect(audioContext.destination);
  activeSound = source;
  source.onended = () => {
    source.disconnect(); gain.disconnect();
    if (activeSound === source) activeSound = null;
  };
  source.start();
}

document.addEventListener('pointerdown', unlockSound, { passive: true, capture: true });
document.addEventListener('keydown', unlockSound, { capture: true });

function updateSoundButton() {
  const button = $('#soundToggle');
  button.setAttribute('aria-pressed', String(soundEnabled));
  button.setAttribute('aria-label', soundEnabled ? 'كتم صوت تقليب الورق' : 'تشغيل صوت تقليب الورق');
  button.title = soundEnabled ? 'صوت الورق مفعّل — اضغط للكتم' : 'تشغيل صوت الورق';
  button.classList.toggle('muted', !soundEnabled);
}

$('#soundToggle').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  if (!soundEnabled && activeSound) {
    try { activeSound.stop(); } catch {}
  }
  try { localStorage.setItem('rawabi-paper-sound', soundEnabled ? 'on' : 'muted'); } catch {}
  updateSoundButton();
  if (soundEnabled) unlockSound();
});
updateSoundButton();

// Reverse the physical leaves: the PDF's first page sits on the right.
// Moving to the next Arabic spread therefore calls PageFlip.flipPrev().
for (let number = total; number >= 1; number--) {
  const page = document.createElement('div');
  page.className = 'page';
  const image = document.createElement('img');
  image.src = `assets/page-${String(number).padStart(2, '0')}.webp`;
  image.alt = `كتالوج روابي تهامة — الصفحة ${number}`;
  image.draggable = false;
  image.decoding = 'async';
  page.dataset.page = String(number);
  if (number === 1 || number === total) {
    page.dataset.density = 'hard';
    page.classList.add('cover');
  }
  page.append(image);
  book.append(page);
}

for (let number = 1; number <= total; number++) {
  const thumb = document.createElement('button');
  thumb.className = 'thumbnail';
  thumb.type = 'button';
  thumb.setAttribute('aria-label', `انتقل إلى الصفحة ${number}`);
  thumb.innerHTML = `<img src="assets/thumb-${String(number).padStart(2, '0')}.webp" alt="" loading="lazy"><span>${number === 1 ? 'الغلاف' : `صفحة ${number}`}</span>`;
  thumb.addEventListener('click', () => goToPage(number));
  thumbnails.push(thumb);
  $('#thumbnails').append(thumb);
}

function update(renderIndex) {
  // Native cover mode pairs physical indices [1,2], [3,4], …,
  // leaving indices 0 and 19 as closed covers. Physical order is reversed for RTL.
  if (renderIndex === total - 1) visiblePages = [1];
  else if (renderIndex === 0) visiblePages = [total];
  else {
    const leftIndex = renderIndex % 2 === 1 ? renderIndex : renderIndex - 1;
    visiblePages = [total - leftIndex - 1, total - leftIndex];
  }
  current = visiblePages[0] - 1;
  const isCover = visiblePages.length === 1;
  const lastVisible = visiblePages[visiblePages.length - 1];
  $('#pageNumber').value = current + 1;
  $('#spreadRange').hidden = isCover;
  $('#spreadEnd').textContent = String(lastVisible);
  $('#prev').disabled = current === 0;
  $('#next').disabled = current === total - 1;
  $('#progress').style.width = `${lastVisible / total * 100}%`;
  const description = isCover
    ? (current === 0 ? 'الغلاف الأمامي — الصفحة 1' : `الغلاف الخلفي — الصفحة ${total}`)
    : `الصفحتان ${visiblePages[0]} و${lastVisible} من ${total}`;
  $('#pageStatus').textContent = description;
  $('.reader').classList.toggle('is-cover', isCover);
  $('.reader').setAttribute('aria-label', description);
  $('#zoom').title = isCover ? 'تكبير الغلاف' : 'تكبير الصفحتين';
  $('#zoom').setAttribute('aria-label', $('#zoom').title);
  thumbnails.forEach((thumb, index) => {
    const visible = visiblePages.includes(index + 1);
    thumb.classList.toggle('active', visible);
    if (visible) thumb.setAttribute('aria-current', 'page');
    else thumb.removeAttribute('aria-current');
  });
}

function goToPage(number) {
  if (!flip || !Number.isInteger(number) || number < 1 || number > total) return;
  flip.flip(total - number);
}

function init() {
  if (!window.St) {
    $('#loading').innerHTML = 'تعذّر تحميل العارض. <a href="catalog.pdf">افتح الكتالوج PDF</a>';
    return;
  }
  flip = new St.PageFlip(book, {
    width: 841.89,
    height: 595.276,
    size: 'stretch',
    minWidth: 100,
    maxWidth: 1100,
    minHeight: 100 / pageRatio,
    maxHeight: 1100 / pageRatio,
    usePortrait: false,
    showCover: true,
    autoSize: true,
    drawShadow: true,
    maxShadowOpacity: 0.5,
    flippingTime: matchMedia('(prefers-reduced-motion: reduce)').matches ? 100 : 850,
    mobileScrollSupport: true,
    swipeDistance: 25,
    showPageCorners: true,
    useMouseEvents: true,
    startPage: total - 1
  });
  flip.on('flip', (event) => update(event.data));
  flip.on('changeState', (event) => {
    if (event.data === 'flipping' || event.data === 'user_fold') playPaperSound();
  });
  flip.on('init', () => {
    $('#loading').hidden = true;
    $('#book').setAttribute('aria-busy', 'false');
    update(flip.getCurrentPageIndex());
  });
  flip.loadFromHTML(document.querySelectorAll('.page'));
  update(total - 1);
}

$('#next').addEventListener('click', () => { if (flip && current < total - 1) flip.flipPrev(); });
$('#prev').addEventListener('click', () => { if (flip && current > 0) flip.flipNext(); });
$('#first').addEventListener('click', () => goToPage(1));
$('#pageNumber').addEventListener('change', (event) => {
  const number = Number(event.target.value);
  if (Number.isInteger(number) && number >= 1 && number <= total) goToPage(number);
  else event.target.value = current + 1;
});

$('#thumbToggle').addEventListener('click', () => {
  const panel = $('#thumbnails');
  panel.hidden = !panel.hidden;
  $('#thumbToggle').setAttribute('aria-expanded', String(!panel.hidden));
  if (!panel.hidden) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

function openZoom() {
  zoomReturnFocus = document.activeElement;
  const panel = $('#zoomView');
  panel.replaceChildren();
  const close = document.createElement('button');
  close.id = 'closeZoom';
  close.type = 'button';
  close.setAttribute('aria-label', 'إغلاق التكبير');
  close.textContent = '×';
  close.addEventListener('click', closeZoom);
  panel.append(close);
  const spread = document.createElement('div');
  spread.className = visiblePages.length === 1 ? 'zoom-spread single-page' : 'zoom-spread';
  panel.setAttribute('aria-label', visiblePages.length === 1 ? 'تكبير غلاف الكتالوج' : 'تكبير الصفحتين');
  // RTL flex order: earlier page on the right, following page on the left.
  for (const number of visiblePages) {
    const image = document.createElement('img');
    image.src = `assets/page-${String(number).padStart(2, '0')}.webp`;
    image.alt = `الصفحة ${number}`;
    spread.append(image);
  }
  panel.append(spread);
  panel.hidden = false;
  panel.scrollLeft = 0;
  close.focus();
}

function closeZoom() {
  $('#zoomView').hidden = true;
  if (zoomReturnFocus) zoomReturnFocus.focus();
}

$('#zoom').addEventListener('click', openZoom);
$('#fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { $('#fullscreen').title = 'ملء الشاشة غير مدعوم في هذا المتصفح'; }
});

document.addEventListener('keydown', (event) => {
  if (!$('#zoomView').hidden) {
    if (event.key === 'Escape') closeZoom();
    if (event.key === 'Tab') { event.preventDefault(); $('#closeZoom').focus(); }
    return;
  }
  if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable || !flip) return;
  if (event.key === 'ArrowRight' && current < total - 1) { event.preventDefault(); flip.flipPrev(); }
  if (event.key === 'ArrowLeft' && current > 0) { event.preventDefault(); flip.flipNext(); }
});

// PageFlip's stretch layout preserves both leaves as the container changes size.
if (window.ResizeObserver) {
  new ResizeObserver(() => { if (flip) flip.update(); }).observe(viewport);
}
init();
