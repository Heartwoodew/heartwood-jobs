// Phone screenshot of team chat against the local emulators. Not a live project.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { setTimeout as sleep } from "node:timers/promises";
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, collection, addDoc, serverTimestamp, doc, setDoc } from "firebase/firestore";
import { getStorage, connectStorageEmulator, ref, uploadBytes } from "firebase/storage";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { launchChrome, openPage } from "../../tests/browse.mjs";

const email = "sam.chat@heartwood.test";
const otherEmail = "riley.chat@heartwood.test";
const password = "test-pass-123";

async function signUp(address) {
  const res = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: address, password, returnSecureToken: true }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error("sign up failed " + JSON.stringify(body));
  return body.localId;
}

function client(name) {
  const app = initializeApp({
    apiKey: "demo-key",
    projectId: "demo-heartwood",
    storageBucket: "heartwood-9f37f.firebasestorage.app",
    appId: "demo-" + name,
  }, name);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const storage = getStorage(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  return { auth, db, storage };
}

async function post(user, { text, photo }) {
  const payload = {
    senderUid: user.auth.currentUser.uid,
    senderName: user.name,
    text,
    createdAt: serverTimestamp(),
  };
  if (photo) {
    payload.photoPath = photo.path;
    payload.photoType = photo.contentType;
  }
  await addDoc(collection(user.db, "tenants", "heartwood", "chats", "staff", "messages"), payload);
  await setDoc(doc(user.db, "tenants", "heartwood", "chats", "staff"), {
    lastAt: serverTimestamp(),
    lastSenderUid: user.auth.currentUser.uid,
    lastSenderName: user.name,
    preview: (text || "Photo").slice(0, 140),
  });
}

function crc(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  const out = Buffer.alloc(4);
  out.writeUInt32BE((~c) >>> 0);
  return out;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  return Buffer.concat([len, body, crc(body)]);
}
function photoPng(w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      const i = row + 1 + x * 3;
      const frame = x < 18 || y < 18 || x > w - 19 || y > h - 19;
      const band = y > h * 0.72;
      raw[i] = frame ? 0x3b : band ? 0x8a : 0xe7;
      raw[i + 1] = frame ? 0x2a : band ? 0x5a : 0xc5;
      raw[i + 2] = frame ? 0x1a : band ? 0x2b : 0x9a;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const photo = photoPng(640, 420);

async function main() {
  const samId = await signUp(email);
  const rileyId = await signUp(otherEmail);
  const env = await initializeTestEnvironment({
    projectId: "demo-heartwood",
    firestore: { rules: readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8") },
    storage: { rules: readFileSync(new URL("../emulator/storage.rules", import.meta.url), "utf8") },
  });
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", samId), { name: "Sam", role: "operator" });
    await setDoc(doc(db, "users", rileyId), { name: "Riley", role: "operator" });
    await setDoc(doc(db, "jobs", "job1"), {
      client: "Orbit Homes (Qld) Pty Ltd",
      address: "Lot 88 · 14 Brightvale Street, Redbank Plains QLD 4301",
      assigned: [samId, rileyId],
      assignedNames: ["Sam", "Riley"],
      status: "Scheduled",
      date: "2026-11-07",
      time: "07:00",
      type: "backslab",
      description: "Slab clean and road base",
      sm8JobNo: "2402",
    });
  });

  const riley = client("riley");
  riley.name = "Riley";
  await signInWithEmailAndPassword(riley.auth, otherEmail, password);
  const photoPath = "tenants/heartwood/chat/staff/photos/c1234abcd";
  await uploadBytes(ref(riley.storage, photoPath), photo, {
    contentType: "image/png",
    customMetadata: { tenantId: "heartwood", threadId: "staff", uploaderUid: rileyId, purpose: "chat-photo" },
  });
  await post(riley, { text: "Brightvale slab is clear. The crew can start." });
  await post(riley, { text: "Gate's open.", photo: { path: photoPath, contentType: "image/png" } });
  await signOut(riley.auth);

  const sam = client("sam");
  sam.name = "Sam";
  await signInWithEmailAndPassword(sam.auth, email, password);
  await post(sam, { text: "Thanks. I'm on site now." });
  await post(sam, { text: "I'll send the office a note when the backblade is done." });
  await signOut(sam.auth);

  const server = spawn("python3", ["-m", "http.server", "8777", "--bind", "127.0.0.1"], {
    cwd: new URL("../..", import.meta.url).pathname,
    stdio: "ignore",
  });
  const chrome = await launchChrome(9342);
  try {
    for (let i = 0; i < 40; i++) {
      try {
        const ping = await fetch("http://127.0.0.1:8777/app/index.html");
        if (ping.ok) break;
      } catch { /* booting */ }
      await sleep(100);
    }
    const { page, errors } = await openPage(chrome.port, "about:blank");
    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await page.send("Page.navigate", { url: "http://127.0.0.1:8777/app/index.html?emu=1" });
    const started = Date.now();
    let logged = false;
    while (Date.now() - started < 20000) {
      const hasLogin = await page.send("Runtime.evaluate", { expression: "!!document.querySelector('#login')", returnByValue: true });
      const hasTabs = await page.send("Runtime.evaluate", { expression: "!!document.querySelector('[data-tab=\"chat\"]')", returnByValue: true });
      if (hasTabs.result?.value) break;
      if (hasLogin.result?.value && !logged) {
        logged = true;
        await page.send("Runtime.evaluate", {
          expression: `(() => { const f = document.querySelector('#login'); f.e.value = ${JSON.stringify(email)}; f.p.value = ${JSON.stringify(password)}; f.requestSubmit(); })()`,
        });
      }
      await sleep(200);
    }
    const opened = await page.send("Runtime.evaluate", {
      expression: "document.querySelector('[data-tab=\"chat\"]')?.click(); 'ok'",
      returnByValue: true,
    });
    if (opened.result?.value !== "ok") throw new Error("chat tab missing " + JSON.stringify(errors));
    const waitMsg = Date.now();
    let text = "";
    while (Date.now() - waitMsg < 8000) {
      const read = await page.send("Runtime.evaluate", { expression: "document.querySelector('.chat-log')?.innerText || ''", returnByValue: true });
      text = read.result?.value || "";
      if (text.includes("Brightvale") && text.includes("backblade")) break;
      await sleep(200);
    }
    if (!text.includes("Brightvale")) throw new Error("chat did not render: " + text.slice(0, 400) + " errors " + errors.join("\n"));
    await sleep(400);
    const shot = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    mkdirSync("/opt/cursor/artifacts", { recursive: true });
    writeFileSync("/opt/cursor/artifacts/chat-phone.png", Buffer.from(shot.data, "base64"));
    if (errors.length) console.warn("page errors", errors);
    console.log("wrote /opt/cursor/artifacts/chat-phone.png");
  } finally {
    chrome.proc.kill("SIGKILL");
    server.kill("SIGKILL");
    await env.cleanup();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
