// Tutorial videos: one list, deterministic matching, crew never pointed at office-only videos,
// plain YouTube links (no embeds), and helperAsk only ever names ids from the same list.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TUTORIAL_VIDEOS, matchVideo, videoById, videoListForModel, videoUrl, videosFor,
} from "../../app/features/tutorial-videos.js";
import { askHelp, helpAnswerHtml, helpPanelHtml, helpVideosHtml, matchHelp, videoLinkHtml } from "../../app/features/help.js";
import { handleHelperAsk, pickVideo } from "../functions/helper/ask.js";
import { memoryReader, recordingModel, sampleStore, TODAY } from "./helper-fixture.js";

const office = { role: "admin", canSeeMoney: true };
const supervisor = { role: "supervisor", canSeeMoney: true };
const crew = { role: "operator", staffRole: "labourer", canSeeMoney: false };
const operator = { role: "operator", canSeeMoney: false };

test("the video list is well formed and unique", () => {
  assert.ok(TUTORIAL_VIDEOS.length >= 3);
  const ns = new Set(), ids = new Set();
  for (const v of TUTORIAL_VIDEOS) {
    assert.equal(Number.isInteger(v.n) && v.n > 0, true, "n");
    assert.match(v.youtubeId, /^[A-Za-z0-9_-]{11}$/, v.title);
    assert.ok(["all", "office"].includes(v.audience), v.title);
    assert.ok(v.title && v.keywords.length, v.title);
    assert.equal(ns.has(v.n), false, "duplicate n " + v.n);
    assert.equal(ids.has(v.youtubeId), false, "duplicate id " + v.youtubeId);
    ns.add(v.n); ids.add(v.youtubeId);
  }
  assert.equal(videoUrl(TUTORIAL_VIDEOS[0]), "https://youtu.be/kBowcNxUdZQ");
  assert.equal(videoUrl({ youtubeId: "bad id\"><script>" }), "");
});

test("questions map to the matching video", () => {
  assert.equal(matchVideo("how do I invite staff", office).n, 2);
  assert.equal(matchVideo("How do I add staff?", office).n, 2);
  assert.equal(matchVideo("How do I create a company?", office).n, 1);
  assert.equal(matchVideo("how do i install the app on my phone", office).n, 3);
  assert.equal(matchVideo("how do I install callup", crew).n, 3);
  assert.equal(matchVideo("how do I turn on notifications", office).n, 4);
  assert.equal(matchVideo("how do I turn on notifications", crew).n, 4);
  assert.equal(matchVideo("How do I make a quote?", office), null);
  assert.equal(matchVideo("", office), null);
  assert.equal(matchVideo("staffing levels for leave", office), null);
});

test("crew are never pointed at office-only videos", () => {
  assert.equal(matchVideo("how do I invite staff", crew), null);
  assert.equal(matchVideo("how do I create a company", operator), null);
  assert.deepEqual(videosFor(crew).map(v => v.n), [3, 4]);
  assert.deepEqual(videosFor({ role: "admin", staffRole: "labourer", canSeeMoney: true }).map(v => v.n), [3, 4]);
  assert.deepEqual(videosFor(supervisor).map(v => v.n), [1, 2, 3, 4]);
  assert.equal(videoById(1, crew), null);
  assert.equal(videoById(3, crew).n, 3);
  assert.equal(videoById(4, crew).title, "Turn on phone alerts");
  assert.deepEqual(videoListForModel(crew), [
    { id: 3, title: "Install the app", url: "https://youtu.be/uKLQKTpxVJA" },
    { id: 4, title: "Turn on phone alerts", url: "https://youtu.be/e7leDphA0no" },
  ]);
});

test("Help answers carry a plain YouTube link, never an embed", () => {
  const staff = matchHelp("how do I invite staff", office);
  assert.equal(staff.topic, "staff");
  assert.equal(staff.video.n, 2);
  const html = helpAnswerHtml(staff);
  assert.match(html, /href="https:\/\/youtu\.be\/AuuLkAaCZ-E"/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /Video 2: Invite your crew/);
  assert.doesNotMatch(html, /iframe|youtube-nocookie|embed/i);
  const crewStaff = matchHelp("how do I invite staff", crew);
  assert.equal(crewStaff.video, null);
  assert.doesNotMatch(helpAnswerHtml(crewStaff), /youtu/);
  const install = matchHelp("How do I install the app?", crew);
  assert.equal(install.topic, "install");
  assert.equal(install.video.n, 3);
  assert.equal(videoLinkHtml({ n: 9, title: "x", url: "javascript:alert(1)" }), "");
  assert.equal(videoLinkHtml({ n: 9, title: "x", url: "https://evil.example/abcdefghijk" }), "");
});

test("the Help panel lists the videos this viewer may watch", () => {
  const officePanel = helpPanelHtml(office);
  assert.match(officePanel, /Video guides/);
  for (const id of ["kBowcNxUdZQ", "AuuLkAaCZ-E", "uKLQKTpxVJA", "e7leDphA0no"]) assert.match(officePanel, new RegExp("youtu\\.be/" + id));
  const crewPanel = helpPanelHtml(crew);
  assert.match(crewPanel, /uKLQKTpxVJA/);
  assert.match(crewPanel, /e7leDphA0no/);
  assert.doesNotMatch(crewPanel, /kBowcNxUdZQ|AuuLkAaCZ-E/);
  assert.doesNotMatch(officePanel + crewPanel, /iframe|youtube-nocookie/i);
  assert.equal(helpVideosHtml({ role: "operator", canSeeMoney: false }).includes("Install the app"), true);
});

test("a helper reply keeps only video ids from the list for this viewer", async () => {
  const named = await askHelp("how do I invite staff", office, async () => ({ enabled: true, reply: "Open Staff and send an invite.", videoId: 2 }));
  assert.equal(named.source, "helper");
  assert.equal(named.video.url, "https://youtu.be/AuuLkAaCZ-E");
  const crewTry = await askHelp("how do I install the app", crew, async () => ({ enabled: true, reply: "Open it in Safari.", videoId: 1 }));
  assert.equal(crewTry.video.n, 3, "office-only id from the reply is ignored; keyword match stays");
  const off = await askHelp("how do I invite staff", office, async () => ({ enabled: false, reply: "Helper is switched off, so I didn't ask a model." }));
  assert.equal(off.source, "knowledge");
  assert.equal(off.video.n, 2);
});

test("helperAsk gives the model the filtered list and returns a checked videoId", async () => {
  assert.equal(pickVideo("Open Staff.\nVIDEO: 2", "how do I invite staff", office), 2);
  assert.equal(pickVideo("Sure.\nVIDEO: 99", "how do I invite staff", office), 2);
  assert.equal(pickVideo("Sure.\nVIDEO: 1", "how do I install", crew), 3);
  assert.equal(pickVideo("Sure.", "how do I make a quote", office), null);
  const store = sampleStore();
  const run = async (uid, question, reply) => {
    const seen = [];
    const result = await handleHelperAsk({
      auth: { uid }, data: { question }, reader: memoryReader(store, []), model: recordingModel(seen, reply),
      enabled: true, now: new Date(TODAY + "T02:00:00Z"), canary: "hw-testcanary",
    });
    return { result, payload: JSON.parse(seen[0].user), system: seen[0].system };
  };
  const sup = await run("sup1", "how do I invite staff to callup", "Open Staff and send an invite.\nVIDEO: 2");
  assert.equal(sup.result.videoId, 2);
  assert.doesNotMatch(sup.result.reply, /VIDEO:/);
  assert.deepEqual(sup.payload.tutorialVideos.map(v => v.id), [1, 2, 3, 4]);
  assert.match(sup.system, /VIDEO: <id>/);
  const lab = await run("lab1", "how do I invite staff", "Ask a supervisor.\nVIDEO: 2");
  assert.equal(lab.result.videoId, null);
  assert.deepEqual(lab.payload.tutorialVideos.map(v => v.id), [3, 4]);
});

test("no embed: the CSP and hosting config are not widened for YouTube frames", () => {
  for (const path of ["../../app/index.html", "../../app/features/help.js", "../../app/features/tutorial-videos.js"]) {
    const src = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(src, /<iframe|youtube-nocookie\.com\/embed/i, path);
  }
});
