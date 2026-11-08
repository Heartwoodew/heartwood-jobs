// Screenshots against the local emulators only. Fake companies. No production project.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, Timestamp } from "firebase/firestore";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUT = "/opt/cursor/artifacts";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json" };

function start() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!path.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    try {
      const body = await readFile(path);
      res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("missing");
    }
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function seedMaster() {
  const env = await initializeTestEnvironment({ projectId: "demo-heartwood" });
  const now = Timestamp.fromDate(new Date("2026-11-08T00:00:00Z"));
  const trialEnd = Timestamp.fromDate(new Date("2026-11-20T00:00:00Z"));
  const ended = Timestamp.fromDate(new Date("2026-10-01T00:00:00Z"));
  const billing = { provider: null, status: "not-configured", stripeCustomerId: null, stripeSubscriptionId: null };
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "companies/heartwood"), {
      name: "Heartwood Earthworx", legalName: "Heartwood Earthworx Pty Ltd", abn: "31 667 738 098",
      signoff: "Heartwood Earthworx", logoUrl: "", address: "208-220 Holdsworth Rd, Chuwar QLD 4306",
      phone: "", email: "alex@heartwoodew.com", accountsEmail: "accounts@heartwoodew.com", hubdocAddress: "",
      status: "active", plan: "paid", origin: "heartwood", staffCount: 8, jobCount: 42,
      signedUpAt: Timestamp.fromDate(new Date("2024-03-01T00:00:00Z")), trialEndsAt: null,
      lastActivityAt: now, ownerUid: "1JKLsoxkQNfkphBBO0vDz2ziEyj2", createdBy: "migration", billing,
    });
    await setDoc(doc(db, "companies/harbor-7k2"), {
      name: "Harbor Plant Hire", legalName: "Harbor Plant Hire Pty Ltd", abn: "55 123 456 789",
      signoff: "Harbor Plant Hire", logoUrl: "", address: "14 Wharf Rd, Pinkenba QLD", phone: "07 3000 1100",
      email: "office@harbor.test", accountsEmail: "accounts@harbor.test", hubdocAddress: "harbor@app.hubdoc.com",
      status: "active", plan: "trial", origin: "signup", staffCount: 3, jobCount: 6,
      signedUpAt: Timestamp.fromDate(new Date("2026-11-06T00:00:00Z")), trialEndsAt: trialEnd,
      lastActivityAt: now, ownerUid: "harbor", createdBy: "harbor", billing,
    });
    await setDoc(doc(db, "companies/oldyard"), {
      name: "Oldyard Excavations", legalName: "Oldyard Excavations Pty Ltd", abn: "44 000 111 222",
      signoff: "Oldyard", logoUrl: "", address: "9 Pit Lane, Ipswich QLD", phone: "0400 222 333",
      email: "hello@oldyard.test", accountsEmail: "accounts@oldyard.test", hubdocAddress: "",
      status: "suspended", plan: "trial", origin: "signup", staffCount: 1, jobCount: 2,
      signedUpAt: Timestamp.fromDate(new Date("2026-09-01T00:00:00Z")), trialEndsAt: ended,
      lastActivityAt: Timestamp.fromDate(new Date("2026-09-20T00:00:00Z")), ownerUid: "old", createdBy: "old", billing,
    });
  });
}

async function authUpdate(localId, body) {
  const res = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-key", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer owner" },
    body: JSON.stringify({ localId, ...body }),
  });
  if (!res.ok) throw new Error(await res.text());
}

mkdirSync(OUT, { recursive: true });
const server = await start();
const { port } = server.address();
const browser = await chromium.launch({ executablePath: "/usr/local/bin/google-chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
try {
  await page.goto(`http://127.0.0.1:${port}/app/index.html`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Sign in" }).waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Create a company" }).click();
  await page.getByRole("heading", { name: "Create your company" }).waitFor();
  await page.locator("input[name=ownerName]").fill("Riley North");
  await page.locator("input[name=ownerEmail]").fill("riley@northside.test");
  await page.locator("input[name=password]").fill("northside-pass");
  await page.locator("input[name=name]").fill("Northside Plant");
  await page.locator("input[name=legalName]").fill("Northside Plant Pty Ltd");
  await page.locator("input[name=abn]").fill("12 345 678 901");
  await page.locator("input[name=address]").fill("88 Depot Rd, Strathpine QLD 4500");
  await page.locator("input[name=phone]").fill("07 3200 4455");
  await page.locator("input[name=email]").fill("office@northside.test");
  await page.locator("input[name=accountsEmail]").fill("accounts@northside.test");
  await page.locator("input[name=hubdocAddress]").fill("northside@app.hubdoc.com");
  await page.evaluate(() => { const h = document.querySelector("header.top"); if (h) h.style.display = "none"; });
  await page.locator("#signup").screenshot({ path: `${OUT}/company-onboarding.png` });
  await page.evaluate(() => { const h = document.querySelector("header.top"); if (h) h.style.display = ""; });
  page.on("pageerror", err => console.log("pageerror", String(err)));
  page.on("console", msg => { if (msg.type() === "warning" || msg.type() === "error") console.log("console", msg.type(), msg.text()); });
  await page.getByRole("button", { name: "Create company" }).click();
  const outcome = await page.waitForFunction(() => {
    const err = document.querySelector("#signuperr");
    if (err && err.textContent.trim()) return "err:" + err.textContent.trim();
    const line = document.querySelector(".brand .orgline");
    if (line && line.textContent.includes("Northside")) return "ok";
    return false;
  }, null, { timeout: 20000 }).then(handle => handle.jsonValue());
  if (String(outcome).startsWith("err:")) {
    await page.screenshot({ path: `${OUT}/company-onboarding-error.png`, fullPage: true });
    throw new Error("signup failed: " + outcome);
  }
  await page.locator("button.sm-nav", { hasText: "Company" }).click();
  await page.locator("#orgform").waitFor({ timeout: 15000 });
  await page.screenshot({ path: `${OUT}/company-details.png`, fullPage: true });

  await seedMaster();
  const signUp = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "alex@heartwoodew.com", password: "platform-owner-pass", returnSecureToken: true }),
  });
  const alex = await signUp.json();
  if (!alex.localId) throw new Error("alex signup " + JSON.stringify(alex));
  await authUpdate(alex.localId, { emailVerified: true, customAttributes: JSON.stringify({ platformOwner: true }) });
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await page.locator("input[name=e]").fill("alex@heartwoodew.com");
  await page.locator("input[name=p]").fill("platform-owner-pass");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Master" }).waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Master" }).click();
  await page.getByRole("heading", { name: "Master" }).waitFor();
  await page.screenshot({ path: `${OUT}/company-master.png`, fullPage: true });
  await page.getByText("Harbor Plant Hire").click();
  await page.getByRole("heading", { name: "Harbor Plant Hire" }).waitFor();
  await page.screenshot({ path: `${OUT}/company-master-detail.png`, fullPage: true });
  console.log("screenshots ok");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
