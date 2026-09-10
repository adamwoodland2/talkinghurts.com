/* ============================== seed phrases ============================== */

const SEEDS = {
  general: [
    "Sorry, I've lost my voice, I'm using this to talk",
    "Thank you", "Thank you very much", "Yes please", "No thank you",
    "Could you help me please", "Sorry", "Excuse me",
    "How much is this", "How much is that", "How are you",
    "Where is the toilet please", "Can I pay by card",
    "Have a good day", "One moment please",
  ],
  home: [
    "What's for dinner", "Can you make me a cup of tea please",
    "I'm going to bed", "Can you turn the volume down please",
    "I love you", "Can you get the door please",
    "I'm feeling a bit better today", "My throat still hurts",
  ],
  shop: [
    "How much is this", "Do you have this in a different size",
    "Can I pay by card", "Just looking, thanks",
    "Could I get a bag please", "Do you have any more of these in stock",
    "Where can I find the milk", "Could I get a receipt please",
  ],
  cafe: [
    "Could I get a flat white please", "Could I get a black coffee please",
    "A table for two please", "Could I see the menu please",
    "Could we get the bill please", "Could I get some water please",
    "That was lovely, thank you", "To take away please",
  ],
  medical: [
    "I have laryngitis so I can't speak",
    "I need to collect a prescription", "I have an appointment",
    "It hurts here", "Could I book an appointment please",
    "It started about a week ago",
  ],
  help: [
    "Help",
    "I need help",
    "Need medical help here",
    "Call an ambulance please",
    "I can't breathe properly",
    "This is an emergency",
    "I'm okay now, thank you",
  ],
};

// Personalised seeds from Settings: a name introduces itself in Medical and Out,
// and the local emergency number joins Help. Stored phrases are unaffected.
function personalSeeds(context) {
  const out = [];
  if (settings.name) {
    if (context === "medical" || context === "general") out.push(`My name is ${settings.name}`);
  }
  if (settings.emergency && context === "help") out.push(`Call ${settings.emergency} please`);
  return out;
}

const CONTEXTS = [
  { id: "help",    label: "🆘 Help" },
  { id: "general", label: "🌍 Out" },
  { id: "home",    label: "🏠 Home" },
  { id: "shop",    label: "🛒 Shop" },
  { id: "cafe",    label: "☕ Café" },
  { id: "medical", label: "⚕️ Medical" },
];

// User-defined contexts (Settings): no seed phrases of their own - they start from the
// general blend and grow purely from what gets said in them.
function allContexts() {
  return [...CONTEXTS, ...customCtx.map((c) => ({ id: c.id, label: `${c.emoji || "⭐"} ${c.name}` }))];
}
function contextLabel(id) {
  const c = allContexts().find((x) => x.id === id);
  return c ? c.label : id;
}

// Piper voices (~25–75 MB each, downloaded once and kept in browser storage)
// Default is the OpenSLR 83 voice (CC-BY-SA, the cleanest licence of the four);
// "Jenny (Dioco)" naming is a condition of that voice's licence.
const VOICES = [
  { id: "en_GB-northern_english_male-medium", label: "Male, Northern English" },
  { id: "en_GB-alan-medium",                  label: "Alan — male, English" },
  { id: "en_GB-jenny_dioco-medium",           label: "Jenny (Dioco) — female" },
  { id: "en_GB-alba-medium",                  label: "Alba — female, Scottish" },
  { id: "en_US-amy-medium",                   label: "Amy — female, American" },
  { id: "en_US-ryan-medium",                  label: "Ryan — male, American" },
];
const voiceLabel = (id) => (VOICES.find((v) => v.id === id) || { label: id }).label;

/* ============================== state ============================== */

const LS_MODEL = "th-model-v1";
const LS_CTX = "th-ctx-v1";
const LS_VOICE = "th-voice-v1";
const LS_HIST = "th-hist-v1";
const LS_SET = "th-settings-v1";
const LS_PLACES = "th-places-v1";
const LS_CCTX = "th-cctx-v1";

let model = loadJSON(LS_MODEL) || { contexts: {} };
let hist = loadJSON(LS_HIST) || []; // [{text, t}] newest first
let settings = { name: "", emergency: "", ...(loadJSON(LS_SET) || {}) };
let places = loadJSON(LS_PLACES) || []; // [{id, name, ctx, lat, lon, radius}]
let customCtx = loadJSON(LS_CCTX) || []; // [{id, name, emoji}]
let ctx = localStorage.getItem(LS_CTX) || "general";
if (![...CONTEXTS, ...customCtx.map((c) => ({ id: c.id }))].some((c) => c.id === ctx)) ctx = "general";
let voiceId = localStorage.getItem(LS_VOICE) || VOICES[0].id;
if (!VOICES.some((v) => v.id === voiceId)) voiceId = VOICES[0].id;
let words = [];    // current sentence under construction
let lastText = ""; // last spoken sentence, for "say again"

const $ = (id) => document.getElementById(id);

/* ============================== model / prediction ============================== */

function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function saveModel() {
  localStorage.setItem(LS_MODEL, JSON.stringify(model));
}

// All candidate sentences for a context: seeds (weight 1) merged with
// learned sentences (weight = times spoken), general seeds as fallback pool.
function sentencesFor(context) {
  const out = new Map(); // text -> weight
  for (const s of SEEDS[context] || []) out.set(s, 1);
  for (const s of personalSeeds(context)) out.set(s, 1.2); // personal lines float up a little
  // Blend in general phrases everywhere except Help, which stays urgent-only.
  if (context !== "general" && context !== "help")
    for (const s of SEEDS.general) out.set(s, out.get(s) || 0.5);
  const learned = model.contexts[context]?.sentences || {};
  for (const [text, rec] of Object.entries(learned)) {
    out.set(text, (out.get(text) || 0) + rec.c);
  }
  return out;
}

function predict() {
  const prefix = words.join(" ").toLowerCase();
  const pool = sentencesFor(ctx);

  const nextWords = new Map();   // word -> weight
  const completions = [];        // { text, weight }

  for (const [text, weight] of pool) {
    const lower = text.toLowerCase();
    if (prefix) {
      if (!lower.startsWith(prefix)) continue;
      if (lower.length === prefix.length) continue;      // sentence fully typed
      if (lower[prefix.length] !== " ") continue;        // word-boundary match only
    }
    completions.push({ text, weight });
    const rest = text.slice(prefix ? prefix.length + 1 : 0);
    const next = rest.split(/\s+/)[0];
    if (next) nextWords.set(next, (nextWords.get(next) || 0) + weight);
  }

  // Bigram fallback: nothing matches the whole prefix, so predict from the
  // last word alone using every sentence we know about (custom contexts included).
  if (nextWords.size === 0 && words.length > 0) {
    const last = words[words.length - 1].toLowerCase();
    for (const context of new Set([...Object.keys(SEEDS), ...Object.keys(model.contexts)])) {
      for (const [text, weight] of sentencesFor(context)) {
        const toks = text.split(/\s+/);
        for (let i = 0; i < toks.length - 1; i++) {
          if (toks[i].toLowerCase() === last) {
            const w = toks[i + 1];
            nextWords.set(w, (nextWords.get(w) || 0) + weight);
          }
        }
      }
    }
  }

  completions.sort((a, b) => b.weight - a.weight);
  const wordList = [...nextWords.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w)
    .slice(0, 8);

  return { completions: completions.slice(0, 4), wordList };
}

function learn(text) {
  const c = (model.contexts[ctx] ||= { sentences: {} });
  const rec = (c.sentences[text] ||= { c: 0, t: 0 });
  rec.c += 1;
  rec.t = Date.now();
  saveModel();
}

function pushHistory(text) {
  hist = [{ text, t: Date.now() }, ...hist.filter((h) => h.text !== text)].slice(0, 30);
  localStorage.setItem(LS_HIST, JSON.stringify(hist));
}

/* ============================== rendering ============================== */

function renderContexts() {
  $("contexts").innerHTML = "";
  for (const c of allContexts()) {
    const b = document.createElement("button");
    b.className = "ctx" + (c.id === ctx ? " active" : "") + (c.id === "help" ? " help" : "");
    b.textContent = c.label;
    b.onclick = () => {
      ctx = c.id;
      manualCtx = true; // a deliberate choice beats the geofence for this session
      localStorage.setItem(LS_CTX, ctx);
      renderContexts();
      renderSuggestions();
    };
    $("contexts").appendChild(b);
  }
}

function renderSentence() {
  const bar = $("sentenceBar");
  bar.innerHTML = "";
  if (words.length === 0) {
    const p = document.createElement("span");
    p.className = "placeholder";
    p.textContent = "Tap words below to build a sentence…";
    bar.appendChild(p);
  } else {
    words.forEach((w, i) => {
      const t = document.createElement("span");
      t.className = "token";
      t.textContent = w;
      t.title = "Remove this word and everything after it";
      t.onclick = () => { words = words.slice(0, i); refresh(); };
      bar.appendChild(t);
    });
  }
  const btns = document.createElement("span");
  btns.id = "barBtns";
  const back = document.createElement("button");
  back.textContent = "⌫";
  back.onclick = () => { words.pop(); refresh(); };
  const clear = document.createElement("button");
  clear.textContent = "✕";
  clear.onclick = () => { words = []; refresh(); };
  btns.append(back, clear);
  bar.appendChild(btns);
}

function renderSuggestions() {
  const { completions, wordList } = predict();

  const compEl = $("completions");
  compEl.innerHTML = "";
  $("completionsHead").textContent = words.length ? "Finish the sentence" : "Say it in one tap";
  for (const c of completions) {
    const b = document.createElement("button");
    b.className = "chip completion";
    const label = document.createElement("span");
    label.textContent = c.text;
    b.appendChild(label);
    const lift = document.createElement("span");
    lift.className = "lift";
    lift.setAttribute("role", "button");
    // SVG rather than a "↑" glyph: arrow characters have lopsided font
    // metrics and refuse to centre vertically in the pill.
    lift.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">' +
      '<path d="M6 10.5V2M2.5 5 6 1.5 9.5 5" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    lift.title = "Put in the sentence bar to add more words";
    lift.onclick = (e) => {
      e.stopPropagation();
      words = c.text.split(/\s+/);
      refresh();
    };
    b.appendChild(lift);
    b.onclick = () => { if (b.dataset.held) { delete b.dataset.held; return; } words = c.text.split(/\s+/); refresh(); speak(); };
    attachLongPressForget(b, c.text);
    compEl.appendChild(b);
  }
  if (completions.length === 0) {
    compEl.innerHTML = '<div class="empty">No saved sentence matches — keep going, it will learn this one.</div>';
  }

  const wordsEl = $("words");
  wordsEl.innerHTML = "";
  for (const w of wordList) {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = w;
    b.onclick = () => { words.push(w); refresh(); };
    wordsEl.appendChild(b);
  }
  if (wordList.length === 0) {
    wordsEl.innerHTML = '<div class="empty">Type the next word below.</div>';
  }
}

function refresh() {
  renderSentence();
  renderSuggestions();
}

// Long-press a suggestion to forget it (learned phrases only - a typo'd sentence would
// otherwise haunt the suggestions forever). The chip flips to an inline confirm.
function attachLongPressForget(chip, text) {
  let timer = 0, x0 = 0, y0 = 0;
  chip.addEventListener("pointerdown", (e) => {
    x0 = e.clientX; y0 = e.clientY;
    timer = setTimeout(() => {
      timer = 0;
      chip.dataset.held = "1";           // swallow the click that follows the release
      const learned = !!model.contexts[ctx]?.sentences[text];
      chip.innerHTML = "";
      chip.classList.add("confirming");
      const q = document.createElement("span");
      q.textContent = learned ? "Forget this phrase?" : "Built-in phrase - it can't be removed.";
      chip.appendChild(q);
      if (learned) {
        const yes = document.createElement("span");
        yes.className = "lift danger";
        yes.setAttribute("role", "button");
        yes.textContent = "Forget";
        yes.onclick = (ev) => { ev.stopPropagation(); forgetPhrase(ctx, text); toast("Forgotten"); renderSuggestions(); };
        chip.appendChild(yes);
      }
      const no = document.createElement("span");
      no.className = "lift";
      no.setAttribute("role", "button");
      no.textContent = learned ? "Keep" : "OK";
      no.onclick = (ev) => { ev.stopPropagation(); renderSuggestions(); };
      chip.appendChild(no);
      setTimeout(() => { if (chip.classList.contains("confirming")) renderSuggestions(); }, 5000);
    }, 600);
  });
  const cancel = (e) => {
    if (timer && e && e.type === "pointermove" && Math.hypot(e.clientX - x0, e.clientY - y0) < 10) return;
    if (timer) { clearTimeout(timer); timer = 0; }
  };
  chip.addEventListener("pointermove", cancel);
  chip.addEventListener("pointerup", () => { if (timer) { clearTimeout(timer); timer = 0; } });
  chip.addEventListener("pointercancel", cancel);
  chip.addEventListener("pointerleave", cancel);
  chip.addEventListener("contextmenu", (e) => e.preventDefault()); // long-press must not open the menu
}

/* ============================== composer ============================== */

function addTyped() {
  const raw = $("freeText").value.trim();
  if (!raw) return;
  words.push(...raw.split(/\s+/));
  $("freeText").value = "";
  refresh();
}
$("addBtn").onclick = addTyped;
$("freeText").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); addTyped(); }
});

/* ============================== audio: cache + piper + fallback ============================== */

// Tiny silent WAV: played synchronously inside the tap gesture so iOS lets us
// swap in the real (async-generated) audio afterwards.
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
const player = $("player");

if ("audioSession" in navigator) {
  try { navigator.audioSession.type = "playback"; } catch {}
}

// --- IndexedDB blob cache -------------------------------------------------
function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open("th-audio", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("clips");
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function cacheGet(key) {
  try {
    const db = await openDB();
    return await new Promise((res) => {
      const req = db.transaction("clips").objectStore("clips").get(key);
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => res(null);
    });
  } catch { return null; }
}
async function cachePut(key, blob) {
  try {
    const db = await openDB();
    db.transaction("clips", "readwrite").objectStore("clips").put(blob, key);
  } catch {}
}

// --- Piper (vits-web) ------------------------------------------------------
let tts = null;              // module, once loaded
let piperReady = false;
let piperFailed = false;

function setVoiceStatus(html) { $("voiceStatus").innerHTML = html; }

async function initPiper() {
  try {
    // Self-hosted vits-web (patched: ONNX runtime and phonemizer WASM load from /lib/,
    // voice models still come from Hugging Face and live in OPFS).
    tts = await import("./lib/vits-web.js");
    await refreshVoiceStatus();
  } catch (e) {
    piperFailed = true;
    setVoiceStatus('<span class="status-warn">device voice</span>');
    console.warn("Piper unavailable, falling back to Web Speech:", e);
  }
}

// The Help tab must never wait on synthesis: as soon as a voice is ready, quietly
// synthesise every Help phrase into the audio cache in the background.
let precaching = false;
async function precacheHelpAudio() {
  if (precaching || !piperReady) return;
  precaching = true;
  try {
    const phrases = [...SEEDS.help, ...personalSeeds("help")];
    for (const text of phrases) {
      if (!piperReady) break;                       // voice switched away mid-run
      const key = voiceId + "|" + text.toLowerCase();
      if (await cacheGet(key)) continue;
      const blob = await tts.predict({ text, voiceId });
      await cachePut(key, blob);
      await new Promise((r) => setTimeout(r, 250)); // keep the UI responsive
    }
  } catch (e) {
    console.warn("Help pre-cache stopped:", e);
  } finally {
    precaching = false;
  }
}

// Re-evaluate whether the currently selected voice is downloaded.
async function refreshVoiceStatus() {
  if (!tts) return;
  piperReady = false;
  const stored = await tts.stored();
  if (stored.includes(voiceId)) {
    piperReady = true;
    setVoiceStatus('<span class="status-ok">● ready</span>');
    precacheHelpAudio();
  } else {
    setVoiceStatus('<button id="dlVoice">Download (~60 MB)</button>');
    $("dlVoice").onclick = downloadVoice;
  }
}

let downloading = false;
async function downloadVoice() {
  if (downloading || !tts) return;
  downloading = true;
  const wanted = voiceId;
  setVoiceStatus("downloading… 0%");
  try {
    await tts.download(wanted, (p) => {
      if (voiceId !== wanted) return;
      // The HF CDN sometimes streams without a content-length; fall back to MB counted.
      setVoiceStatus(p.total
        ? `downloading… ${Math.round((p.loaded / p.total) * 100)}%`
        : `downloading… ${Math.round(p.loaded / 1048576)} MB`);
    });
  } catch (e) {
    console.warn("Voice download failed:", e);
    if (voiceId === wanted) {
      setVoiceStatus('<span class="status-warn">download failed</span>');
      downloading = false;
      return;
    }
  }
  downloading = false;
  await refreshVoiceStatus();
}

function renderVoices() {
  const sel = $("voiceSel");
  sel.innerHTML = "";
  for (const v of VOICES) {
    const o = document.createElement("option");
    o.value = v.id;
    o.textContent = v.label;
    o.selected = v.id === voiceId;
    sel.appendChild(o);
  }
  sel.onchange = () => {
    voiceId = sel.value;
    localStorage.setItem(LS_VOICE, voiceId);
    refreshVoiceStatus();
  };
}

// A ~5 s pre-rendered sample per voice, so nobody commits to a 60 MB download blind.
$("voicePlay").onclick = async () => {
  player.src = `samples/${voiceId}.wav`;
  try { await player.play(); } catch { toast("No preview available for this voice.", true); }
};

// --- speak -----------------------------------------------------------------
function webSpeech(text) {
  const u = new SpeechSynthesisUtterance(text);
  const v = speechSynthesis.getVoices().find((v) => v.lang.startsWith("en-GB"))
         || speechSynthesis.getVoices().find((v) => v.lang.startsWith("en"));
  if (v) u.voice = v;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

// Audio pipeline only — no learning, no UI mutation. Reused by "say again".
async function speakText(text) {
  // Unlock the audio element inside the tap gesture (iOS requirement).
  player.src = SILENT_WAV;
  player.play().catch(() => {});

  try {
    const key = voiceId + "|" + text.toLowerCase();
    let blob = await cacheGet(key);
    if (!blob && piperReady) {
      blob = await tts.predict({ text, voiceId });
      cachePut(key, blob);
    }
    if (blob) {
      player.src = URL.createObjectURL(blob);
      await player.play();
    } else {
      webSpeech(text); // model not downloaded / unavailable
    }
  } catch (e) {
    console.warn("Neural speak failed, using device voice:", e);
    webSpeech(text);
  }
}

// Take the composed sentence: learn it, show it, say it, and clear the bar
// so the app is immediately ready for the next sentence.
function takeSentence() {
  if ($("freeText").value.trim()) addTyped();
  const text = words.join(" ");
  if (!text) return null;
  lastText = text;
  learn(text);
  pushHistory(text);
  words = [];
  refresh();
  showOverlay(text);
  return text;
}

async function speak() {
  const text = takeSentence();
  if (!text) return;
  const btn = $("speakBtn");
  btn.classList.add("busy");
  try { await speakText(text); } finally { btn.classList.remove("busy"); }
}

$("speakBtn").onclick = speak;
$("againBtn").onclick = (e) => {
  e.stopPropagation(); // keep the overlay open
  if (lastText) speakText(lastText);
};

/* ============================== big-text overlay ============================== */

function showOverlay(text) {
  $("overlayText").textContent = text;
  $("overlay").classList.add("show");
}
$("overlay").onclick = () => $("overlay").classList.remove("show");
$("showBtn").onclick = () => takeSentence();

/* ============================== history sheet ============================== */

function timeAgo(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + " min ago";
  if (m < 60 * 24) return Math.round(m / 60) + " hr ago";
  return new Date(t).toLocaleDateString();
}

function renderHistory() {
  const list = $("histList");
  list.innerHTML = "";
  if (hist.length === 0) {
    list.innerHTML = '<div class="empty">Nothing said yet.</div>';
    return;
  }
  for (const h of hist) {
    const b = document.createElement("button");
    b.className = "histItem";
    b.textContent = h.text;
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = timeAgo(h.t);
    b.appendChild(when);
    b.onclick = () => {
      $("histPanel").classList.remove("show");
      lastText = h.text;
      showOverlay(h.text);
      speakText(h.text); // no learn(): repeating isn't a new use
    };
    list.appendChild(b);
  }
}

$("histBtn").onclick = () => { renderHistory(); $("histPanel").classList.add("show"); };
$("histPanel").onclick = (e) => {
  if (e.target.id === "histPanel") $("histPanel").classList.remove("show");
};

/* ============================== toast ============================== */

let toastTimer = 0;
function toast(msg, isError = false) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.toggle("error", isError);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), isError ? 4000 : 2600);
}

/* ============================== settings sheet ============================== */

function saveSettings() { localStorage.setItem(LS_SET, JSON.stringify(settings)); }
function savePlaces() { localStorage.setItem(LS_PLACES, JSON.stringify(places)); }

const EMERGENCY_NUMBERS = ["", "000", "999", "911", "112", "111"];

function renderSettings() {
  $("setName").value = settings.name;
  const sel = $("setEmergency");
  sel.innerHTML = "";
  for (const n of EMERGENCY_NUMBERS) {
    const o = document.createElement("option");
    o.value = n;
    o.textContent = n === "" ? "None - no number in phrases" : n;
    o.selected = n === settings.emergency;
    sel.appendChild(o);
  }
  const list = $("placesList");
  list.innerHTML = "";
  if (places.length === 0) {
    list.innerHTML = '<div class="empty">No saved places. Add one and the matching context opens by itself when you arrive.</div>';
  }
  for (const p of places) {
    const row = document.createElement("div");
    row.className = "placeRow";
    const label = document.createElement("span");
    label.textContent = `${p.name} → ${contextLabel(p.ctx)} (${p.radius} m)`;
    const del = document.createElement("button");
    del.textContent = "✕";
    del.title = "Remove this place";
    del.onclick = () => { places = places.filter((x) => x !== p); savePlaces(); renderSettings(); };
    row.append(label, del);
    list.appendChild(row);
  }
  renderCustomCtxList();
  renderPhraseManager();
  renderVoiceStore();
}

/* ---- custom contexts ---- */

function saveCustomCtx() { localStorage.setItem(LS_CCTX, JSON.stringify(customCtx)); }

function renderCustomCtxList() {
  const list = $("ctxList");
  list.innerHTML = "";
  if (customCtx.length === 0) {
    list.innerHTML = '<div class="empty">No extra tabs yet. Add one (say, Work or School run) and it learns its own phrases.</div>';
  }
  for (const c of customCtx) {
    const row = document.createElement("div");
    row.className = "placeRow";
    const label = document.createElement("span");
    const n = Object.keys(model.contexts[c.id]?.sentences || {}).length;
    label.textContent = `${c.emoji || "⭐"} ${c.name}${n ? ` (${n} learned phrase${n === 1 ? "" : "s"})` : ""}`;
    const del = document.createElement("button");
    del.textContent = "✕";
    del.title = "Remove this tab";
    del.onclick = () => {
      const n2 = Object.keys(model.contexts[c.id]?.sentences || {}).length;
      if (!confirm(`Remove the "${c.name}" tab${n2 ? ` and its ${n2} learned phrase${n2 === 1 ? "" : "s"}` : ""}?`)) return;
      customCtx = customCtx.filter((x) => x !== c);
      saveCustomCtx();
      delete model.contexts[c.id];
      saveModel();
      places = places.filter((p) => p.ctx !== c.id);   // geofences pointing at it go too
      savePlaces();
      if (ctx === c.id) { ctx = "general"; localStorage.setItem(LS_CTX, ctx); }
      renderContexts();
      renderSuggestions();
      renderSettings();
    };
    row.append(label, del);
    list.appendChild(row);
  }
}

$("addCtxBtn").onclick = () => {
  const name = $("ctxName").value.trim();
  if (!name) { $("ctxName").focus(); return; }
  const emoji = $("ctxEmoji").value.trim().slice(0, 4);
  customCtx.push({ id: "c-" + crypto.randomUUID(), name, emoji });
  saveCustomCtx();
  $("ctxName").value = "";
  $("ctxEmoji").value = "";
  renderContexts();
  renderSettings();
  toast(`Added "${name}"`);
};

/* ---- learned-phrase manager ---- */

function forgetPhrase(context, text) {
  const c = model.contexts[context];
  if (!c || !c.sentences[text]) return false;
  delete c.sentences[text];
  saveModel();
  return true;
}

function renderPhraseManager() {
  const sel = $("phraseCtx");
  const prev = sel.value;
  sel.innerHTML = "";
  for (const c of allContexts()) {
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = c.label;
    sel.appendChild(o);
  }
  sel.value = allContexts().some((c) => c.id === prev) ? prev : ctx;
  const list = $("phraseList");
  list.innerHTML = "";
  const learned = Object.entries(model.contexts[sel.value]?.sentences || {}).sort((a, b) => b[1].c - a[1].c);
  if (learned.length === 0) {
    list.innerHTML = '<div class="empty">Nothing learned in this tab yet. Everything you speak lands here, most-used first.</div>';
    return;
  }
  for (const [text, rec] of learned) {
    const row = document.createElement("div");
    row.className = "placeRow";
    const label = document.createElement("span");
    label.textContent = `${text} `;
    const count = document.createElement("small");
    count.className = "when";
    count.textContent = `×${rec.c}`;
    label.appendChild(count);
    const del = document.createElement("button");
    del.textContent = "✕";
    del.title = "Forget this phrase";
    del.onclick = () => { forgetPhrase(sel.value, text); renderPhraseManager(); renderSuggestions(); };
    row.append(label, del);
    list.appendChild(row);
  }
}
$("phraseCtx").addEventListener("change", renderPhraseManager);

/* ---- downloaded-voice manager ---- */

async function renderVoiceStore() {
  const list = $("voiceStore");
  list.innerHTML = "";
  if (!tts) {
    list.innerHTML = '<div class="empty">Neural voices are unavailable on this device - the built-in voice is used instead.</div>';
    return;
  }
  let stored = [];
  try { stored = await tts.stored(); } catch { /* leave empty */ }
  if (stored.length === 0) {
    list.innerHTML = '<div class="empty">No voices downloaded yet - pick one at the top and tap Download.</div>';
  }
  for (const id of stored) {
    const row = document.createElement("div");
    row.className = "placeRow";
    const label = document.createElement("span");
    label.textContent = voiceLabel(id) + (id === voiceId ? " · in use" : "");
    const del = document.createElement("button");
    del.textContent = "✕";
    del.title = "Remove this voice from the device";
    del.onclick = async () => {
      if (!confirm(`Remove "${voiceLabel(id)}" (~60 MB)? It can be downloaded again any time.`)) return;
      try { await tts.remove(id); } catch (e) { toast(`Couldn't remove: ${e.message}`, true); return; }
      await refreshVoiceStatus();
      renderVoiceStore();
    };
    row.append(label, del);
    list.appendChild(row);
  }
  if (navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      const note = document.createElement("div");
      note.className = "empty";
      note.textContent = `This site is using about ${Math.max(1, Math.round((est.usage || 0) / 1048576))} MB of browser storage in total.`;
      list.appendChild(note);
    } catch { /* fine without */ }
  }
}

$("setName").addEventListener("change", () => {
  settings.name = $("setName").value.trim();
  saveSettings();
  renderSuggestions();
});
$("setEmergency").addEventListener("change", () => {
  settings.emergency = $("setEmergency").value;
  saveSettings();
  renderSuggestions();
});

$("addPlaceBtn").onclick = () => {
  if (!navigator.geolocation) { toast("This device can't give a location.", true); return; }
  const name = $("placeName").value.trim();
  if (!name) { $("placeName").focus(); return; }
  const b = $("addPlaceBtn");
  b.disabled = true;
  b.textContent = "Locating…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      places.push({
        id: crypto.randomUUID(),
        name,
        ctx: $("placeCtx").value,
        lat: +pos.coords.latitude.toFixed(6),
        lon: +pos.coords.longitude.toFixed(6),
        radius: parseInt($("placeRadius").value, 10),
      });
      savePlaces();
      $("placeName").value = "";
      renderSettings();
      b.disabled = false;
      b.textContent = "📍 Save this location";
      toast(`Saved "${name}"`);
    },
    () => {
      b.disabled = false;
      b.textContent = "📍 Save this location";
      toast("Couldn't get a location - check permission.", true);
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
  );
};

$("setBtn").onclick = () => {
  // Rebuild the place-context picker each open: custom tabs may have changed.
  const pc = $("placeCtx");
  const prev = pc.value;
  pc.innerHTML = "";
  for (const c of allContexts()) {
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = c.label;
    o.selected = prev ? c.id === prev : c.id === "home";
    pc.appendChild(o);
  }
  renderSettings();
  $("setPanel").classList.add("show");
};
$("setPanel").onclick = (e) => {
  if (e.target.id === "setPanel") $("setPanel").classList.remove("show");
};

/* ============================== export / import ============================== */

$("exportBtn").onclick = async () => {
  const payload = {
    app: "talkinghurts.com",
    schema: 1,
    exported: new Date().toISOString(),
    model, hist, settings, places, customCtx,
  };
  const stamp = new Date().toISOString().slice(0, 10);
  const file = new File([JSON.stringify(payload, null, 1)], `talking-hurts-${stamp}.json`, { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "Talking Hurts backup" }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};

$("importBtn").onclick = () => $("importFile").click();
$("importFile").addEventListener("change", async () => {
  const f = $("importFile").files[0];
  $("importFile").value = "";
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== "talkinghurts.com" || d.schema !== 1) throw new Error("not a Talking Hurts backup");
    let phrases = 0;
    // Merge, never overwrite: counts add up, so phone + PC learning combine.
    for (const [cid, c] of Object.entries(d.model?.contexts || {})) {
      const mine = (model.contexts[cid] ||= { sentences: {} });
      for (const [text, rec] of Object.entries(c.sentences || {})) {
        const r = (mine.sentences[text] ||= { c: 0, t: 0 });
        r.c += rec.c || 0;
        r.t = Math.max(r.t, rec.t || 0);
        phrases++;
      }
    }
    saveModel();
    const seen = new Set(hist.map((h) => h.text));
    for (const h of d.hist || []) if (h && h.text && !seen.has(h.text)) hist.push({ text: h.text, t: h.t || 0 });
    hist.sort((a, b) => b.t - a.t);
    hist = hist.slice(0, 30);
    localStorage.setItem(LS_HIST, JSON.stringify(hist));
    if (d.settings) {
      if (!settings.name && d.settings.name) settings.name = d.settings.name;
      if (!settings.emergency && d.settings.emergency) settings.emergency = d.settings.emergency;
      saveSettings();
    }
    const ctxIds = new Set(customCtx.map((c) => c.id)), ctxNames = new Set(customCtx.map((c) => c.name));
    for (const c of d.customCtx || []) {
      if (c && c.id && c.name && !ctxIds.has(c.id) && !ctxNames.has(c.name)) {
        customCtx.push({ id: c.id, name: c.name, emoji: c.emoji || "" });
      }
    }
    saveCustomCtx();
    const names = new Set(places.map((p) => p.name));
    for (const p of d.places || []) {
      if (p && p.name && !names.has(p.name) && Number.isFinite(p.lat) && Number.isFinite(p.lon)) {
        places.push({ id: p.id || crypto.randomUUID(), name: p.name, ctx: p.ctx, lat: p.lat, lon: p.lon, radius: p.radius || 150 });
      }
    }
    savePlaces();
    renderContexts();
    renderSettings();
    renderSuggestions();
    toast(`Imported ${phrases} learned phrase${phrases === 1 ? "" : "s"}`);
  } catch (e) {
    toast(`Import failed: ${e.message}`, true);
  }
});

/* ============================== geofencing (foreground only) ============================== */

let manualCtx = false;
let lastGeoCheck = 0;

function distM(aLat, aLon, bLat, bLon) {
  const R = 6371000, d = Math.PI / 180;
  const x = (bLon - aLon) * d * Math.cos(((aLat + bLat) / 2) * d);
  const y = (bLat - aLat) * d;
  return Math.hypot(x, y) * R;
}

// On open (and when the tab comes back into view) quietly ask where we are; if a saved
// place matches, switch to its context. A manual context choice wins for the session.
// No saved places = no location request at all.
function geoCheck() {
  if (!places.length || manualCtx || !navigator.geolocation) return;
  if (Date.now() - lastGeoCheck < 60000) return;
  lastGeoCheck = Date.now();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      let best = null, bestD = Infinity;
      for (const p of places) {
        const dd = distM(pos.coords.latitude, pos.coords.longitude, p.lat, p.lon);
        if (dd <= p.radius && dd < bestD) { best = p; bestD = dd; }
      }
      if (best && best.ctx !== ctx && allContexts().some((c) => c.id === best.ctx)) {
        ctx = best.ctx;
        localStorage.setItem(LS_CTX, ctx);
        renderContexts();
        renderSuggestions();
        toast(`📍 ${best.name}`);
      }
    },
    () => {}, // denied or unavailable: stay quiet
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 },
  );
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) geoCheck(); });

/* ============================== boot ============================== */

// iOS loads voices asynchronously; poke the list early so the fallback works.
speechSynthesis?.getVoices();

renderContexts();
renderVoices();
refresh();
initPiper();
geoCheck();

// Ask the browser to protect our storage from eviction (iOS clears "unused" site data
// after 7 days without this; installed PWAs plus persist() keep the learned model safe).
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

// Offline shell + installability.
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
