/* PocketRead — local neural voices (Piper models) running in a Web Worker.
   Text → phonemes (espeak-ng compiled to WebAssembly) → audio (ONNX Runtime Web). */
'use strict';

const ORT_BASES = [
  'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/',
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/',
];
const PH_BASES = [
  'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize',
  'https://cdn.jsdelivr.net/npm/piper-wasm@0.1.4/build/piper_phonemize',
];
const VOICE_CACHE = 'pocketread-voices-v1';

let initP = null;
let phBase = PH_BASES[0];
let phWasm = null, phData = null;
let batchOK = null; // can the phonemizer take several texts in one run?
let gen = 0;
let chain = Promise.resolve();
const sessions = new Map(); // model url -> { session, config }

self.onmessage = (e) => {
  const m = e.data || {};
  if (m.type === 'cancel') { gen = m.gen; return; }
  if (m.type === 'unload') {
    const s = sessions.get(m.url);
    if (s) { try { s.session.release(); } catch (err) { /* ignore */ } sessions.delete(m.url); }
    return;
  }
  chain = chain.then(() => handle(m)).catch((err) => {
    self.postMessage({
      type: 'error', kind: m.type, voiceId: m.voiceId,
      ids: (m.items || []).map((x) => x.id),
      message: (err && (err.message || String(err))) || 'erreur inconnue',
    });
  });
};

async function handle(m) {
  if (m.type === 'load') {
    await init();
    await loadVoice(m.url, m.voiceId);
    self.postMessage({ type: 'loaded', voiceId: m.voiceId });
    return;
  }
  if (m.type === 'synth') await synth(m);
}

function init() {
  if (initP) return initP;
  initP = (async () => {
    let lastErr = null;
    if (typeof ort === 'undefined') {
      for (const base of ORT_BASES) {
        try { importScripts(`${base}ort.min.js`); ort.env.wasm.wasmPaths = base; break; } catch (err) { lastErr = err; }
      }
    }
    if (typeof ort === 'undefined') throw new Error(`moteur ONNX introuvable (${lastErr && lastErr.message})`);
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;

    for (const base of PH_BASES) {
      try {
        importScripts(`${base}.js`); // glue, wasm and data must come from the same build
        const [w, d] = await Promise.all([getBuf(`${base}.wasm`), getBuf(`${base}.data`)]);
        phBase = base; phWasm = w; phData = d;
        break;
      } catch (err) { lastErr = err; }
    }
    if (typeof createPiperPhonemize === 'undefined' || !phWasm) throw new Error(`phonémiseur introuvable (${lastErr && lastErr.message})`);
  })();
  initP.catch(() => { initP = null; });
  return initP;
}

async function getBuf(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.arrayBuffer();
}

/* Voice files are kept in the Cache API so they download only once. */
async function fetchCached(url, onProgress) {
  let cache = null;
  try { cache = await caches.open(VOICE_CACHE); } catch (err) { /* no Cache API */ }
  if (cache) {
    const hit = await cache.match(url);
    if (hit) return hit.arrayBuffer();
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status === 404 ? 'voix introuvable sur le serveur' : `HTTP ${r.status}`);
  const total = Number(r.headers.get('content-length')) || 0;
  let buf;
  if (r.body && r.body.getReader) {
    const reader = r.body.getReader();
    const chunks = [];
    let loaded = 0, last = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      const now = Date.now();
      if (onProgress && now - last > 150) { last = now; onProgress(loaded, total); }
    }
    if (onProgress) onProgress(loaded, total || loaded);
    const out = new Uint8Array(loaded);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.byteLength; }
    buf = out.buffer;
  } else {
    buf = await r.arrayBuffer();
  }
  if (cache) {
    try { await cache.put(url, new Response(buf.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } })); } catch (err) { /* storage full: still usable this session */ }
  }
  return buf;
}

async function loadVoice(url, voiceId) {
  const have = sessions.get(url);
  if (have) return have;
  const cfg = JSON.parse(new TextDecoder().decode(await fetchCached(`${url}.json`)));
  const model = await fetchCached(url, (loaded, total) => self.postMessage({ type: 'progress', voiceId, loaded, total }));
  for (const [k, v] of sessions) { try { v.session.release(); } catch (err) { /* ignore */ } sessions.delete(k); }
  const session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  const entry = { session, config: cfg };
  sessions.set(url, entry);
  self.postMessage({ type: 'loaded', voiceId });
  return entry;
}

/* espeak-ng phonemizer (one short-lived WebAssembly instance per run) */
async function phonemize(texts, espeakVoice) {
  const lines = [];
  const mod = await createPiperPhonemize({
    wasmBinary: phWasm,
    getPreloadedPackage: () => phData.slice(0),
    locateFile: (p) => (p.endsWith('.wasm') ? `${phBase}.wasm` : p.endsWith('.data') ? `${phBase}.data` : p),
    print: (line) => {
      try { const j = JSON.parse(line); if (j && Array.isArray(j.phoneme_ids)) lines.push(j); } catch (err) { /* not JSON */ }
    },
    printErr: () => {},
  });
  mod.callMain(['-l', espeakVoice, '--input', JSON.stringify(texts.map((t) => ({ text: t }))), '--espeak_data', '/espeak-ng-data']);
  return lines;
}

function mergeIds(lines, spaceId) {
  if (!lines.length) return null;
  if (lines.length === 1) return lines[0].phoneme_ids;
  let out = lines[0].phoneme_ids.slice(0, -1);
  for (let k = 1; k < lines.length; k++) out = out.concat([spaceId, 0], lines[k].phoneme_ids.slice(2, -1));
  out.push(lines[lines.length - 1].phoneme_ids.slice(-1)[0]);
  return out;
}

async function synth(m) {
  const skip = (from) => self.postMessage({ type: 'skipped', ids: m.items.slice(from).map((x) => x.id) });
  if (m.gen < gen) return skip(0);
  await init();
  const { session, config } = await loadVoice(m.url, m.voiceId);
  self.postMessage({ type: 'loaded', voiceId: m.voiceId });
  if (m.gen < gen) return skip(0);

  const inf = config.inference || {};
  const noiseScale = m.noiseScale != null ? m.noiseScale : (inf.noise_scale != null ? inf.noise_scale : 0.667);
  const lengthScale = inf.length_scale != null ? inf.length_scale : 1;
  const noiseW = m.noiseW != null ? m.noiseW : (inf.noise_w != null ? inf.noise_w : 0.8);
  const sr = (config.audio && config.audio.sample_rate) || 22050;
  const voice = (config.espeak && config.espeak.voice) || 'en-us';
  const map = config.phoneme_id_map || {};
  const spaceId = map[' '] && map[' '][0] != null ? map[' '][0] : 3;
  const spk = config.speaker_id_map || {};
  const sid = m.speaker && spk[m.speaker] != null ? spk[m.speaker] : 0;
  const hasSid = session.inputNames.includes('sid');

  let batch = null;
  if (batchOK !== false && m.items.length > 1) {
    try {
      const lines = await phonemize(m.items.map((x) => x.text), voice);
      if (lines.length === m.items.length) { batch = lines.map((l) => l.phoneme_ids); batchOK = true; } else batchOK = false;
    } catch (err) { batchOK = false; }
  }

  for (let k = 0; k < m.items.length; k++) {
    if (m.gen < gen) return skip(k);
    const it = m.items[k];
    const ids = batch ? batch[k] : mergeIds(await phonemize([it.text], voice), spaceId);
    if (!ids || ids.length < 4) { self.postMessage({ type: 'result', id: it.id, empty: true }); continue; }
    const n = ids.length;
    const feeds = {
      input: new ort.Tensor('int64', BigInt64Array.from(ids, (x) => BigInt(x)), [1, n]),
      input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(n)]), [1]),
      scales: new ort.Tensor('float32', Float32Array.from([noiseScale, lengthScale, noiseW]), [3]),
    };
    if (hasSid) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(sid)]), [1]);
    const out = await session.run(feeds);
    const pcm = new Float32Array(out[session.outputNames[0]].data);
    self.postMessage({ type: 'result', id: it.id, pcm, sr }, [pcm.buffer]);
  }
}
