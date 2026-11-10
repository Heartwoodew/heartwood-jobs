import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
export async function open() {
  const PW = readFileSync("/workspace/callup/secrets/test-owner-password", "utf8");
  const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
  const ctx = await b.newContext(); const p = await ctx.newPage(); const errs = [];
  p.on("pageerror", e => errs.push(String(e))); p.on("console", m => { if (m.type() === "error") errs.push(m.text().slice(0, 160)); });
  p.on("dialog", d => d.accept());
  await p.goto("https://callupapp.web.app/app/?cb=" + Date.now(), { waitUntil: "networkidle" }); await p.waitForTimeout(2000);
  await p.fill("#login [name=e]", "callup932+test@gmail.com"); await p.fill("#login [name=p]", PW);
  await p.press("#login [name=p]", "Enter"); await p.waitForTimeout(6000);
  return { b, p, errs };
}
