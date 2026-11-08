// CallUp Helper panel. Chat, spoken replies, and optional voice input.
// Spoken replies use speechSynthesis and an en-AU voice, and never start by themselves.
// Voice input uses the Web Speech API when the browser has it. It does not open a media stream.
// This module does not call Firebase and does not write jobs.

export const AU_VOICE_MISSING = "Australian voice not available on this device";
export const MIC_MISSING = "Voice input isn't available in this browser. Type the question instead.";
export const SPEECH_STORAGE_KEY = "hwHelperSpeech";
export const KNOWLEDGE_PLACEHOLDER_NOTE = "How-to answers use a short placeholder until the CallUp knowledge pack is added.";
export const UNREACHABLE = "I couldn't reach Helper. Nothing was changed.";

export function shouldAutoRead() {
  return false;
}

export function isAustralianVoice(voice) {
  const lang = String(voice && voice.lang || "").trim().replaceAll("_", "-").toLowerCase();
  return lang === "en-au";
}

export function pickAustralianVoice(voices) {
  const list = Array.isArray(voices) ? voices : [];
  return list.find(isAustralianVoice) || null;
}

export function speechStatus(voices, optedIn) {
  if (!optedIn) return { optedIn: false, voice: null, notice: "" };
  const voice = pickAustralianVoice(voices);
  if (!voice) return { optedIn: true, voice: null, notice: AU_VOICE_MISSING };
  return { optedIn: true, voice, notice: "" };
}

export function readSpeechOptIn(storage) {
  try { return !!storage && storage.getItem(SPEECH_STORAGE_KEY) === "1"; }
  catch { return false; }
}

export function speakReply({ synth, voice, text, onend, Utterance } = {}) {
  if (!isAustralianVoice(voice)) return { spoken: false, notice: AU_VOICE_MISSING };
  const Ctor = Utterance || globalThis.SpeechSynthesisUtterance;
  if (!Ctor || !synth || typeof synth.speak !== "function") return { spoken: false, notice: AU_VOICE_MISSING };
  const utter = new Ctor(String(text || ""));
  utter.lang = "en-AU";
  utter.voice = voice;
  if (onend) utter.onend = onend;
  synth.cancel();
  synth.speak(utter);
  return { spoken: true, notice: "", utterance: utter };
}

export function dictationSupported(scope = globalThis) {
  return !!(scope && (scope.SpeechRecognition || scope.webkitSpeechRecognition));
}

export function openDictation(scope, { ontext, onend, onerror, lang = "en-AU" } = {}) {
  const Ctor = scope && (scope.SpeechRecognition || scope.webkitSpeechRecognition);
  if (!Ctor) return { ok: false, reason: "unsupported" };
  let rec;
  try { rec = new Ctor(); }
  catch { return { ok: false, reason: "unsupported" }; }
  rec.lang = lang;
  rec.interimResults = false;
  rec.continuous = false;
  rec.onresult = event => {
    const text = Array.from(event.results || []).map(row => (row[0] && row[0].transcript) || "").join(" ").trim();
    if (text && ontext) ontext(text);
  };
  rec.onerror = () => { if (onerror) onerror(); };
  rec.onend = () => { if (onend) onend(); };
  try { rec.start(); }
  catch { return { ok: false, reason: "failed" }; }
  return {
    ok: true,
    stop() { try { rec.stop(); } catch { /* already stopped */ } },
  };
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

export function helperShellHtml(state) {
  if (!state.signedIn || !state.available) return "";
  const speech = speechStatus(state.voices, state.speech);
  const launch = state.open ? "" : `<button type="button" class="helper-launch" data-act="open">Helper</button>`;
  if (!state.open) return launch;
  const note = speech.notice ? `<p class="helper-voice-note" role="status">${esc(speech.notice)}</p>` : "";
  const knowledge = state.knowledge === "placeholder" ? `<p class="helper-know">${esc(KNOWLEDGE_PLACEHOLDER_NOTE)}</p>` : "";
  const pending = state.pending ? `<p class="helper-pending">Just a tick…</p>` : "";
  const error = state.error ? `<p class="helper-error" role="status">${esc(state.error)}</p>` : "";
  const messages = (state.messages || []).map((message, index) => {
    const mine = message.role === "user";
    const controls = !mine && speech.voice
      ? `<div class="helper-speak"><button type="button" data-act="play" data-i="${index}" aria-pressed="${state.playing === index ? "true" : "false"}">Play</button><button type="button" data-act="stop" data-i="${index}">Stop</button></div>`
      : "";
    const card = !mine && message.proposal && !message.proposal.done
      ? `<section class="helper-card"><h3>${esc(message.proposal.title)}</h3><ul>${(message.proposal.lines || []).map(line => `<li>${esc(line)}</li>`).join("")}</ul><p>Nothing is saved until you tap Confirm.</p><div class="helper-card-btns"><button type="button" data-act="confirm" data-proposal="${esc(message.proposal.id)}">Confirm</button><button type="button" data-act="cancel" data-proposal="${esc(message.proposal.id)}">Cancel</button></div></section>`
      : "";
    return `<article class="helper-msg ${mine ? "helper-me" : "helper-bot"}${state.playing === index ? " is-playing" : ""}"><p class="helper-text">${esc(message.text)}</p>${card}${controls}</article>`;
  }).join("");
  return `${launch}<section class="helper-panel" role="dialog" aria-label="Helper" data-open="1">
    <header class="helper-head">
      <div><h2>Helper</h2><p>I'll show a preview before I change anything.</p>${knowledge}</div>
      <button type="button" class="helper-x" data-act="close" aria-label="Close helper">×</button>
    </header>
    <label class="helper-opt"><input class="helper-speech" type="checkbox" ${state.speech ? "checked" : ""}> Spoken replies</label>
    ${note}
    <div class="helper-log" aria-live="polite">${messages}${pending}${error}</div>
    <form class="helper-form">
      <label class="sr" for="helper-q">Ask Helper</label>
      <textarea id="helper-q" class="helper-input" rows="2" maxlength="2000" placeholder="Ask about CallUp, or about your jobs" autocomplete="off"></textarea>
      <button type="submit" class="helper-send" ${state.pending ? "disabled" : ""}>Send</button>
      ${state.dictationSupported
        ? `<button type="button" class="helper-mic" data-act="mic" aria-pressed="${state.listening ? "true" : "false"}">${state.listening ? "Stop" : "Mic"}</button>`
        : `<button type="button" class="helper-mic" disabled title="${esc(MIC_MISSING)}">Mic</button>`}
    </form>
  </section>`;
}

export function mountHelper(root, opts = {}) {
  const storage = opts.storage || null;
  const synth = opts.synth || null;
  const getVoices = () => {
    try { return opts.getVoices ? opts.getVoices() : []; }
    catch { return []; }
  };
  const state = {
    signedIn: !!opts.signedIn,
    open: !!opts.startOpen,
    speech: readSpeechOptIn(storage),
    voices: getVoices(),
    messages: [],
    draft: "",
    pending: false,
    error: "",
    playing: null,
    knowledge: opts.knowledge || "",
    available: !!opts.available,
    dictationSupported: opts.dictationSupported != null ? !!opts.dictationSupported : dictationSupported(opts.speechScope || globalThis),
    listening: false,
  };
  let dictation = null;

  function paint() {
    state.voices = getVoices();
    root.innerHTML = helperShellHtml(state);
    root.dataset.signed = state.signedIn ? "1" : "0";
    const next = root.querySelector(".helper-input");
    if (next) next.value = state.draft;
    const log = root.querySelector(".helper-log");
    if (log) log.scrollTop = log.scrollHeight;
  }

  async function send() {
    const question = state.draft.trim();
    if (!question || state.pending) return;
    if (question.length > 2000) {
      state.error = "Keep the question under 2000 characters.";
      paint();
      return;
    }
    state.messages.push({ role: "user", text: question });
    state.draft = "";
    state.pending = true;
    state.error = "";
    paint();
    let result;
    try {
      result = await opts.ask(question);
    } catch {
      result = { ok: false, reply: UNREACHABLE };
    }
    state.pending = false;
    state.knowledge = result && result.knowledge ? result.knowledge : state.knowledge;
    const reply = result && result.reply ? String(result.reply) : UNREACHABLE;
    const proposal = result && result.proposal && result.proposal.id ? result.proposal : null;
    state.messages.push({ role: "assistant", text: reply.slice(0, 4000), proposal });
    paint();
  }

  async function settle(kind, id) {
    const message = state.messages.find(item => item.proposal && item.proposal.id === id && !item.proposal.done);
    if (!message || state.pending) return;
    message.proposal.done = true;
    state.pending = true;
    paint();
    let result;
    try {
      const fn = kind === "confirm" ? opts.confirm : opts.cancel;
      result = fn ? await fn(id) : { reply: UNREACHABLE };
    } catch {
      result = { reply: UNREACHABLE };
    }
    state.pending = false;
    message.proposal = null;
    state.messages.push({ role: "assistant", text: String(result && result.reply || UNREACHABLE).slice(0, 4000) });
    paint();
  }

  function play(index) {
    const message = state.messages[index];
    if (!message || message.role === "user") return;
    const status = speechStatus(getVoices(), true);
    if (!status.voice) {
      state.speech = true;
      state.playing = null;
      paint();
      return;
    }
    const result = speakReply({
      synth,
      voice: status.voice,
      text: message.text,
      Utterance: opts.Utterance,
      onend: () => {
        if (state.playing === index) {
          state.playing = null;
          paint();
        }
      },
    });
    state.playing = result.spoken ? index : null;
    paint();
  }

  function toggleMic() {
    if (!state.dictationSupported) {
      state.error = MIC_MISSING;
      paint();
      return;
    }
    if (state.listening) {
      dictation?.stop?.();
      state.listening = false;
      dictation = null;
      paint();
      return;
    }
    const session = openDictation(opts.speechScope || globalThis, {
      ontext(text) {
        state.draft = (state.draft ? state.draft.replace(/\s*$/, " ") : "") + text;
        state.error = "";
        paint();
      },
      onerror() {
        state.listening = false;
        state.error = MIC_MISSING;
        dictation = null;
        paint();
      },
      onend() {
        state.listening = false;
        dictation = null;
        paint();
      },
    });
    if (!session.ok) {
      state.error = MIC_MISSING;
      paint();
      return;
    }
    dictation = session;
    state.listening = true;
    state.error = "";
    paint();
  }

  root.addEventListener("click", event => {
    const target = event.target.closest("[data-act]");
    if (!target || !root.contains(target)) return;
    const act = target.dataset.act;
    if (act === "open") { state.open = true; paint(); }
    if (act === "close") {
      state.open = false;
      state.playing = null;
      synth?.cancel?.();
      paint();
    }
    if (act === "play") play(Number(target.dataset.i));
    if (act === "stop") {
      synth?.cancel?.();
      state.playing = null;
      paint();
    }
    if (act === "confirm" || act === "cancel") settle(act, target.dataset.proposal);
    if (act === "mic") toggleMic();
  });
  root.addEventListener("change", event => {
    if (!event.target.matches(".helper-speech")) return;
    state.speech = !!event.target.checked;
    state.playing = null;
    synth?.cancel?.();
    try { storage?.setItem(SPEECH_STORAGE_KEY, state.speech ? "1" : "0"); } catch { /* private mode */ }
    paint();
  });
  root.addEventListener("submit", event => {
    if (!event.target.matches(".helper-form")) return;
    event.preventDefault();
    const input = root.querySelector(".helper-input");
    if (input) state.draft = input.value;
    send();
  });
  root.addEventListener("input", event => {
    if (event.target.matches(".helper-input")) state.draft = event.target.value;
  });
  if (opts.onVoicesChanged) opts.onVoicesChanged(() => { if (state.speech) paint(); });
  paint();
  return {
    setSignedIn(on) {
      state.signedIn = !!on;
      if (!state.signedIn) {
        state.open = false;
        state.available = false;
        state.listening = false;
        dictation?.stop?.();
        dictation = null;
        state.playing = null;
        synth?.cancel?.();
      }
      paint();
    },
    setAvailable(on) {
      state.available = !!on;
      if (!state.available) {
        state.open = false;
        state.listening = false;
        dictation?.stop?.();
        dictation = null;
      }
      paint();
    },
    open() { state.open = true; paint(); },
    close() { state.open = false; state.playing = null; synth?.cancel?.(); paint(); },
  };
}
