// Wires the Helper panel to the callable helperAsk function.
// The browser sends the question only. It does not send jobs, money, or a tenant id.
// No API key is read here. Speech stays in helper.js.

import { mountHelper } from "./helper.js";

const REGION = "australia-southeast1";
let functionsPromise = null;

function functionsFor(app, useEmulator) {
  if (!functionsPromise) {
    functionsPromise = import("https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js").then(mod => {
      const functions = mod.getFunctions(app, REGION);
      if (useEmulator) mod.connectFunctionsEmulator(functions, "127.0.0.1", 5001);
      return { functions, httpsCallable: mod.httpsCallable };
    });
  }
  return functionsPromise;
}

async function callHelper({ app, useEmulator, payload }) {
  try {
    const { functions, httpsCallable } = await functionsFor(app, useEmulator);
    const call = httpsCallable(functions, "helperAsk");
    const res = await call(payload);
    const data = res && res.data || {};
    const proposal = data.proposal && data.proposal.id ? {
      id: String(data.proposal.id),
      title: String(data.proposal.title || "Preview"),
      lines: Array.isArray(data.proposal.lines) ? data.proposal.lines.map(line => String(line)) : [],
    } : null;
    return {
      ok: true,
      reply: typeof data.reply === "string" ? data.reply : "",
      enabled: data.enabled === true,
      knowledge: data.knowledge || "",
      proposal,
    };
  } catch (error) {
    const code = String(error && error.code || "");
    if (code.includes("unauthenticated")) return { ok: false, reply: "Sign in to use Helper." };
    return { ok: false, reply: "I couldn't reach Helper. Nothing was changed." };
  }
}

export function installHelperApp({ app, useEmulator, getMe } = {}) {
  let root = document.getElementById("helper-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "helper-root";
    document.body.appendChild(root);
  }
  const synth = window.speechSynthesis || null;
  const ui = mountHelper(root, {
    storage: window.localStorage,
    synth,
    getVoices: () => synth && synth.getVoices ? synth.getVoices() : [],
    onVoicesChanged(cb) { synth && synth.addEventListener && synth.addEventListener("voiceschanged", cb); },
    ask: question => callHelper({ app, useEmulator, payload: { question } }),
    confirm: proposalId => callHelper({ app, useEmulator, payload: { step: "confirm", proposalId } }),
    cancel: proposalId => callHelper({ app, useEmulator, payload: { step: "cancel", proposalId } }),
    speechScope: globalThis,
  });
  return {
    async start() {
      const on = !!(getMe && getMe() && getMe().uid);
      ui.setSignedIn(on);
      if (!on) return;
      const status = await callHelper({ app, useEmulator, payload: { step: "status" } });
      ui.setSignedIn(true);
      ui.setAvailable(!!(status && status.ok && status.enabled));
    },
    stop() { ui.setSignedIn(false); },
  };
}
