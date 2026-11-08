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

async function askHelper({ app, useEmulator, question }) {
  try {
    const { functions, httpsCallable } = await functionsFor(app, useEmulator);
    const call = httpsCallable(functions, "helperAsk");
    const res = await call({ question });
    const data = res && res.data || {};
    return {
      ok: true,
      reply: typeof data.reply === "string" ? data.reply : "",
      enabled: data.enabled !== false,
      knowledge: data.knowledge || "",
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
    ask: question => askHelper({ app, useEmulator, question }),
  });
  return {
    start() { ui.setSignedIn(!!(getMe && getMe() && getMe().uid)); },
    stop() { ui.setSignedIn(false); },
  };
}
