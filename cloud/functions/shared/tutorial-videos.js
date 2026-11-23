// CallUp tutorial videos on YouTube (@callupapp). This is the one list.
// Help and helperAsk both read it. Links open YouTube in a new tab or the
// YouTube app; nothing is embedded, so the app's CSP does not change.
//
// To add a video, add one line to TUTORIAL_VIDEOS:
//   { n: 4, title: "Turn on phone alerts", youtubeId: "XXXXXXXXXXX", audience: "all", keywords: ["alert", "notification"] },
// n         order in the series (shown as "Video 4").
// youtubeId the part after https://youtu.be/
// audience  "all" for everyone, or "office" for admins/managers/supervisors who
//           can see prices. Crew (labourer/operator) never get "office" videos.
// keywords  words or phrases in a question that should point to this video.
// Then copy this file to cloud/functions/shared/tutorial-videos.js
// (cloud/test/bundle.test.js checks the two copies match).

export const TUTORIAL_VIDEOS = Object.freeze([
  { n: 1, title: "Create your CallUp company", youtubeId: "kBowcNxUdZQ", audience: "office", keywords: ["create a company", "create company", "create my company", "create your company", "sign up", "signup", "new company", "set up company", "set up my company", "register", "abn"] },
  { n: 2, title: "Invite your crew", youtubeId: "AuuLkAaCZ-E", audience: "office", keywords: ["invite", "add staff", "add a person", "add crew", "add my crew", "add team", "team member", "new staff", "crew login", "login for"] },
  { n: 3, title: "Install the app", youtubeId: "uKLQKTpxVJA", audience: "all", keywords: ["install", "download the app", "download callup", "home screen", "get the app", "add to phone", "app on my phone", "desktop app"] },
  { n: 4, title: "Turn on phone alerts", youtubeId: "e7leDphA0no", audience: "all", keywords: ["notifications", "alerts", "push", "turn on notifications", "mute", "morning job list"] },
  { n: 5, title: "Add a client and book a job", youtubeId: "0GWlLkJpRD0", audience: "office", keywords: ["add a client", "add client", "new client", "add a customer", "add customer", "new customer", "book a job", "book job", "booking a job", "create a job", "create job", "creating a job", "add a job", "add job", "new job"] },
].map(v => Object.freeze({ ...v, keywords: Object.freeze([...v.keywords]) })));

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const CREW_ROLES = new Set(["labourer", "operator"]);

export function videoUrl(video) {
  const id = video && String(video.youtubeId || "");
  return ID_RE.test(id) ? "https://youtu.be/" + id : "";
}

// ctx: { role, staffRole, canSeeMoney } from the app, or { role, canSeeMoney } from membership.
export function isOfficeViewer(ctx) {
  const role = String((ctx && (ctx.staffRole || ctx.role)) || "");
  if (CREW_ROLES.has(role)) return false;
  return !!(ctx && ctx.canSeeMoney);
}

export function videosFor(ctx = {}) {
  const office = isOfficeViewer(ctx);
  return TUTORIAL_VIDEOS.filter(v => videoUrl(v) && (v.audience === "all" || (office && v.audience === "office")));
}

function normalise(text) {
  return " " + String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";
}

// Deterministic: the video whose keywords cover the most characters of the question wins.
// Whole-word matching, so "staff" does not match "staffing" and "abn" does not match "cabnet".
export function matchVideo(question, ctx = {}) {
  const asked = normalise(question);
  if (asked.trim() === "") return null;
  let best = null;
  let score = 0;
  for (const video of videosFor(ctx)) {
    let n = 0;
    for (const word of video.keywords) {
      const w = normalise(word);
      if (w.trim() && asked.includes(w)) n += w.trim().length;
    }
    if (n > score) {
      score = n;
      best = video;
    }
  }
  return best;
}

export function videoById(id, ctx = {}) {
  return videosFor(ctx).find(v => String(v.n) === String(id)) || null;
}

// The short list given to helperAsk's model, already filtered for this viewer.
export function videoListForModel(ctx = {}) {
  return videosFor(ctx).map(v => ({ id: v.n, title: v.title, url: videoUrl(v) }));
}
