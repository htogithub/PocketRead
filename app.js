/* PocketRead — app logic */
'use strict';
(() => {

/* ============================================================
   Helpers
   ============================================================ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtNum = (x) => String(Math.round(x * 100) / 100).replace('.', ',');
const UA = navigator.userAgent;
const isIOS = /iP(hone|ad|od)/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isMac = /Mac/.test(navigator.platform) && !isIOS;
const isAndroid = /Android/i.test(UA);
const isWindows = /Windows/i.test(UA);
const isEdge = /Edg\//.test(UA);
const isChrome = /Chrome\//.test(UA) && !isEdge;
const isTouch = matchMedia('(pointer: coarse)').matches;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const CANCELLED = 'cancelled';
let scrubbing = false, scrubWasPlaying = false;
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const LIBS = {
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
};
const VOICE_CACHE = 'pocketread-voices-v1';
const PIPER_HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';

const LANGS = {
  fr: { name: 'Français', short: 'FR', tag: 'fr-FR', ocr: 'fra', sample: 'Bonjour ! Voici la voix qui va te lire ce texte.' },
  en: { name: 'English', short: 'EN', tag: 'en-US', ocr: 'eng', sample: 'Hello! This is the voice that will read your text.' },
  de: { name: 'Deutsch', short: 'DE', tag: 'de-DE', ocr: 'deu', sample: 'Hallo! Mit dieser Stimme lese ich dir deinen Text vor.' },
};

const PIPER_VOICES = {
  fr: [
    { key: 'fr_FR-siwis-medium', label: 'Siwis', g: 'F' },
    { key: 'fr_FR-tom-medium', label: 'Tom', g: 'M' },
    { key: 'fr_FR-upmc-medium#jessica', label: 'Jessica', g: 'F' },
    { key: 'fr_FR-upmc-medium#pierre', label: 'Pierre', g: 'M' },
    { key: 'fr_FR-gilles-low', label: 'Gilles', g: 'M' },
  ],
  en: [
    { key: 'en_US-hfc_female-medium', label: 'HFC Female', g: 'F' },
    { key: 'en_US-hfc_male-medium', label: 'HFC Male', g: 'M' },
    { key: 'en_US-amy-medium', label: 'Amy', g: 'F' },
    { key: 'en_US-lessac-medium', label: 'Lessac', g: 'F' },
    { key: 'en_US-ryan-medium', label: 'Ryan', g: 'M' },
    { key: 'en_US-joe-medium', label: 'Joe', g: 'M' },
    { key: 'en_GB-alba-medium', label: 'Alba (UK)', g: 'F' },
    { key: 'en_GB-northern_english_male-medium', label: 'Northern (UK)', g: 'M' },
  ],
  de: [
    { key: 'de_DE-thorsten-medium', label: 'Thorsten', g: 'M' },
    { key: 'de_DE-kerstin-low', label: 'Kerstin', g: 'F' },
    { key: 'de_DE-ramona-low', label: 'Ramona', g: 'F' },
    { key: 'de_DE-eva_k-x_low', label: 'Eva', g: 'F' },
    { key: 'de_DE-karlsson-low', label: 'Karlsson', g: 'M' },
    { key: 'de_DE-pavoque-low', label: 'Pavoque', g: 'M' },
  ],
};

/* ============================================================
   Settings
   ============================================================ */
const SKEY = 'pocketread.settings.v1';
const DEFAULTS = {
  engine: 'system', lang: 'auto', gender: 'all', showAll: false,
  sysVoice: { fr: '', en: '', de: '' },
  piperVoice: { fr: 'fr_FR-siwis-medium', en: 'en_US-hfc_female-medium', de: 'de_DE-thorsten-medium' },
  rate: 1, pitch: 0, volume: 1,
  pauseSentence: 250, pauseParagraph: 700,
  noiseScale: null, noiseW: null,
  theme: 'auto', font: 'serif', fontSize: 20, lineHeight: 1.75, width: 680,
  hlWord: true, hlSentence: true, autoScroll: true, focus: false, dimRead: true, tapToRead: true, wakeLock: true,
  ocrLangs: ['fra', 'eng'],
  noticeDismissed: false,
};
const S = (() => {
  const base = JSON.parse(JSON.stringify(DEFAULTS));
  try {
    const raw = JSON.parse(localStorage.getItem(SKEY) || '{}');
    for (const k of Object.keys(base)) {
      if (!(k in raw)) continue;
      if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) Object.assign(base[k], raw[k]);
      else base[k] = raw[k];
    }
  } catch (e) { /* first run */ }
  return base;
})();
const save = () => { try { localStorage.setItem(SKEY, JSON.stringify(S)); } catch (e) { /* private mode */ } };

/* ============================================================
   DOM refs
   ============================================================ */
const el = {
  home: $('#home'), reader: $('#reader'), doc: $('#doc'), docWrap: $('#docWrap'), marker: $('#marker'),
  editor: $('#editor'), editText: $('#editText'), player: $('#player'), playBtn: $('#playBtn'),
  scrub: $('#scrub'), tElapsed: $('#tElapsed'), tLeft: $('#tLeft'), voiceLbl: $('#voiceLbl'), speedPill: $('#speedPill'),
  busy: $('#busy'), busyTitle: $('#busyTitle'), busySub: $('#busySub'), busyBar: $('#busyBar'),
  sheet: $('#sheet'), sheetBody: $('#sheetBody'), scrim: $('#scrim'), toast: $('#toast'),
  audio: $('#audio'), notice: $('#voiceNotice'), returnPill: $('#returnPill'), readerTop: $('#readerTop'),
};

/* ============================================================
   UI basics: toast, busy, script loader
   ============================================================ */
let toastT = 0;
function toast(msg, ms = 3400) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.toast.classList.remove('show'), ms);
}

function showBusy(title, sub = '', frac = null) { el.busy.hidden = false; setBusy(title, sub, frac); }
function setBusy(title, sub = '', frac = null) {
  if (title != null) el.busyTitle.textContent = title;
  el.busySub.textContent = sub || '';
  const bar = el.busyBar;
  if (frac == null) bar.classList.add('indet');
  else { bar.classList.remove('indet'); bar.firstElementChild.style.width = `${Math.round(clamp(frac, 0, 1) * 100)}%`; }
}
function hideBusy() { el.busy.hidden = true; }

const loaded = {};
function loadScript(src) {
  if (!loaded[src]) {
    loaded[src] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = res;
      s.onerror = () => { delete loaded[src]; rej(new Error('Impossible de charger un module. Vérifie ta connexion internet.')); };
      document.head.append(s);
    });
  }
  return loaded[src];
}

function fillRange(r) {
  const min = +r.min, max = +r.max, v = +r.value;
  r.style.setProperty('--p', `${max > min ? ((v - min) / (max - min)) * 100 : 0}%`);
}

/* ============================================================
   Language detection
   ============================================================ */
const STOP = {
  fr: 'le la les des et est une un du que qui dans pour pas sur au avec ce il elle nous vous sont été mais ou plus par cette aux ces se sa son leur on je tu ne',
  en: 'the and of to is in that it for was on are with as this be by not have you from at or which they their were has had will would there what about',
  de: 'der das und ist nicht zu den von mit sich des auf für im dem ein eine auch es als wird sind bei wir ich noch nach wie aus oder wenn werden kann sie',
};
const STOPSETS = Object.fromEntries(Object.entries(STOP).map(([k, v]) => [k, new Set(v.split(' '))]));
function detectLang(text) {
  const words = text.slice(0, 6000).toLowerCase().split(/[^a-zà-ÿäöüß']+/).filter(Boolean);
  const score = { fr: 0, en: 0, de: 0 };
  for (const w of words) for (const l of Object.keys(score)) if (STOPSETS[l].has(w)) score[l]++;
  if (/[äöüß]/.test(text.slice(0, 6000))) score.de += 3;
  let best = 'fr';
  for (const l of Object.keys(score)) if (score[l] > score[best]) best = l;
  return best;
}
const effLang = () => (S.lang === 'auto' ? (doc ? doc.lang : 'fr') : S.lang);

/* ============================================================
   Text cleanup (OCR / PDF → paragraphs)
   ============================================================ */
function isJunkLine(l) {
  if (/^(page\s*)?\d{1,4}(\s*(\/|sur|of|von)\s*\d{1,4})?$/i.test(l)) return true;
  if (!/[\p{L}\p{N}]/u.test(l)) return true;
  if (l.length <= 2 && !/^\p{L}+$/u.test(l)) return true;
  return false;
}
function cleanText(raw) {
  let t = String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00AD/g, '')
    .replace(/[\u00A0\u202F\t ]+/g, ' ')
    .replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ﬀ/g, 'ff').replace(/ﬃ/g, 'ffi').replace(/ﬄ/g, 'ffl');
  t = t.replace(/(\p{L})[-‐‑]\s*\n\s*(\p{Ll})/gu, '$1$2');
  const out = [];
  const BUL = /^([•▪◦●■·*\-–]|\d{1,2}[.)])\s+/;
  for (const block of t.split(/\n\s*\n+/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter((l) => l && !isJunkLine(l));
    if (!lines.length) continue;
    const lens = lines.map((l) => l.length).sort((x, y) => x - y);
    const med = lens[Math.floor(lens.length / 2)];
    const p90 = lens[Math.floor((lens.length - 1) * 0.9)];
    const logical = med > 140; // pasted text: each line is already a paragraph
    let cur = '';
    const flush = () => { if (cur) out.push(cur); cur = ''; };
    lines.forEach((raw, k) => {
      const isBullet = BUL.test(raw);
      const l = raw.replace(/^[•▪◦●■·*]\s+/, '');
      const next = lines[k + 1];
      const prev = lines[k - 1];
      const heading = lines.length > 2 && l.length < Math.max(12, p90 * 0.75) && l.split(' ').length <= 10
        && !/[.!?…:;,»"”)]$/.test(l) && (!prev || /[.!?…:»"”)]$/.test(prev)) && !!next && /^[\p{Lu}\d«"]/u.test(next);
      if (isBullet || heading) flush();
      cur = cur ? `${cur} ${l}` : l;
      if (!next) return;
      const ends = /[.!?…:»"”)]$/.test(l);
      const short = l.length < p90 * 0.8;
      if (logical || heading || isBullet || (ends && short) || BUL.test(next)) flush();
    });
    flush();
  }
  return out
    .map((p) => p.replace(/\s+([,.](?!\d))/g, '$1').replace(/\s{2,}/g, ' ').trim())
    .filter((p) => p && /[\p{L}\p{N}]/u.test(p));
}

/* ============================================================
   Document model
   ============================================================ */
let doc = null;

function splitSentences(text, lang) {
  let parts;
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const seg = new Intl.Segmenter(lang, { granularity: 'sentence' });
    parts = [...seg.segment(text)].map((s) => s.segment.trim()).filter(Boolean);
  } else {
    parts = (text.match(/[^.!?…]+[.!?…]+["»”')\]]*\s*|[^.!?…]+$/g) || [text]).map((s) => s.trim()).filter(Boolean);
  }
  const ABBR = /(^|[\s(])(M|MM|Mme|Mmes|Mlle|Dr|Pr|Prof|St|Ste|cf|ex|etc|env|p|pp|vol|chap|fig|éd|no|n°|Mr|Mrs|Ms|Nr|bzw|ca|vgl|usw|vs|[A-ZÀ-Ý])\.$/;
  const merged = [];
  for (const p of parts) {
    const last = merged[merged.length - 1];
    if (last != null && (p.length < 4 || /^[»"”')\]]/.test(p) || ABBR.test(last) || /^\p{Ll}/u.test(p))) merged[merged.length - 1] = `${last} ${p}`;
    else merged.push(p);
  }
  return merged;
}
function chunkSentence(s, max = 220) {
  if (s.length <= max) return [s];
  const out = [];
  let rest = s;
  while (rest.length > max) {
    const win = rest.slice(0, max);
    let cut = -1;
    for (const re of [/[;:—–]\s/g, /,\s/g, /\s/g]) {
      let m, last = -1;
      re.lastIndex = 0;
      while ((m = re.exec(win))) if (m.index > max * 0.4) last = m.index + m[0].length;
      if (last > 0) { cut = last; break; }
    }
    if (cut < 0) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}
function titleFrom(paras) {
  const t = (paras[0] || '').trim();
  if (t.length <= 60) return t;
  return `${t.slice(0, 60).replace(/\s+\S*$/, '')}…`;
}
function buildDoc(paras, title) {
  const lang = detectLang(paras.join(' '));
  const d = { title: title || titleFrom(paras), lang, paras: [], units: [] };
  paras.forEach((ptext) => {
    const words = ptext.split(/\s+/).length;
    const head = paras.length > 1 && ptext.length < 80 && words <= 12 && !/[.!?…:;,»"”)]$/.test(ptext);
    const para = { i: d.paras.length, text: ptext, head, units: [] };
    for (const s of splitSentences(ptext, lang)) {
      const chunks = chunkSentence(s);
      chunks.forEach((c, ci) => {
        const u = { i: d.units.length, p: para.i, text: c, chunk: ci < chunks.length - 1, paraEnd: false };
        para.units.push(u);
        d.units.push(u);
      });
    }
    if (para.units.length) { para.units[para.units.length - 1].paraEnd = true; d.paras.push(para); }
  });
  return d;
}

/* timing estimate (chars per second at 1×) */
const CPS = 14.5;
function computeTimes() {
  if (!doc) return;
  const n = doc.units.length;
  doc.cumChars = new Float64Array(n + 1);
  doc.cumPause = new Float64Array(n + 1);
  for (let k = 0; k < n; k++) {
    const u = doc.units[k];
    doc.cumChars[k + 1] = doc.cumChars[k] + u.text.length;
    doc.cumPause[k + 1] = doc.cumPause[k] + (u.paraEnd ? S.pauseParagraph : u.chunk ? S.pauseSentence * 0.3 : S.pauseSentence) / 1000;
  }
}
const timeAt = (i) => doc.cumChars[i] / CPS / S.rate + doc.cumPause[i];
function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function updateProgress() {
  if (!doc) return;
  const n = doc.units.length;
  const total = timeAt(n), at = timeAt(clamp(P.i, 0, n));
  el.tElapsed.textContent = fmtTime(at);
  el.tLeft.textContent = `−${fmtTime(total - at)}`;
  if (!scrubbing) { el.scrub.value = P.i; fillRange(el.scrub); }
}

/* ============================================================
   Rendering + highlighting
   ============================================================ */
function renderDoc() {
  el.doc.textContent = '';
  const frag = document.createDocumentFragment();
  for (const p of doc.paras) {
    const pe = document.createElement('p');
    if (p.head) pe.className = 'h';
    p.el = pe;
    p.units.forEach((u, k) => {
      const s = document.createElement('span');
      s.className = 'u';
      s.dataset.i = u.i;
      s.textContent = u.text;
      u.el = s;
      pe.append(s);
      if (k < p.units.length - 1) pe.append(' ');
    });
    frag.append(pe);
  }
  el.doc.append(frag);
  el.scrub.max = Math.max(0, doc.units.length - 1);
  computeTimes();
}

let activeI = -1;
function wordsOf(u) {
  if (u.words) return u.words;
  const words = [];
  u.el.textContent = '';
  const re = /\S+/g;
  let m, last = 0;
  while ((m = re.exec(u.text))) {
    if (m.index > last) u.el.append(u.text.slice(last, m.index));
    const w = document.createElement('span');
    w.className = 'w';
    w.textContent = m[0];
    u.el.append(w);
    words.push({ start: m.index, end: m.index + m[0].length, el: w });
    last = m.index + m[0].length;
  }
  if (last < u.text.length) u.el.append(u.text.slice(last));
  u.words = words;
  return words;
}
function unwrapWords(u) { if (u && u.words) { u.el.textContent = u.text; u.words = null; } }

function setActive(i, { scroll = true, force = false } = {}) {
  if (!doc || !doc.units[i]) return;
  if (activeI === i) { if (force) ensureVisible(doc.units[i].el, true); return; }
  const prev = activeI >= 0 ? doc.units[activeI] : null;
  if (prev) { prev.el.classList.remove('active'); unwrapWords(prev); }
  const u = doc.units[i];
  if (!prev) doc.units.forEach((x) => x.el.classList.toggle('done', x.i < i));
  else {
    const a = Math.min(activeI, i), b = Math.max(activeI, i);
    for (let k = a; k <= b; k++) doc.units[k].el.classList.toggle('done', k < i);
  }
  if (!prev || prev.p !== u.p) {
    if (prev) doc.paras[prev.p].el.classList.remove('cur');
    doc.paras[u.p].el.classList.add('cur');
  }
  activeI = i;
  u.el.classList.add('active');
  P.wordIdx = -1;
  hideMarker();
  updateProgress();
  if (scroll) ensureVisible(u.el, force);
}

function hideMarker() { el.marker.style.opacity = '0'; }
function placeMarker(w) {
  const wrap = el.docWrap.getBoundingClientRect();
  const rects = w.getClientRects(); // a hyphenated word can span two lines: highlight its first part
  const r = rects.length ? rects[0] : w.getBoundingClientRect();
  const px = Math.max(2, S.fontSize * 0.14), py = Math.max(1, S.fontSize * 0.04);
  el.marker.style.transform = `translate(${r.left - wrap.left - px}px, ${r.top - wrap.top - py}px)`;
  el.marker.style.width = `${r.width + px * 2}px`;
  el.marker.style.height = `${r.height + py * 2}px`;
  el.marker.style.opacity = '1';
  return r;
}
function highlightChar(ch) {
  const u = doc && doc.units[activeI];
  if (!u || !S.hlWord) return;
  const words = wordsOf(u);
  if (!words.length) return;
  let k = words.findIndex((w) => w.end > ch);
  if (k < 0) k = words.length - 1;
  if (k === P.wordIdx) return;
  P.wordIdx = k;
  const r = placeMarker(words[k].el);
  if (S.autoScroll) {
    const bottom = innerHeight - playerHeight() - 24;
    if (r.bottom > bottom || r.top < topHeight() + 8) ensureVisible(words[k].el);
  }
}
function refreshMarker() {
  const u = doc && doc.units[activeI];
  if (u && u.words && P.wordIdx >= 0 && S.hlWord && u.words[P.wordIdx]) placeMarker(u.words[P.wordIdx].el);
  else hideMarker();
}

/* scrolling */
let userScrollAt = 0;
const topHeight = () => (el.readerTop ? el.readerTop.offsetHeight : 56);
const playerHeight = () => (el.player.hidden ? 0 : el.player.offsetHeight + (innerWidth >= 820 ? 16 : 0));
function ensureVisible(node, force = false) {
  if (!node || (!force && !S.autoScroll)) return;
  if (!force && Date.now() - userScrollAt < 5000) { updateReturnPill(); return; }
  const r = node.getBoundingClientRect();
  const top = topHeight() + 12;
  const bottom = innerHeight - playerHeight() - 16;
  const band = Math.max(80, bottom - top);
  if (force || r.top < top || r.bottom > top + band * 0.78) {
    const target = scrollY + r.top - (top + band * 0.22);
    window.scrollTo({ top: Math.max(0, target), behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  }
  el.returnPill.hidden = true;
}
function updateReturnPill() {
  if (!doc || el.reader.hidden || editing || activeI < 0 || P.state === 'idle') { el.returnPill.hidden = true; return; }
  const r = doc.units[activeI].el.getBoundingClientRect();
  const off = r.bottom < topHeight() || r.top > innerHeight - playerHeight();
  el.returnPill.hidden = !off;
}
['wheel', 'touchmove'].forEach((ev) => addEventListener(ev, () => { userScrollAt = Date.now(); }, { passive: true }));
let scrollRaf = 0;
addEventListener('scroll', () => {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    $$('.topbar').forEach((t) => t.classList.toggle('scrolled', scrollY > 4));
    updateReturnPill();
  });
}, { passive: true });

/* ============================================================
   System voices (Web Speech API)
   ============================================================ */
const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Junior|Ralph|Kathy|Fred|Deranged|Hysterical|Pipe Organ|Princess)\b/i;
const ELOQ = /^(Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley)\b/i;
const FEM = new Set('amélie amelie audrey aurélie aurelie marie virginie julie hortense denise eloise éloise vivienne brigitte céline celine coralie jacqueline joséphine josephine yvette ariane charline sylvie caroline léa lea chantal anna petra helena katja amala elke gisela klarissa louisa maja tanja ingrid leni seraphina hedda marlene samantha karen moira tessa fiona victoria allison ava susan serena kate zoe zira hazel aria jenny michelle emma sonia libby natasha clara joanna salli kimberly ivy kendra nicky martha catherine veena sara nancy jane ashley cora elizabeth monica amy emily isabella maisie neerja leah molly alice ellen nora lisa'.split(' '));
const MAL = new Set('thomas daniel nicolas jacques henri remy rémy paul alain claude jérôme jerome yves maurice fabrice gerard gérard antoine jean thierry louis pierre markus yannick viktor conrad killian bernd christoph kasper klaus ralf florian jonas jan stefan alex tom aaron arthur gordon lee rishi oliver albert guy christopher eric roger steffan andrew brian davis jason tony ryan george david mark james liam william connor mitchell prabhat ravi sam matthew joey justin kevin'.split(' '));

const Sys = {
  supported: 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window,
  voices: [],
  token: 0,
  current: null,
  keepAlive: 0,
  init() {
    if (!this.supported) return;
    const load = () => {
      const v = speechSynthesis.getVoices();
      if (v.length === this.voices.length) return;
      this.voices = v;
      onVoicesChanged();
    };
    load();
    speechSynthesis.onvoiceschanged = load;
    setTimeout(load, 400); setTimeout(load, 1500); setTimeout(load, 4000);
  },
  speak(unit, offset, cb, opts = {}) {
    const token = ++this.token;
    this.clearKeepAlive();
    const busy = speechSynthesis.speaking || speechSynthesis.pending;
    if (busy) speechSynthesis.cancel();
    const text = unit.text.slice(offset);
    if (!text.trim()) { setTimeout(() => token === this.token && cb.onEnd(), 0); return; }
    const u = new SpeechSynthesisUtterance(text);
    const lang = effLang();
    const v = opts.voice || currentSysVoice(lang);
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = LANGS[lang].tag;
    u.rate = clamp(S.rate, 0.1, 10);
    u.pitch = clamp(Math.pow(2, S.pitch / 12), 0, 2);
    u.volume = S.volume;
    u.onstart = () => { if (token === this.token) cb.onStart(); };
    u.onboundary = (e) => {
      if (token !== this.token) return;
      if (e.name && e.name !== 'word') return;
      cb.onWord(offset + (e.charIndex || 0));
    };
    u.onend = () => { if (token !== this.token) return; this.current = null; this.clearKeepAlive(); cb.onEnd(); };
    u.onerror = (e) => {
      if (token !== this.token) return;
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      this.current = null; this.clearKeepAlive();
      cb.onError(e.error || 'synthèse');
    };
    this.current = u; // keeps a reference (Chrome drops events of collected utterances)
    const go = () => {
      if (token !== this.token) return;
      speechSynthesis.speak(u);
      if (speechSynthesis.paused) speechSynthesis.resume();
    };
    // Chrome sometimes drops an utterance queued right after cancel(); the very first one must stay synchronous for iOS.
    if (busy) setTimeout(go, 60); else go();
    // Chrome cuts long utterances of online voices after ~15 s: keep them alive.
    if (isChrome && !isAndroid && v && !v.localService) {
      this.keepAlive = setInterval(() => {
        if (token !== this.token) return this.clearKeepAlive();
        if (speechSynthesis.speaking) { speechSynthesis.pause(); speechSynthesis.resume(); }
      }, 9000);
    }
  },
  clearKeepAlive() { if (this.keepAlive) { clearInterval(this.keepAlive); this.keepAlive = 0; } },
  stop() {
    this.token++;
    this.clearKeepAlive();
    if (this.supported && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
    this.current = null;
  },
};

const normLang = (l) => String(l || '').toLowerCase().replace('_', '-');
const prettyLang = (l) => { const [a, b] = normLang(l).split('-'); return b ? `${a}-${b.toUpperCase()}` : a; };
function voiceScore(v) {
  const n = v.name, uri = v.voiceURI || '';
  let s = 0;
  if (/Natural/i.test(n)) s += 100; else if (/Online/i.test(n)) s += 45;
  if (/premium/i.test(uri) || /Premium/i.test(n)) s += 90;
  else if (/enhanced/i.test(uri) || /Enhanced|Améliorée|Amélioré|Erweitert/i.test(n)) s += 70;
  if (/siri/i.test(uri + n)) s += 60;
  if (/^Google/i.test(n)) s += 50;
  if (/network/i.test(uri)) s += 30;
  if (ELOQ.test(n)) s -= 60;
  if (/compact/i.test(uri)) s -= 5;
  if (v.default) s += 2;
  return s;
}
const voiceTier = (v) => { const s = voiceScore(v); return s >= 70 ? 'Naturelle' : s >= 40 ? 'Correcte' : 'Basique'; };
function voiceGender(v) {
  const n = v.name.toLowerCase();
  if (/\bfemale\b|\bfemme\b|weiblich/.test(n)) return 'F';
  if (/\bmale\b|\bhomme\b|männlich/.test(n)) return 'M';
  const words = n.replace(/\s+-\s+.*$/, ' ').replace(/\(.*?\)/g, ' ').replace(/microsoft|google|apple|online|natural/g, ' ').split(/[^a-zà-ÿ]+/).filter(Boolean);
  for (const w of words) { if (FEM.has(w)) return 'F'; if (MAL.has(w)) return 'M'; }
  return '';
}
function shortVoiceName(v) {
  if (/^Google/i.test(v.name)) return v.name;
  return v.name.replace(/^Microsoft\s+/i, '').replace(/\s+Online.*$/i, '').replace(/\s+-\s+.*$/, '').replace(/\s*\(.*?\)\s*/g, ' ').trim() || v.name;
}
function sysVoicesFor(lang) {
  return Sys.voices
    .filter((v) => normLang(v.lang).startsWith(lang) && !NOVELTY.test(v.name) && (S.showAll || !ELOQ.test(v.name)))
    .sort((a, b) => voiceScore(b) - voiceScore(a) || a.name.localeCompare(b.name));
}
function currentSysVoice(lang) {
  const list = sysVoicesFor(lang);
  if (!list.length) return null;
  const chosen = S.sysVoice[lang] && Sys.voices.find((v) => v.voiceURI === S.sysVoice[lang]);
  if (chosen) return chosen;
  if (S.gender !== 'all') { const g = list.find((v) => voiceGender(v) === S.gender); if (g) return g; }
  return list[0];
}

/* ============================================================
   Local AI voices (Piper via ONNX Runtime, in a Worker)
   ============================================================ */
function piperParse(key) {
  const [id, speaker] = String(key).split('#');
  const parts = id.split('-');
  const code = parts[0], quality = parts[parts.length - 1], name = parts.slice(1, -1).join('-');
  const url = `${PIPER_HF}${code.split('_')[0]}/${code}/${name}/${quality}/${id}.onnx`;
  return { id, speaker: speaker || null, url, quality };
}
const piperInfo = (key) => {
  for (const l of Object.keys(PIPER_VOICES)) { const v = PIPER_VOICES[l].find((x) => x.key === key); if (v) return v; }
  return { key, label: key, g: '' };
};
const piperSize = (q) => (q === 'x_low' ? '≈ 20 Mo' : q === 'high' ? '≈ 110 Mo' : '≈ 60 Mo');

const PiperMgr = {
  w: null, seq: 1, gen: 0,
  pend: new Map(), cache: new Map(),
  cached: new Set(), loadedNow: new Set(), progress: new Map(),
  fatal: null,
  worker() {
    if (this.w) return this.w;
    try {
      this.w = new Worker('piper-worker.js');
    } catch (err) {
      this.fail(`Le moteur IA ne peut pas démarrer ici (${err.message}).`);
      return null;
    }
    this.w.onmessage = (e) => this.onMsg(e.data);
    this.w.onerror = (e) => { e.preventDefault && e.preventDefault(); this.fail('Le moteur IA a planté. Recharge la page pour réessayer.'); };
    return this.w;
  },
  fail(msg) {
    this.fatal = msg;
    for (const [, p] of this.pend) { this.cache.delete(p.k); p.rej(new Error(msg)); }
    this.pend.clear();
    if (this.w) { try { this.w.terminate(); } catch (e) { /* ignore */ } }
    this.w = null;
  },
  voiceKey() { return S.piperVoice[effLang()] || PIPER_VOICES[effLang()][0].key; },
  key(i, vk) { return `${vk}|${S.noiseScale}|${S.noiseW}|${i}`; },
  request(indices, vk) {
    const items = [];
    for (const i of indices) {
      const k = this.key(i, vk);
      if (this.cache.has(k)) continue;
      const id = this.seq++;
      let res, rej;
      const pr = new Promise((a, b) => { res = a; rej = b; });
      pr.catch(() => {});
      this.cache.set(k, pr);
      this.pend.set(id, { res, rej, k });
      items.push({ id, text: doc.units[i].text });
    }
    if (!items.length) return;
    const w = this.worker();
    if (!w) return;
    const v = piperParse(vk);
    if (!this.isCached(v.id) && !this.progress.has(v.id)) {
      this.progress.set(v.id, null);
      toast(`Téléchargement de la voix ${piperInfo(vk).label} (${piperSize(v.quality)}, une seule fois)…`, 4500);
      refreshVoiceUI();
    }
    w.postMessage({ type: 'synth', gen: this.gen, voiceId: v.id, url: v.url, speaker: v.speaker, noiseScale: S.noiseScale, noiseW: S.noiseW, items });
  },
  get(i) {
    const vk = this.voiceKey();
    this.request([i, i + 1, i + 2, i + 3].filter((k) => k < doc.units.length), vk);
    this.evict(i);
    return this.cache.get(this.key(i, vk)) || Promise.reject(new Error(this.fatal || 'moteur IA indisponible'));
  },
  prefetch(i) { if (doc && i < doc.units.length) this.request([i, i + 1, i + 2].filter((k) => k < doc.units.length), this.voiceKey()); },
  cancel() {
    this.gen++;
    if (this.w) this.w.postMessage({ type: 'cancel', gen: this.gen });
    for (const [, p] of this.pend) { this.cache.delete(p.k); p.rej(CANCELLED); }
    this.pend.clear();
  },
  clear() { this.cache.clear(); },
  evict(center) {
    if (this.cache.size < 90) return;
    for (const k of [...this.cache.keys()]) {
      const i = +k.split('|').pop();
      if (Math.abs(i - center) > 30 && ![...this.pend.values()].some((p) => p.k === k)) this.cache.delete(k);
    }
  },
  download(vk) {
    const v = piperParse(vk);
    if (this.progress.has(v.id) || this.isCached(v.id)) return;
    const w = this.worker();
    if (!w) return;
    this.progress.set(v.id, null);
    w.postMessage({ type: 'load', voiceId: v.id, url: v.url });
    refreshVoiceUI();
  },
  async refreshCached() {
    try {
      const c = await caches.open(VOICE_CACHE);
      const keys = await c.keys();
      this.cached = new Set(keys.map((r) => r.url).filter((u) => u.endsWith('.onnx')));
    } catch (e) { /* Cache API unavailable */ }
  },
  isCached(id) { const u = piperParse(id).url; return this.cached.has(u) || this.loadedNow.has(u); },
  async remove(id) {
    const url = piperParse(id).url;
    try { const c = await caches.open(VOICE_CACHE); await c.delete(url); await c.delete(`${url}.json`); } catch (e) { /* ignore */ }
    this.loadedNow.delete(url);
    if (this.w) this.w.postMessage({ type: 'unload', url });
    for (const k of [...this.cache.keys()]) if (k.startsWith(id)) this.cache.delete(k);
    await this.refreshCached();
  },
  onMsg(m) {
    if (m.type === 'progress') {
      this.progress.set(m.voiceId, m.total ? m.loaded / m.total : null);
      updateDownloadUI(m.voiceId);
    } else if (m.type === 'loaded') {
      const had = this.progress.has(m.voiceId);
      this.progress.delete(m.voiceId);
      this.loadedNow.add(piperParse(m.voiceId).url);
      if (had) refreshVoiceUI();
    } else if (m.type === 'result') {
      const p = this.pend.get(m.id);
      if (!p) return;
      this.pend.delete(m.id);
      p.res(m.empty ? null : preparePCM(m.pcm, m.sr));
    } else if (m.type === 'error') {
      if (m.voiceId) this.progress.delete(m.voiceId);
      const err = new Error(m.message || 'erreur');
      for (const id of m.ids || []) { const p = this.pend.get(id); if (p) { this.pend.delete(id); this.cache.delete(p.k); p.rej(err); } }
      if (m.kind === 'load') toast(`Téléchargement impossible : ${m.message}`, 5000);
      refreshVoiceUI();
    }
  },
};

function preparePCM(pcm, sr) {
  const n = pcm.length;
  const i16 = new Int16Array(n);
  for (let k = 0; k < n; k++) { const s = pcm[k] < -1 ? -1 : pcm[k] > 1 ? 1 : pcm[k]; i16[k] = s < 0 ? s * 0x8000 : s * 0x7fff; }
  const thr = 0.012;
  let a = 0, b = n - 1;
  while (a < n && Math.abs(pcm[a]) < thr) a++;
  while (b > a && Math.abs(pcm[b]) < thr) b--;
  if (a >= n) { a = 0; b = n - 1; }
  return { i16, sr, n, tStart: a / sr, tEnd: Math.max(a + 1, b) / sr };
}
function wavURL(e, pf) {
  const rate = Math.round(e.sr * pf);
  const h = new ArrayBuffer(44), v = new DataView(h);
  const w = (o, s) => { for (let k = 0; k < 4; k++) v.setUint8(o + k, s.charCodeAt(k)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + e.n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, e.n * 2, true);
  return URL.createObjectURL(new Blob([h, e.i16.buffer], { type: 'audio/wav' }));
}
function unitWeights(u) {
  if (u.wcum) return u;
  const re = /\S+/g, starts = [], cum = [0];
  let m, t = 0;
  while ((m = re.exec(u.text))) {
    starts.push(m.index);
    t += m[0].length + 1 + (/[.,;:!?…»"”)]$/.test(m[0]) ? 4 : 0);
    cum.push(t);
  }
  u.wstarts = starts.length ? starts : [0];
  u.wcum = cum.map((x) => x / (t || 1));
  return u;
}
function charForFrac(u, f) {
  unitWeights(u);
  let k = 0;
  while (k < u.wstarts.length - 1 && u.wcum[k + 1] <= f) k++;
  return u.wstarts[k];
}
function fracForChar(u, ch) {
  unitWeights(u);
  let k = 0;
  while (k < u.wstarts.length - 1 && u.wstarts[k + 1] <= ch) k++;
  return u.wcum[k] || 0;
}
function setPreservesPitch(a) { a.preservesPitch = true; a.mozPreservesPitch = true; a.webkitPreservesPitch = true; }

const Pi = {
  token: 0, url: null, entry: null, pf: 1, unit: null, cb: null, raf: 0,
  speak(unit, offset, cb) {
    this.stopAudio();
    const token = ++this.token;
    this.unit = unit; this.cb = cb; this.entry = null;
    const pr = PiperMgr.get(unit.i);
    let ready = false;
    pr.then(() => { ready = true; }, () => { ready = true; });
    setTimeout(() => { if (!ready && token === this.token) cb.onLoading(); }, 0);
    pr.then((entry) => {
      if (token !== this.token) return;
      if (!entry) { cb.onEnd(); return; }
      this.entry = entry;
      this.start(token, offset ? fracForChar(unit, offset) : 0);
    }, (err) => {
      if (token !== this.token || err === CANCELLED) return;
      cb.onError(`ia:${(err && err.message) || err}`);
    });
  },
  start(token, frac) {
    const e = this.entry, a = el.audio;
    const pf = Math.pow(2, S.pitch / 12);
    this.pf = pf;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = wavURL(e, pf);
    a.onended = () => { if (token === this.token) { cancelAnimationFrame(this.raf); this.cb.onEnd(); } };
    a.onerror = () => { if (token === this.token) this.cb.onError('audio'); };
    a.src = this.url;
    setPreservesPitch(a);
    const rate = clamp(S.rate / pf, 0.25, 4);
    a.defaultPlaybackRate = rate;
    a.volume = S.volume;
    const seekT = frac > 0 ? (e.tStart + frac * (e.tEnd - e.tStart)) / pf : 0;
    const go = () => {
      if (token !== this.token) return;
      if (seekT > 0) { try { a.currentTime = seekT; } catch (err) { /* ignore */ } }
      a.playbackRate = rate;
      const p = a.play();
      const ok = () => { if (token === this.token) { this.cb.onStart(); this.loop(token); } };
      if (p && p.then) p.then(ok, (err) => { if (token === this.token) this.cb.onError(err && err.name === 'NotAllowedError' ? 'blocked' : 'audio'); });
      else ok();
    };
    if (a.readyState >= 1) go(); else a.addEventListener('loadedmetadata', go, { once: true });
  },
  loop(token) {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      if (token !== this.token) return;
      const e = this.entry, a = el.audio;
      const t = a.currentTime * this.pf;
      const f = clamp((t - e.tStart) / Math.max(0.05, e.tEnd - e.tStart), 0, 0.9999);
      this.cb.onWord(charForFrac(this.unit, f));
      if (!a.paused && !a.ended) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  },
  liveRate() {
    if (!this.entry) return;
    el.audio.playbackRate = clamp(S.rate / this.pf, 0.25, 4);
    el.audio.defaultPlaybackRate = el.audio.playbackRate;
    el.audio.volume = S.volume;
  },
  livePitch() {
    if (!this.entry || el.audio.paused) return;
    const e = this.entry;
    const f = clamp((el.audio.currentTime * this.pf - e.tStart) / Math.max(0.05, e.tEnd - e.tStart), 0, 0.999);
    this.stopAudio();
    this.start(this.token, f);
  },
  stopAudio() {
    cancelAnimationFrame(this.raf);
    el.audio.onended = null;
    el.audio.onerror = null;
    try { el.audio.pause(); } catch (e) { /* ignore */ }
  },
  stop() { this.token++; this.stopAudio(); },
};

/* iOS only lets audio start inside a tap: unlock the element on the first press */
const SILENT_WAV = 'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';
let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  try {
    el.audio.src = SILENT_WAV;
    const p = el.audio.play();
    if (p && p.catch) p.catch(() => { audioUnlocked = false; });
  } catch (e) { audioUnlocked = false; }
}

const engine = () => (S.engine === 'piper' || !Sys.supported ? Pi : Sys);

/* ============================================================
   Player
   ============================================================ */
const P = { i: 0, state: 'idle', resume: 0, wordCh: 0, wordIdx: -1, timer: 0, ended: false };
const isPlaying = () => P.state === 'playing' || P.state === 'loading';

function play() {
  if (!doc || !doc.units.length) return;
  if (engine() === Pi) unlockAudio();
  if (P.ended) { P.ended = false; P.resume = 0; P.i = 0; }
  P.state = 'loading';
  updatePlayUI();
  startUnit(P.i, P.resume);
  acquireWake();
}
function pause() {
  if (!isPlaying()) return;
  clearTimeout(P.timer);
  Sys.stop(); Pi.stop();
  P.resume = P.wordCh;
  P.state = 'paused';
  updatePlayUI();
  releaseWake();
}
const toggle = () => (isPlaying() ? pause() : play());

function stopAll() {
  clearTimeout(P.timer);
  Sys.stop(); Pi.stop(); PiperMgr.cancel();
  P.state = 'idle'; P.resume = 0; P.wordCh = 0; P.ended = false;
  releaseWake();
}

function goTo(i, autoplay) {
  if (!doc) return;
  i = clamp(i, 0, doc.units.length - 1);
  const was = isPlaying();
  clearTimeout(P.timer);
  Sys.stop(); Pi.stop();
  if (S.engine === 'piper') PiperMgr.cancel();
  P.i = i; P.resume = 0; P.wordCh = 0; P.ended = false;
  setActive(i, { force: true });
  if (autoplay ?? was) {
    if (engine() === Pi) unlockAudio();
    P.state = 'loading';
    updatePlayUI();
    startUnit(i, 0);
    acquireWake();
  } else {
    if (P.state !== 'idle') P.state = 'paused';
    updatePlayUI();
  }
}

function startUnit(i, offset) {
  if (!doc) return;
  P.i = i; P.wordCh = offset;
  setActive(i);
  const u = doc.units[i];
  const eng = engine();
  eng.speak(u, offset, {
    onLoading() { if (isPlaying()) { P.state = 'loading'; updatePlayUI(); } },
    onStart() { if (!isPlaying()) return; P.state = 'playing'; updatePlayUI(); },
    onWord(ch) { P.wordCh = ch; highlightChar(ch); },
    onEnd() {
      P.resume = 0; P.wordCh = 0;
      if (i >= doc.units.length - 1) { finished(); return; }
      const delay = u.paraEnd ? S.pauseParagraph : u.chunk ? Math.round(S.pauseSentence * 0.3) : S.pauseSentence;
      P.i = i + 1;
      setActive(i + 1);
      if (eng === Pi) PiperMgr.prefetch(i + 1);
      P.timer = setTimeout(() => { if (isPlaying()) startUnit(i + 1, 0); }, delay);
    },
    onError(msg) { engineError(msg); },
  });
  updateMedia();
}

function finished() {
  P.state = 'idle'; P.ended = true; P.resume = 0;
  hideMarker();
  if (doc) { doc.units.forEach((x) => x.el.classList.add('done')); }
  updatePlayUI();
  releaseWake();
}

function engineError(msg) {
  pause();
  if (msg === 'blocked') { toast('Appuie sur lecture pour démarrer la voix.'); return; }
  if (String(msg).startsWith('ia:')) {
    const detail = String(msg).slice(3);
    toast(`La voix IA n’a pas pu lire ce passage (${detail}). Essaie une autre voix ou les voix de l’appareil.`, 6000);
    return;
  }
  if (msg === 'not-allowed') { toast('Appuie sur lecture pour démarrer la voix.'); return; }
  toast(`La voix de l’appareil s’est arrêtée (${msg}).`);
}

function nextSentence() { if (doc) goTo(P.i + 1); }
function prevSentence() {
  if (!doc) return;
  if (isPlaying() && P.wordCh > 14) goTo(P.i); else goTo(P.i - 1);
}
function nextPara() {
  if (!doc) return;
  const p = doc.units[P.i].p;
  if (p < doc.paras.length - 1) goTo(doc.paras[p + 1].units[0].i);
}
function prevPara() {
  if (!doc) return;
  const p = doc.units[P.i].p;
  const first = doc.paras[p].units[0].i;
  if (P.i > first || (isPlaying() && P.wordCh > 14)) goTo(first);
  else if (p > 0) goTo(doc.paras[p - 1].units[0].i);
  else goTo(0);
}
function setRate(r) {
  setSetting('rate', Math.round(clamp(r, 0.5, 3) * 100) / 100);
  syncSheetValues();
}

/* live changes while reading */
let restartKind = '';
const restartHere = debounce(() => {
  if (!isPlaying() || !doc) return;
  clearTimeout(P.timer);
  Sys.stop(); Pi.stop();
  if (restartKind === 'model') { PiperMgr.cancel(); PiperMgr.clear(); }
  restartKind = '';
  startUnit(P.i, P.wordCh);
}, 280);
const livePitchDeb = debounce(() => Pi.livePitch(), 160);
function onVoiceSetting(kind) {
  updatePills();
  if (kind === 'rate') updateProgress();
  const modelChange = kind === 'voice' || kind === 'noise' || kind === 'engine';
  if (kind === 'engine' && S.engine === 'piper') unlockAudio(); // still inside the tap (iOS)
  if (!isPlaying()) {
    if (modelChange) { PiperMgr.cancel(); PiperMgr.clear(); }
    return;
  }
  if (engine() === Pi && !modelChange) {
    if (kind === 'rate' || kind === 'volume') { Pi.liveRate(); return; }
    if (kind === 'pitch') { livePitchDeb(); return; }
  }
  if (modelChange) restartKind = 'model';
  restartHere();
}

/* ============================================================
   Player UI
   ============================================================ */
const ICON = (id) => `<svg class="i" aria-hidden="true"><use href="#i-${id}"/></svg>`;
function updatePlayUI() {
  const b = el.playBtn;
  const playing = isPlaying();
  b.innerHTML = (playing ? ICON('pause') : ICON('play')) + (P.state === 'loading' ? '<span class="spin"></span>' : '');
  b.setAttribute('aria-label', playing ? 'Pause' : 'Lecture');
  updateMedia();
  updateReturnPill();
}
function voiceLabel() {
  const lang = effLang();
  if (engine() === Pi) {
    const vk = PiperMgr.voiceKey();
    const id = piperParse(vk).id;
    const pr = PiperMgr.progress.get(id);
    if (PiperMgr.progress.has(id)) return pr == null ? 'Téléchargement…' : `Téléchargement ${Math.round(pr * 100)} %`;
    return piperInfo(vk).label;
  }
  const v = currentSysVoice(lang);
  return v ? shortVoiceName(v) : 'Voix';
}
function updatePills() {
  el.speedPill.textContent = `${fmtNum(S.rate)}×`;
  el.voiceLbl.textContent = voiceLabel();
}

/* ============================================================
   Media Session + wake lock
   ============================================================ */
function setupMedia() {
  if (!('mediaSession' in navigator)) return;
  const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) { /* unsupported */ } };
  h('play', () => play());
  h('pause', () => pause());
  h('stop', () => pause());
  h('previoustrack', () => prevSentence());
  h('nexttrack', () => nextSentence());
  h('seekbackward', () => prevSentence());
  h('seekforward', () => nextSentence());
}
function updateMedia() {
  if (!('mediaSession' in navigator) || !doc) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: doc.title, artist: 'PocketRead', album: `Phrase ${P.i + 1} sur ${doc.units.length}`,
      artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
    navigator.mediaSession.playbackState = isPlaying() ? 'playing' : 'paused';
  } catch (e) { /* ignore */ }
}
let wake = null;
async function acquireWake() {
  if (!S.wakeLock || !('wakeLock' in navigator) || wake) return;
  try { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } catch (e) { wake = null; }
}
function releaseWake() { try { if (wake) wake.release(); } catch (e) { /* ignore */ } wake = null; }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (isPlaying()) acquireWake();
  // iOS may silently drop speech while in background: resume where we were.
  if (isPlaying() && engine() === Sys && Sys.supported && !speechSynthesis.speaking && !speechSynthesis.pending && P.state === 'playing') {
    startUnit(P.i, P.wordCh);
  }
});
addEventListener('pagehide', () => { Sys.stop(); });

/* ============================================================
   Import: files, PDF, images (OCR), clipboard
   ============================================================ */
let cancelImport = false;
const isPDF = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
const isImage = (f) => (f.type || '').startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic|heif|avif)$/i.test(f.name || '');
const isText = (f) => (f.type || '').startsWith('text/') || /\.(txt|md|markdown)$/i.test(f.name || '');
const weakTitle = (t) => !t || /^(img|image|capture|screenshot|bildschirmfoto|scan|photo|presse-papiers|clipboard|pasted|document)[\s_\-\d]*/i.test(t);

async function importFiles(list) {
  const files = [...list].filter(Boolean);
  if (!files.length) return;
  cancelImport = false;
  showBusy('Préparation…');
  const parts = [];
  let title = '';
  try {
    for (let k = 0; k < files.length; k++) {
      const f = files[k];
      const tag = files.length > 1 ? ` (${k + 1}/${files.length})` : '';
      if (!title && f.name) title = f.name.replace(/\.[^.]+$/, '');
      if (isPDF(f)) {
        const r = await readPDF(f, tag);
        if (r.title && weakTitle(title)) title = r.title;
        parts.push(...r.pages);
      } else if (isImage(f)) parts.push(await ocrImage(f, `Reconnaissance du texte${tag}`));
      else if (isText(f)) parts.push(await f.text());
      else toast(`Format non pris en charge : ${f.name || 'fichier'}`);
      if (cancelImport) throw CANCELLED;
    }
  } catch (err) {
    hideBusy();
    if (err !== CANCELLED && !cancelImport) { console.error(err); toast((err && err.message) || 'Impossible de lire ce fichier.', 5000); }
    return;
  }
  hideBusy();
  const paras = cleanText(parts.filter(Boolean).join('\n\n'));
  if (!paras.length) { toast('Aucun texte trouvé. Essaie une image plus nette, ou recadre sur le texte.', 5000); return; }
  openDoc(paras, weakTitle(title) ? '' : title);
}

async function readPDF(file, tag) {
  setBusy(`Ouverture du PDF${tag}`, '', null);
  await loadScript(LIBS.pdf);
  const lib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
  if (!lib) throw new Error('Le lecteur PDF n’a pas pu se charger.');
  lib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
  const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  let title = '';
  try { const meta = await pdf.getMetadata(); title = (meta && meta.info && meta.info.Title) || ''; } catch (e) { /* none */ }
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    if (cancelImport) throw CANCELLED;
    setBusy(`Lecture du PDF${tag}`, `Page ${n} sur ${pdf.numPages}`, (n - 1) / pdf.numPages);
    const page = await pdf.getPage(n);
    let text = pageText(await page.getTextContent());
    if (text.replace(/\s/g, '').length < 25) {
      const canvas = await renderPage(page);
      text = await ocrCanvas(canvas, `Reconnaissance du PDF${tag}`, `Page scannée ${n} sur ${pdf.numPages}`, n - 1, pdf.numPages);
    }
    pages.push(text);
    page.cleanup();
  }
  await pdf.destroy();
  return { pages: stripRunningLines(pages), title: title.trim() };
}
function pageText(tc) {
  let out = '', lastY = null, lastH = 0, lastEnd = null;
  for (const it of tc.items) {
    if (!('str' in it)) continue;
    const x = it.transform[4], y = it.transform[5];
    const h = Math.abs(it.transform[3]) || it.height || 10;
    if (lastY !== null) {
      const dy = Math.abs(y - lastY), lh = Math.max(lastH, h);
      if (dy > lh * 1.9) out += '\n\n';
      else if (dy > lh * 0.45) out += '\n';
      else if (lastEnd !== null && x - lastEnd > h * 0.12 && !/\s$/.test(out) && !/^\s/.test(it.str)) out += ' ';
    }
    out += it.str;
    if (it.str.trim()) { lastY = y; lastH = h; lastEnd = x + (it.width || 0); }
  }
  return out;
}
function stripRunningLines(pages) {
  if (pages.length < 3) return pages;
  const norm = (l) => l.trim().toLowerCase().replace(/\d+/g, '#');
  const count = new Map();
  for (const p of pages) {
    const ls = p.split('\n').map((s) => s.trim()).filter(Boolean);
    new Set([ls[0], ls[1], ls[ls.length - 1], ls[ls.length - 2]].filter(Boolean).map(norm)).forEach((k) => count.set(k, (count.get(k) || 0) + 1));
  }
  const bad = new Set([...count].filter(([k, c]) => c >= Math.max(3, pages.length * 0.5) && k.length < 140).map(([k]) => k));
  if (!bad.size) return pages;
  return pages.map((p) => p.split('\n').filter((l) => !bad.has(norm(l))).join('\n'));
}
async function renderPage(page) {
  const base = page.getViewport({ scale: 1 });
  const scale = clamp(2000 / base.width, 1.5, 3);
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return c;
}

let tess = null, tessLangs = '', tessProgress = null;
const OCR_STATUS = {
  'loading tesseract core': 'Chargement du moteur de reconnaissance…',
  'initializing tesseract': 'Initialisation…',
  'initialized tesseract': 'Initialisation…',
  'loading language traineddata': 'Chargement des langues (seulement la première fois)…',
  'loaded language traineddata': 'Langues prêtes',
  'initializing api': 'Initialisation…',
};
async function getTess() {
  const langs = (S.ocrLangs.length ? S.ocrLangs : ['fra']).slice();
  const key = langs.join('+');
  if (tess && tessLangs === key) return tess;
  if (tess) { try { await tess.terminate(); } catch (e) { /* ignore */ } tess = null; }
  await loadScript(LIBS.tesseract);
  tess = await window.Tesseract.createWorker(langs, 1, { logger: (m) => tessProgress && tessProgress(m) });
  tessLangs = key;
  return tess;
}
async function ocrCanvas(canvas, title, sub, k = 0, n = 1) {
  tessProgress = (m) => {
    if (m.status === 'recognizing text') setBusy(title, sub || 'Lecture du texte de l’image…', (k + (m.progress || 0)) / n);
    else setBusy(title, OCR_STATUS[m.status] || 'Préparation…', null);
  };
  try {
    const w = await getTess();
    if (cancelImport) throw CANCELLED;
    const { data } = await w.recognize(canvas);
    return (data && data.text) || '';
  } finally { tessProgress = null; }
}
async function loadBitmap(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* fallback below */ }
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { res(img); setTimeout(() => URL.revokeObjectURL(url), 2000); };
    img.onerror = () => rej(new Error('Cette image ne peut pas être ouverte par le navigateur (essaie en PNG ou JPEG).'));
    img.src = url;
  });
}
async function prepareImage(file) {
  const bmp = await loadBitmap(file);
  const w = bmp.width, h = bmp.height, long = Math.max(w, h);
  let scale = long < 1800 ? Math.min(2.5, 2200 / long) : 1;
  if (long * scale > 4000) scale = 4000 / long;
  if (w * h * scale * scale > 16e6) scale = Math.sqrt(16e6 / (w * h));
  const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(bmp, 0, 0, cw, ch);
  if (bmp.close) bmp.close();
  const img = ctx.getImageData(0, 0, cw, ch), d = img.data;
  let sum = 0;
  for (let k = 0; k < d.length; k += 4) { const y = 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2]; d[k] = d[k + 1] = d[k + 2] = y; sum += y; }
  if (sum / (d.length / 4) < 110) for (let k = 0; k < d.length; k += 4) { const y = 255 - d[k]; d[k] = d[k + 1] = d[k + 2] = y; } // dark-mode screenshots
  ctx.putImageData(img, 0, 0);
  return c;
}
async function ocrImage(file, title) {
  setBusy(title, 'Préparation de l’image…', null);
  const canvas = await prepareImage(file);
  if (cancelImport) throw CANCELLED;
  return ocrCanvas(canvas, title, '');
}

function openFromText(text, title = '') {
  const paras = cleanText(text);
  if (!paras.length) { toast('Le texte est vide.'); return; }
  openDoc(paras, title);
}

async function pasteFromClipboard() {
  try {
    if (navigator.clipboard && navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith('image/'));
        if (type) { const blob = await it.getType(type); importFiles([new File([blob], 'presse-papiers', { type })]); return; }
      }
      for (const it of items) {
        if (it.types.includes('text/plain')) { const t = await (await it.getType('text/plain')).text(); if (t.trim()) { openFromText(t); return; } }
      }
    } else if (navigator.clipboard && navigator.clipboard.readText) {
      const t = await navigator.clipboard.readText();
      if (t.trim()) { openFromText(t); return; }
    }
    toast('Le presse-papiers ne contient ni image ni texte.');
  } catch (e) {
    toast(`Accès au presse-papiers refusé. Utilise ${isMac ? '⌘' : 'Ctrl'} + V.`);
  }
}

/* ============================================================
   Views
   ============================================================ */
let editing = false;
function openDoc(paras, title) {
  stopAll();
  activeI = -1;
  doc = buildDoc(paras, title);
  renderDoc();
  P.i = 0; P.wordIdx = -1;
  closeEditor(false, true);
  showReader();
  setActive(0, { scroll: false });
  window.scrollTo(0, 0);
  $('#docTitle').textContent = doc.title;
  el.doc.lang = doc.lang;
  document.title = `${doc.title} – PocketRead`;
  applyView();
  updatePills();
  updatePlayUI();
  updateNotice();
  updateResume();
}
function showReader() {
  if (!el.reader.hidden) return;
  el.home.hidden = true;
  el.reader.hidden = false;
  if (!history.state || !history.state.reader) history.pushState({ reader: 1 }, '');
  measurePlayer();
}
function showHome() {
  pause();
  editing = false;
  el.reader.hidden = true;
  el.home.hidden = false;
  el.returnPill.hidden = true;
  document.title = 'PocketRead';
  updateResume();
  window.scrollTo(0, 0);
}
function updateResume() {
  const r = $('#resume');
  if (!doc) { r.hidden = true; return; }
  r.hidden = false;
  $('#resumeTitle').textContent = doc.title;
}
addEventListener('popstate', () => { if (!el.reader.hidden) showHome(); });

function openEditor(initial) {
  pause();
  editing = true;
  if (el.reader.hidden) showReader();
  el.docWrap.hidden = true;
  el.notice.hidden = true;
  el.player.hidden = true;
  el.returnPill.hidden = true;
  el.editor.hidden = false;
  el.editText.value = initial != null ? initial : (doc ? doc.paras.map((p) => p.text).join('\n\n') : '');
  $('#docTitle').textContent = doc ? doc.title : 'Nouveau texte';
  setTimeout(() => el.editText.focus(), 50);
}
function closeEditor(apply, silent) {
  if (!editing && silent) return;
  const text = el.editText.value;
  editing = false;
  el.editor.hidden = true;
  el.docWrap.hidden = false;
  el.player.hidden = false;
  measurePlayer();
  if (silent) return;
  if (apply) {
    const keep = P.i;
    const paras = cleanText(text);
    if (!paras.length) { toast('Le texte est vide.'); if (!doc) showHome(); return; }
    const hadDoc = !!doc;
    openDoc(paras, hadDoc && doc.title ? doc.title : '');
    if (hadDoc && keep > 0) goTo(Math.min(keep, doc.units.length - 1), false);
  } else if (!doc) showHome();
  else updateNotice();
}

function updateNotice() {
  const n = el.notice;
  if (!doc || editing || S.noticeDismissed || engine() === Pi) { n.hidden = true; return; }
  const list = sysVoicesFor(effLang());
  const best = list[0];
  if (Sys.voices.length && (!best || voiceScore(best) < 40)) {
    $('#noticeText').textContent = best
      ? 'Les voix installées sur cet appareil sont assez robotiques. Les voix IA locales sont nettement plus naturelles (téléchargement unique ≈ 60 Mo).'
      : `Aucune voix ${LANGS[effLang()].name.toLowerCase()} sur cet appareil. Les voix IA locales fonctionnent partout (téléchargement unique ≈ 60 Mo).`;
    n.hidden = false;
  } else n.hidden = true;
}

function measurePlayer() {
  requestAnimationFrame(() => {
    const h = el.player.hidden ? 0 : el.player.offsetHeight;
    document.documentElement.style.setProperty('--player-h', `${h}px`);
  });
}

/* ============================================================
   View settings
   ============================================================ */
function applyView() {
  const r = document.documentElement;
  r.dataset.theme = S.theme;
  r.style.setProperty('--fs', `${S.fontSize}px`);
  r.style.setProperty('--lh', String(S.lineHeight));
  r.style.setProperty('--measure', `${S.width}px`);
  r.style.setProperty('--read-font', S.font === 'sans' ? 'var(--sans)' : S.font === 'hyper' ? 'var(--hyper)' : 'var(--serif)');
  el.doc.classList.toggle('hl-sent', !!S.hlSentence);
  el.doc.classList.toggle('dim', !!S.dimRead);
  el.doc.classList.toggle('focus', !!S.focus);
  requestAnimationFrame(() => {
    refreshMarker();
    const bg = getComputedStyle(document.body).backgroundColor;
    $$('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg));
  });
}

/* ============================================================
   Settings sheet
   ============================================================ */
let sheetTab = 'voice';
const FMT = {
  rate: (x) => `${fmtNum(x)}×`,
  pitch: (x) => (x === 0 ? 'normale' : `${x > 0 ? '+' : '−'}${fmtNum(Math.abs(x))} demi-ton${Math.abs(x) > 1 ? 's' : ''}`),
  volume: (x) => `${Math.round(x * 100)} %`,
  pauseSentence: (x) => (x >= 1000 ? `${fmtNum(x / 1000)} s` : `${x} ms`),
  pauseParagraph: (x) => (x >= 1000 ? `${fmtNum(x / 1000)} s` : `${x} ms`),
  noiseScale: (x) => fmtNum(x),
  noiseW: (x) => fmtNum(x),
  fontSize: (x) => `${x} px`,
  lineHeight: (x) => fmtNum(x),
  width: (x) => `${x} px`,
};
const LIVE_ON_INPUT = new Set(['rate', 'pitch', 'volume', 'pauseSentence', 'pauseParagraph', 'fontSize', 'lineHeight', 'width']);

function segHTML(key, options, cur) {
  return `<div class="seg" role="group">${options.map(([v, label]) => `<button type="button" data-seg="${key}" data-val="${esc(v)}" aria-pressed="${String(v) === String(cur)}">${esc(label)}</button>`).join('')}</div>`;
}
function rangeHTML(key, label, min, max, step, val) {
  return `<div class="row"><label for="r-${key}">${label}</label><output id="o-${key}">${FMT[key](val)}</output><input type="range" id="r-${key}" data-range="${key}" min="${min}" max="${max}" step="${step}" value="${val}"></div>`;
}
function switchHTML(key, label, sub) {
  return `<label class="sw-row"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span><span class="switch"><input type="checkbox" data-switch="${key}" ${S[key] ? 'checked' : ''}><i></i></span></label>`;
}

function tipHTML() {
  if (engine() === Pi) {
    return '<div class="tip">Les voix <b>HD</b> sont les plus nettes. Les voix <b>Standard</b> sonnent un peu plus étouffées mais se calculent un peu plus vite. Tout est calculé sur ton appareil : ton texte ne le quitte jamais.</div>';
  }
  if (isIOS) return '<div class="tip"><b>Pour des voix bien plus naturelles</b> : Réglages › Accessibilité › Contenu énoncé › Voix › Français, puis télécharge une voix marquée « Premium » ou « Améliorée ». Rouvre ensuite PocketRead.</div>';
  if (isMac) return '<div class="tip"><b>Pour des voix bien plus naturelles</b> : Réglages Système › Accessibilité › Contenu énoncé › Voix du système › Gérer les voix, puis télécharge une voix « Premium ». Ou ouvre PocketRead dans Microsoft Edge pour ses voix « Natural ».</div>';
  if (isEdge) return '<div class="tip">Les voix <b>Natural</b> de Microsoft (Denise, Henri, Vivienne, Remy…) sont les plus réalistes de toutes : choisis-en une dans la liste.</div>';
  if (isWindows) return '<div class="tip"><b>Astuce</b> : ouvre PocketRead dans Microsoft Edge. Il donne accès gratuitement aux voix « Natural » de Microsoft, les plus réalistes.</div>';
  if (isAndroid) return '<div class="tip"><b>Pour de meilleures voix</b> : Paramètres › Accessibilité › Synthèse vocale, choisis le moteur Google et télécharge les voix haute qualité.</div>';
  return '<div class="tip">Les voix marquées <b>Naturelle</b> sont les plus réalistes. Sinon, essaie les voix IA locales.</div>';
}

function sysListHTML(lang) {
  if (!Sys.supported) return '<p class="empty">Ce navigateur ne propose pas de voix système. Utilise les voix IA locales.</p>';
  const list = sysVoicesFor(lang);
  if (!list.length) return `<p class="empty">Aucune voix ${LANGS[lang].name.toLowerCase()} trouvée sur cet appareil. Essaie les voix IA locales.</p>`;
  const cur = currentSysVoice(lang);
  const shown = list.filter((v) => S.gender === 'all' || voiceGender(v) === S.gender);
  if (!shown.length) return `<p class="empty">Aucune voix ${S.gender === 'F' ? 'féminine' : 'masculine'} reconnue. Choisis « Toutes » pour voir la liste complète.</p>`;
  const limit = S.showAll ? shown.length : Math.min(shown.length, 8);
  let h = '<div class="voices" role="radiogroup">';
  for (const v of shown.slice(0, limit)) {
    const tier = voiceTier(v), g = voiceGender(v), sel = cur && cur.voiceURI === v.voiceURI;
    h += `<div class="voice" role="radio" tabindex="0" aria-checked="${!!sel}" data-sysvoice="${esc(v.voiceURI)}">
      <div class="v-main"><div class="v-name">${esc(shortVoiceName(v))}</div>
      <div class="v-meta"><span class="tag ${tier === 'Naturelle' ? 'good' : ''}">${tier}</span><span>${esc(prettyLang(v.lang))}</span>${g ? `<span>${g === 'F' ? 'Femme' : 'Homme'}</span>` : ''}</div></div>
      <button type="button" class="icon-btn" data-preview-sys="${esc(v.voiceURI)}" aria-label="Écouter ${esc(shortVoiceName(v))}">${ICON('speaker')}</button></div>`;
  }
  h += '</div>';
  if (shown.length > limit) h += `<button type="button" class="btn ghost small more" data-act="showAll">Afficher les ${shown.length - limit} autres voix</button>`;
  else if (S.showAll && list.length > 8) h += '<button type="button" class="btn ghost small more" data-act="showLess">Afficher moins de voix</button>';
  return h;
}
function piperListHTML(lang) {
  const cur = S.piperVoice[lang];
  const shown = PIPER_VOICES[lang].filter((v) => S.gender === 'all' || v.g === S.gender);
  let h = '<div class="voices" role="radiogroup">';
  for (const v of shown) {
    const info = piperParse(v.key);
    const cached = PiperMgr.isCached(info.id);
    const dl = PiperMgr.progress.has(info.id);
    const pr = PiperMgr.progress.get(info.id);
    const hd = info.quality === 'medium' || info.quality === 'high';
    let right;
    if (dl) right = `<span class="v-prog" data-prog="${esc(info.id)}">${pr == null ? '…' : `${Math.round(pr * 100)} %`}</span>`;
    else if (cached) right = `<button type="button" class="icon-btn" data-preview-piper="${esc(v.key)}" aria-label="Écouter ${esc(v.label)}">${ICON('speaker')}</button><button type="button" class="icon-btn" data-del="${esc(info.id)}" aria-label="Supprimer ${esc(v.label)} de l’appareil">${ICON('trash')}</button>`;
    else right = `<button type="button" class="icon-btn" data-dl="${esc(v.key)}" aria-label="Télécharger ${esc(v.label)}">${ICON('download')}</button>`;
    h += `<div class="voice" role="radio" tabindex="0" aria-checked="${cur === v.key}" data-piper="${esc(v.key)}">
      <div class="v-main"><div class="v-name">${esc(v.label)}</div>
      <div class="v-meta"><span class="tag ${hd ? 'good' : ''}">${hd ? 'HD' : 'Standard'}</span><span>${v.g === 'F' ? 'Femme' : 'Homme'}</span><span>${cached ? 'Sur l’appareil' : piperSize(info.quality)}</span></div></div>
      ${right}</div>`;
  }
  return `${h}</div>`;
}

function voiceTabHTML() {
  const lang = effLang();
  let h = '';
  if (Sys.supported) {
    h += `<div class="sec"><p class="sec-title">Moteur de voix</p>${segHTML('engine', [['system', 'Voix de l’appareil'], ['piper', 'Voix IA locale']], S.engine)}
      <p class="sec-note">${S.engine === 'piper'
        ? 'Voix neuronales calculées sur ton appareil. Chaque voix se télécharge une fois, puis fonctionne hors-ligne.'
        : 'Démarrage instantané et hors-ligne. La qualité dépend des voix installées sur ton appareil.'}</p></div>`;
  }
  const auto = doc ? `Auto (${LANGS[doc.lang].short})` : 'Auto';
  h += `<div class="sec"><p class="sec-title">Langue de lecture</p>${segHTML('lang', [['auto', auto], ['fr', 'FR'], ['en', 'EN'], ['de', 'DE']], S.lang)}</div>`;
  h += `<div class="sec"><p class="sec-title">Voix</p>${segHTML('gender', [['all', 'Toutes'], ['F', 'Femme'], ['M', 'Homme']], S.gender)}<div style="height:10px"></div>
    <div id="voiceList">${engine() === Pi ? piperListHTML(lang) : sysListHTML(lang)}</div>${tipHTML()}</div>`;
  h += `<div class="sec">${rangeHTML('rate', 'Vitesse', 0.5, 3, 0.05, S.rate)}
    <div class="presets">${[0.8, 1, 1.25, 1.5, 2].map((r) => `<button type="button" class="chip" data-rate="${r}" aria-pressed="${Math.abs(S.rate - r) < 0.001}">${fmtNum(r)}×</button>`).join('')}</div>
    ${rangeHTML('pitch', 'Hauteur', -6, 6, 0.5, S.pitch)}
    ${rangeHTML('volume', 'Volume', 0, 1, 0.05, S.volume)}
    ${engine() === Sys ? '<p class="sec-note">Certaines voix de l’appareil ignorent la hauteur.</p>' : ''}</div>`;
  h += `<div class="sec"><p class="sec-title">Rythme</p>
    ${rangeHTML('pauseSentence', 'Pause entre les phrases', 0, 1500, 50, S.pauseSentence)}
    ${rangeHTML('pauseParagraph', 'Pause entre les paragraphes', 0, 3000, 100, S.pauseParagraph)}</div>`;
  if (engine() === Pi) {
    h += `<div class="sec"><p class="sec-title"><span>Intonation</span><button type="button" class="btn ghost small" data-act="resetTone">Réinitialiser</button></p>
      ${rangeHTML('noiseScale', 'Expressivité', 0.2, 1.1, 0.05, S.noiseScale ?? 0.667)}
      ${rangeHTML('noiseW', 'Variation du rythme', 0.2, 1.4, 0.05, S.noiseW ?? 0.8)}
      <p class="sec-note">Plus d’expressivité rend l’intonation plus vivante ; moins la rend plus posée et régulière.</p></div>`;
  }
  return h;
}
function viewTabHTML() {
  let h = `<div class="sec"><p class="sec-title">Thème</p>${segHTML('theme', [['auto', 'Auto'], ['light', 'Clair'], ['sepia', 'Sépia'], ['dark', 'Sombre'], ['amoled', 'Noir']], S.theme)}</div>
    <div class="sec"><p class="sec-title">Texte</p>${segHTML('font', [['serif', 'Literata'], ['sans', 'Sans'], ['hyper', 'Lisible']], S.font)}
    ${rangeHTML('fontSize', 'Taille', 15, 34, 1, S.fontSize)}
    ${rangeHTML('lineHeight', 'Interligne', 1.3, 2.3, 0.05, S.lineHeight)}
    ${innerWidth > 760 ? rangeHTML('width', 'Largeur de colonne', 480, 960, 20, S.width) : ''}</div>
    <div class="sec"><p class="sec-title">Pendant la lecture</p>
    ${switchHTML('hlWord', 'Surligner le mot lu')}
    ${switchHTML('hlSentence', 'Surligner la phrase')}
    ${switchHTML('autoScroll', 'Suivre la lecture', 'Le texte défile tout seul')}
    ${switchHTML('focus', 'Mode focus', 'Estompe les autres paragraphes')}
    ${switchHTML('dimRead', 'Estomper le texte déjà lu')}
    ${switchHTML('tapToRead', 'Toucher une phrase pour la lire')}
    ${'wakeLock' in navigator ? switchHTML('wakeLock', 'Garder l’écran allumé', 'Pendant la lecture') : ''}</div>`;
  if (!isTouch) {
    h += `<div class="sec"><p class="sec-title">Raccourcis clavier</p><div class="keys">
      <span><kbd>Espace</kbd></span><span>Lecture / pause</span>
      <span><kbd>←</kbd> <kbd>→</kbd></span><span>Phrase précédente / suivante</span>
      <span><kbd>Maj</kbd> + <kbd>←</kbd> <kbd>→</kbd></span><span>Paragraphe précédent / suivant</span>
      <span><kbd>+</kbd> <kbd>−</kbd></span><span>Vitesse</span>
      <span><kbd>F</kbd></span><span>Mode focus</span>
      <span><kbd>V</kbd></span><span>Réglages de la voix</span></div></div>`;
  }
  return h;
}
function renderSheet() {
  const body = el.sheetBody;
  const y = body.scrollTop;
  body.innerHTML = sheetTab === 'voice' ? voiceTabHTML() : viewTabHTML();
  $$('input[type="range"]', body).forEach(fillRange);
  $('#tabVoice').setAttribute('aria-selected', String(sheetTab === 'voice'));
  $('#tabView').setAttribute('aria-selected', String(sheetTab === 'view'));
  body.scrollTop = y;
}
const sheetOpen = () => el.sheet.classList.contains('open');
function openSheet(tab) {
  if (tab) sheetTab = tab;
  renderSheet();
  el.sheetBody.scrollTop = 0;
  el.scrim.hidden = false;
  el.sheet.removeAttribute('inert');
  el.sheet.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => { el.scrim.classList.add('open'); el.sheet.classList.add('open'); });
  PiperMgr.refreshCached().then(() => { if (sheetOpen() && sheetTab === 'voice' && engine() === Pi) refreshVoiceUI(); });
}
function closeSheet() {
  el.scrim.classList.remove('open');
  el.sheet.classList.remove('open');
  el.sheet.setAttribute('inert', '');
  el.sheet.setAttribute('aria-hidden', 'true');
  setTimeout(() => { if (!sheetOpen()) el.scrim.hidden = true; }, 320);
}
function refreshVoiceUI() {
  updatePills();
  if (sheetOpen() && sheetTab === 'voice') {
    const box = $('#voiceList');
    if (box) box.innerHTML = engine() === Pi ? piperListHTML(effLang()) : sysListHTML(effLang());
  }
}
function updateDownloadUI(id) {
  const pr = PiperMgr.progress.get(id);
  const txt = pr == null ? '…' : `${Math.round(pr * 100)} %`;
  $$(`[data-prog="${CSS.escape(id)}"]`).forEach((n) => { n.textContent = txt; });
  if (piperParse(PiperMgr.voiceKey()).id === id) el.voiceLbl.textContent = voiceLabel();
}
function syncSheetValues() {
  if (!sheetOpen()) return;
  for (const r of $$('[data-range]', el.sheetBody)) {
    const k = r.dataset.range;
    const v = k === 'noiseScale' ? (S.noiseScale ?? 0.667) : k === 'noiseW' ? (S.noiseW ?? 0.8) : S[k];
    r.value = v; fillRange(r);
    const o = $(`#o-${k}`); if (o) o.textContent = FMT[k](v);
  }
  $$('[data-rate]', el.sheetBody).forEach((b) => b.setAttribute('aria-pressed', String(Math.abs(S.rate - +b.dataset.rate) < 0.001)));
}

function autoPickForGender() {
  if (S.gender === 'all') return;
  const lang = effLang();
  if (engine() === Pi) {
    const cands = PIPER_VOICES[lang].filter((v) => v.g === S.gender);
    const cached = cands.find((v) => PiperMgr.isCached(piperParse(v.key).id));
    const cur = piperInfo(S.piperVoice[lang]);
    if (cur.g !== S.gender && cached) S.piperVoice[lang] = cached.key;
  } else {
    const v = sysVoicesFor(lang).find((x) => voiceGender(x) === S.gender);
    if (v) S.sysVoice[lang] = v.voiceURI;
  }
}

function setSetting(k, v) {
  S[k] = v;
  save();
  switch (k) {
    case 'engine':
      if (v === 'piper') PiperMgr.refreshCached().then(refreshVoiceUI);
      onVoiceSetting('engine'); renderSheet(); updateNotice(); break;
    case 'lang': onVoiceSetting('voice'); renderSheet(); updateNotice(); break;
    case 'gender': autoPickForGender(); save(); onVoiceSetting('voice'); renderSheet(); break;
    case 'rate': onVoiceSetting('rate'); break;
    case 'pitch': onVoiceSetting('pitch'); break;
    case 'volume': onVoiceSetting('volume'); break;
    case 'pauseSentence': case 'pauseParagraph': computeTimes(); updateProgress(); break;
    case 'noiseScale': case 'noiseW': onVoiceSetting('noise'); break;
    case 'theme': case 'font': applyView(); renderSheet(); break;
    default: applyView();
  }
}

function previewSys(uri) {
  const v = Sys.voices.find((x) => x.voiceURI === uri);
  if (!v) return;
  pause();
  const lang = normLang(v.lang).slice(0, 2);
  const sample = (LANGS[lang] || LANGS.fr).sample;
  Sys.speak({ text: sample, i: -1 }, 0, { onStart() {}, onWord() {}, onEnd() {}, onError() {}, onLoading() {} }, { voice: v });
}
async function previewPiper(key) {
  pause();
  const info = piperParse(key);
  const lang = info.id.slice(0, 2);
  const w = PiperMgr.worker();
  if (!w) return;
  unlockAudio();
  const id = PiperMgr.seq++;
  const pr = new Promise((res, rej) => PiperMgr.pend.set(id, { res, rej, k: `preview|${id}` }));
  w.postMessage({ type: 'synth', gen: PiperMgr.gen, voiceId: info.id, url: info.url, speaker: info.speaker, noiseScale: S.noiseScale, noiseW: S.noiseW, items: [{ id, text: LANGS[lang].sample }] });
  try {
    const e = await pr;
    if (!e) return;
    const pf = Math.pow(2, S.pitch / 12);
    Pi.stop();
    const a = el.audio;
    a.src = wavURL(e, pf);
    setPreservesPitch(a);
    a.volume = S.volume;
    const go = () => { a.playbackRate = clamp(S.rate / pf, 0.25, 4); a.play().catch(() => {}); };
    if (a.readyState >= 1) go(); else a.addEventListener('loadedmetadata', go, { once: true });
  } catch (err) {
    if (err !== CANCELLED) toast(`Aperçu impossible : ${err.message || err}`);
  }
}

/* sheet events */
el.sheetBody.addEventListener('click', (e) => {
  const t = e.target;
  const seg = t.closest('[data-seg]');
  if (seg) {
    const k = seg.dataset.seg;
    setSetting(k, seg.dataset.val);
    return;
  }
  const rb = t.closest('[data-rate]');
  if (rb) { setRate(+rb.dataset.rate); return; }
  const ps = t.closest('[data-preview-sys]');
  if (ps) { e.stopPropagation(); previewSys(ps.dataset.previewSys); return; }
  const pp = t.closest('[data-preview-piper]');
  if (pp) { e.stopPropagation(); previewPiper(pp.dataset.previewPiper); return; }
  const dl = t.closest('[data-dl]');
  if (dl) { e.stopPropagation(); PiperMgr.download(dl.dataset.dl); return; }
  const del = t.closest('[data-del]');
  if (del) {
    e.stopPropagation();
    const id = del.dataset.del;
    if (isPlaying() && engine() === Pi && piperParse(PiperMgr.voiceKey()).id === id) pause();
    PiperMgr.remove(id).then(() => { refreshVoiceUI(); toast('Voix supprimée de l’appareil.'); });
    return;
  }
  const sv = t.closest('[data-sysvoice]');
  if (sv) {
    S.sysVoice[effLang()] = sv.dataset.sysvoice; save();
    onVoiceSetting('voice'); refreshVoiceUI(); updateNotice();
    return;
  }
  const pv = t.closest('[data-piper]');
  if (pv) {
    const key = pv.dataset.piper;
    S.piperVoice[effLang()] = key; save();
    if (!PiperMgr.isCached(piperParse(key).id)) PiperMgr.download(key);
    onVoiceSetting('voice'); refreshVoiceUI();
    return;
  }
  const act = t.closest('[data-act]');
  if (act) {
    const a = act.dataset.act;
    if (a === 'showAll') { S.showAll = true; save(); refreshVoiceUI(); }
    if (a === 'showLess') { S.showAll = false; save(); refreshVoiceUI(); }
    if (a === 'resetTone') { S.noiseScale = null; S.noiseW = null; save(); syncSheetValues(); onVoiceSetting('noise'); }
  }
});
el.sheetBody.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.voice')) { e.preventDefault(); e.target.click(); }
});
el.sheetBody.addEventListener('input', (e) => {
  const r = e.target.closest('[data-range]');
  if (!r) return;
  const k = r.dataset.range, v = parseFloat(r.value);
  fillRange(r);
  const o = $(`#o-${k}`); if (o) o.textContent = FMT[k](v);
  if (LIVE_ON_INPUT.has(k)) setSetting(k, v);
  if (k === 'rate') $$('[data-rate]', el.sheetBody).forEach((b) => b.setAttribute('aria-pressed', String(Math.abs(v - +b.dataset.rate) < 0.001)));
});
el.sheetBody.addEventListener('change', (e) => {
  const r = e.target.closest('[data-range]');
  if (r) { if (!LIVE_ON_INPUT.has(r.dataset.range)) setSetting(r.dataset.range, parseFloat(r.value)); return; }
  const s = e.target.closest('[data-switch]');
  if (s) setSetting(s.dataset.switch, s.checked);
});

function onVoicesChanged() {
  updatePills();
  updateNotice();
  if (sheetOpen() && sheetTab === 'voice' && engine() === Sys) refreshVoiceUI();
}

/* ============================================================
   Wiring
   ============================================================ */
const blurIfMouse = (e) => { if (e.detail > 0 && e.currentTarget.blur) e.currentTarget.blur(); };
function on(id, ev, fn) { const n = document.getElementById(id); if (n) n.addEventListener(ev, fn); }

on('pickBtn', 'click', () => $('#fileInput').click());
on('fileInput', 'change', (e) => { importFiles(e.target.files); e.target.value = ''; });
on('pasteBtn', 'click', pasteFromClipboard);
on('typeBtn', 'click', () => openEditor(''));
on('resumeBtn', 'click', () => { showReader(); setActive(P.i, { force: true }); });
on('homeSettings', 'click', () => openSheet('view'));
on('backBtn', 'click', () => { if (history.state && history.state.reader) history.back(); else showHome(); });
on('editBtn', 'click', () => (editing ? closeEditor(false) : openEditor()));
on('viewBtn', 'click', () => openSheet('view'));
on('editDone', 'click', () => closeEditor(true));
on('editCancel', 'click', () => closeEditor(false));
on('busyCancel', 'click', async () => {
  cancelImport = true;
  if (tess) { try { await tess.terminate(); } catch (e) { /* ignore */ } tess = null; }
  hideBusy();
});
on('sheetClose', 'click', closeSheet);
on('scrim', 'click', closeSheet);
on('tabVoice', 'click', () => { sheetTab = 'voice'; renderSheet(); });
on('tabView', 'click', () => { sheetTab = 'view'; renderSheet(); });
on('voicePill', 'click', (e) => { blurIfMouse(e); openSheet('voice'); });
on('noticeTry', 'click', () => { setSetting('engine', 'piper'); openSheet('voice'); });
on('noticeClose', 'click', () => { S.noticeDismissed = true; save(); updateNotice(); });
on('returnPill', 'click', () => { userScrollAt = 0; if (activeI >= 0) ensureVisible(doc.units[activeI].el, true); });

const SPEEDS = [0.8, 1, 1.25, 1.5, 1.75, 2, 2.5];
el.speedPill.addEventListener('click', (e) => {
  blurIfMouse(e);
  const next = SPEEDS.find((s) => s > S.rate + 0.001);
  setRate(next == null ? SPEEDS[0] : next);
});
el.playBtn.addEventListener('click', (e) => { blurIfMouse(e); toggle(); });
on('nextSent', 'click', (e) => { blurIfMouse(e); nextSentence(); });
on('prevSent', 'click', (e) => { blurIfMouse(e); prevSentence(); });
on('nextPara', 'click', (e) => { blurIfMouse(e); nextPara(); });
on('prevPara', 'click', (e) => { blurIfMouse(e); prevPara(); });

/* tap a sentence */
el.doc.addEventListener('click', (e) => {
  if (!S.tapToRead || !doc) return;
  const sel = getSelection();
  if (sel && !sel.isCollapsed) return;
  const u = e.target.closest('.u');
  if (!u) return;
  userScrollAt = 0;
  goTo(+u.dataset.i, true);
});

/* scrubber */
el.scrub.addEventListener('input', () => {
  if (!doc) return;
  if (!scrubbing) { scrubbing = true; scrubWasPlaying = isPlaying(); if (scrubWasPlaying) { clearTimeout(P.timer); Sys.stop(); Pi.stop(); } }
  fillRange(el.scrub);
  const i = +el.scrub.value;
  P.i = i;
  userScrollAt = 0;
  setActive(i, { force: true });
});
el.scrub.addEventListener('change', () => {
  if (!doc) return;
  scrubbing = false;
  goTo(+el.scrub.value, scrubWasPlaying);
});

/* keyboard */
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (sheetOpen()) { closeSheet(); e.preventDefault(); } return; }
  const t = e.target;
  if (t.closest && t.closest('input:not([type="range"]), textarea, select, [contenteditable="true"]')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(e.key)) userScrollAt = Date.now();
  if (el.reader.hidden || !doc || editing) return;
  const onButton = t.closest && t.closest('button, [role="radio"]');
  const onRange = t.matches && t.matches('input[type="range"]');
  switch (e.key) {
    case ' ':
      if (onButton) return;
      e.preventDefault(); toggle(); break;
    case 'ArrowRight':
      if (onRange) return;
      e.preventDefault(); if (e.shiftKey) nextPara(); else nextSentence(); break;
    case 'ArrowLeft':
      if (onRange) return;
      e.preventDefault(); if (e.shiftKey) prevPara(); else prevSentence(); break;
    case '+': case '=': setRate(S.rate + 0.1); toast(`Vitesse ${fmtNum(S.rate)}×`, 1200); break;
    case '-': case '_': setRate(S.rate - 0.1); toast(`Vitesse ${fmtNum(S.rate)}×`, 1200); break;
    case 'f': case 'F': setSetting('focus', !S.focus); toast(S.focus ? 'Mode focus activé' : 'Mode focus désactivé', 1400); break;
    case 'v': case 'V': openSheet('voice'); break;
    default: break;
  }
});

/* paste anywhere */
document.addEventListener('paste', (e) => {
  if (e.target.closest && e.target.closest('textarea, input')) return;
  const cd = e.clipboardData;
  if (!cd) return;
  const files = [...(cd.files || [])].filter((f) => isImage(f) || isPDF(f) || isText(f));
  if (files.length) { e.preventDefault(); importFiles(files); return; }
  const text = cd.getData('text/plain');
  if (text && text.trim()) { e.preventDefault(); openFromText(text); }
});

/* drag and drop anywhere */
let dragDepth = 0;
const dropZone = $('#drop');
addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; dropZone.classList.add('over'); } });
addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropZone.classList.remove('over'); });
addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
addEventListener('drop', (e) => {
  if (!e.dataTransfer || !e.dataTransfer.files.length) return;
  e.preventDefault();
  dragDepth = 0; dropZone.classList.remove('over');
  importFiles(e.dataTransfer.files);
});

/* OCR language chips */
function renderOcrLangs() {
  const box = $('#ocrLangs');
  box.innerHTML = Object.values(LANGS).map((l) => `<button type="button" class="chip" data-ocr="${l.ocr}" aria-pressed="${S.ocrLangs.includes(l.ocr)}">${l.name}</button>`).join('');
}
$('#ocrLangs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ocr]');
  if (!b) return;
  const code = b.dataset.ocr;
  const has = S.ocrLangs.includes(code);
  if (has && S.ocrLangs.length === 1) { toast('Garde au moins une langue.'); return; }
  S.ocrLangs = has ? S.ocrLangs.filter((c) => c !== code) : [...S.ocrLangs, code];
  save();
  renderOcrLangs();
});

/* resize */
const onResize = debounce(() => { measurePlayer(); refreshMarker(); }, 120);
addEventListener('resize', onResize);
if (window.ResizeObserver) new ResizeObserver(() => refreshMarker()).observe(el.doc);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => refreshMarker());

/* hero: the highlighter reads the headline once */
function heroIntro() {
  const h = $('#hero'), mark = $('#heroMark');
  const text = h.dataset.text;
  h.textContent = '';
  h.append(mark);
  const words = [];
  text.split(/(\s+)/).forEach((t) => {
    if (!t) return;
    if (/^\s+$/.test(t)) { h.append(t); return; }
    const s = document.createElement('span');
    s.className = 'hw'; s.textContent = t;
    h.append(s); words.push(s);
  });
  if (reducedMotion.matches) return;
  let k = 0;
  const step = () => {
    if (k >= words.length || el.home.hidden) { mark.style.opacity = '0'; return; }
    const r = words[k].getBoundingClientRect(), hr = h.getBoundingClientRect();
    const pad = r.height * 0.08;
    mark.style.transform = `translate(${r.left - hr.left - pad}px, ${r.top - hr.top + r.height * 0.12}px)`;
    mark.style.width = `${r.width + pad * 2}px`;
    mark.style.height = `${r.height * 0.8}px`;
    mark.style.opacity = '1';
    k++;
    setTimeout(step, /[.!?]$/.test(words[k - 1].textContent) ? 560 : 300);
  };
  const begin = () => setTimeout(step, 450);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(begin); else begin();
}

/* ============================================================
   Boot
   ============================================================ */
$$('.mod-key').forEach((n) => { n.textContent = isMac || isIOS ? '⌘' : 'Ctrl'; });
if (isTouch) {
  $('#dropTitle').textContent = 'Ajoute un fichier';
  $('#dropSub').textContent = 'Photo, capture d’écran ou PDF, même plusieurs d’un coup.';
}
if (!Sys.supported) S.engine = 'piper';
applyView();
renderOcrLangs();
heroIntro();
Sys.init();
setupMedia();
updatePills();
updatePlayUI();
PiperMgr.refreshCached();
el.sheet.setAttribute('inert', '');
history.replaceState({ home: 1 }, '');

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
})();
