// Desktop browsers can install CallUp from Chrome or Edge, or download the Windows program.
// Leave WINDOWS_DOWNLOAD_URL empty to hide Download for Windows. Set it to an https link
// (the GitHub release page, or the installer file) when that download should be offered.
// Phones, an installed window, and the CallUp Windows program do not show this.

export const WINDOWS_DOWNLOAD_URL = "https://github.com/Heartwoodew/heartwood-jobs/releases/download/desktop-v0.1.0/CallUp_0.1.0_x64-setup.exe";

const HTTPS = /^https:\/\//i;

export function readDesktopEnv(env = {}) {
  const nav = env.navigator || (typeof navigator !== "undefined" ? navigator : {});
  const win = env.window || (typeof window !== "undefined" ? window : {});
  const ua = String(env.userAgent ?? nav.userAgent ?? "");
  const platform = String(env.platform ?? nav.platform ?? "");
  const touch = Number(env.maxTouchPoints ?? nav.maxTouchPoints ?? 0);
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const ipadOs = platform === "MacIntel" && touch > 1;
  let displayMode = env.displayMode || "";
  if (!displayMode && win.matchMedia) {
    if (win.matchMedia("(display-mode: standalone)").matches || win.matchMedia("(display-mode: window-controls-overlay)").matches || win.matchMedia("(display-mode: minimal-ui)").matches) displayMode = "standalone";
    else displayMode = "browser";
  }
  const standalone = displayMode === "standalone" || displayMode === "minimal-ui" || nav.standalone === true || env.iosStandalone === true;
  const tauri = env.tauri === true || win.__CALLUP_DESKTOP__ === true;
  return {
    desktopBrowser: !mobileUa && !ipadOs && !standalone && !tauri,
    mobile: mobileUa || ipadOs,
    standalone,
    tauri,
  };
}

export function safeDownloadUrl(url) {
  const text = String(url || "").trim();
  if (!HTTPS.test(text)) return "";
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "https:") return "";
    if (parsed.username || parsed.password) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

export function desktopInstallModel({ env, promptReady = false, downloadUrl = WINDOWS_DOWNLOAD_URL } = {}) {
  const surface = readDesktopEnv(env || {});
  const downloadHref = safeDownloadUrl(downloadUrl);
  if (!surface.desktopBrowser) return { show: false, install: false, downloadHref: "" };
  const install = !!promptReady;
  return { show: install || !!downloadHref, install, downloadHref };
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function desktopInstallHtml(model) {
  if (!model || !model.show) return "";
  const lines = [];
  if (model.install) lines.push("Install on this PC opens CallUp in its own window from this browser.");
  if (model.downloadHref) lines.push("Download for Windows is the CallUp program.");
  const install = model.install ? `<button type="button" class="primary" id="desktopinstallbtn">Install on this PC</button>` : "";
  const download = model.downloadHref
    ? `<a class="ghost" id="desktopdownload" href="${esc(model.downloadHref)}" target="_blank" rel="noopener">Download for Windows</a>`
    : "";
  return `<div class="card desktop-install-card">
    <p><b>CallUp on this computer</b></p>
    <p class="sub">${lines.map(esc).join(" ")}</p>
    <div class="btns">${install}${download}<button type="button" class="ghost" id="desktopinstallhide">Not now</button></div>
  </div>`;
}

let repaintDesktop = () => {};
let desktopWanted = false;

export function desktopBannerWouldShow() {
  return desktopWanted;
}

export function refreshDesktopBanner() {
  repaintDesktop();
}

export function startDesktopInstall(doc = typeof document !== "undefined" ? document : null, win = typeof window !== "undefined" ? window : null, allow) {
  if (!doc || !win || !doc.getElementById) return;
  const host = doc.getElementById("desktopinstall");
  if (!host) return;
  let prompt = null;
  let dismissed = false;
  try { dismissed = !!(win.sessionStorage && win.sessionStorage.getItem("callup.desktopInstall") === "hide"); } catch { dismissed = false; }

  function paint() {
    const model = desktopInstallModel({
      env: { window: win, navigator: win.navigator, tauri: win.__CALLUP_DESKTOP__ === true },
      promptReady: !!prompt,
    });
    desktopWanted = !dismissed && !!(model && model.show);
    const permitted = desktopWanted && (typeof allow !== "function" || allow() !== false);
    if (!permitted) { host.hidden = true; host.innerHTML = ""; return; }
    host.hidden = false;
    host.innerHTML = desktopInstallHtml(model);
    const installBtn = host.querySelector && host.querySelector("#desktopinstallbtn");
    if (installBtn) installBtn.onclick = async () => {
      if (!prompt || typeof prompt.prompt !== "function") return;
      try {
        prompt.prompt();
        await prompt.userChoice;
      } catch { /* the browser closed the prompt */ }
      prompt = null;
      paint();
    };
    const hide = host.querySelector && host.querySelector("#desktopinstallhide");
    if (hide) hide.onclick = () => {
      dismissed = true;
      try { win.sessionStorage && win.sessionStorage.setItem("callup.desktopInstall", "hide"); } catch { /* hidden for this page either way */ }
      paint();
    };
  }

  repaintDesktop = paint;
  win.addEventListener("beforeinstallprompt", event => {
    const surface = readDesktopEnv({ window: win, navigator: win.navigator, tauri: win.__CALLUP_DESKTOP__ === true });
    // Phones keep the browser's own install prompt. A desktop browser, and the Windows program, use ours or none.
    if (!surface.desktopBrowser && !surface.tauri) return;
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    if (!surface.desktopBrowser) return;
    prompt = event;
    paint();
  });
  win.addEventListener("appinstalled", () => { prompt = null; paint(); });
  paint();
}
