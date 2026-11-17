// Basic in-app Help for every CallUp company and every role.
// Answers come from this knowledge list. helperAsk is tried only when a caller
// is passed; if it is switched off, offline, or would show money to crew, the
// knowledge answer is used instead. This bot does not change any data.

export const HELP_CALL = "helperAsk";

export const SUGGESTED_QUESTIONS = Object.freeze([
  "How do I add a job?",
  "How do I make a quote?",
  "How do I add staff?",
  "How do I do a prestart?",
  "How do I email a job?",
]);

const TOPICS = Object.freeze([
  {
    id: "signup",
    keywords: ["sign up", "signup", "create a company", "create company", "trial", "abn", "required field"],
    go: "",
    goLabel: "",
    office: "On Create your company, fields with a * are required. Your name, sign-in email, a password of at least 8 characters, at least one trade, company name, legal name, ABN, address and company email are required. The ABN is required even on a trial. Accounts email starts as the company email; change it if hours spreadsheets should go somewhere else. Fix the messages under the fields, then tap Create company.",
    crew: "A company admin creates the company. If you work here, ask them for an invite link rather than creating another company.",
  },
  {
    id: "clients",
    keywords: ["client", "add client", "customer", "contact"],
    go: "clients",
    goLabel: "Take me to Clients",
    office: "Open Clients and tap Add client. Enter the company or client name (required), then contact name, phone, email, address and notes if you have them. Save client stores the contact with the client. You can add more contacts on the client card afterwards.",
    crew: "Clients are kept by the office. Ask an admin to add a client if a name is missing on your job.",
  },
  {
    id: "jobs",
    keywords: ["add a job", "add job", "new job", "create a job", "category", "book a job"],
    go: "jobs",
    goLabel: "Take me to Jobs",
    office: "Open Jobs and tap New Job. Choose a category (it starts blank unless this company is earthworks, which starts on Spoil removal). Categories are grouped by trade, so Plumbing – Other and Earthworks – Other are different. Fill in the client, address and date, then Save Job.",
    crew: "Your jobs are on Today and This week. Open a job to see the address, start it, add a note, or add photos. Adding a new job is done in the office.",
  },
  {
    id: "quotes",
    keywords: ["quote", "quoting", "make a quote", "new quote", "wizard"],
    go: "quotes",
    goLabel: "Take me to Quotes",
    office: "Open Quotes and tap New quote. It starts on the job's trade when you quote from a job, otherwise on the company's first trade. Tick only the categories you want. Nothing is added until you tick it, and an empty section is not saved. Then enter measurements or plant, review, and save the draft or accept it.",
    crew: "Quotes are prepared in the office. On a job you see the work and the quantities. Prices are not shown on your login.",
  },
  {
    id: "rates",
    keywords: ["rate", "rates needed", "quote rates", "price list", "set a price", "prices"],
    go: "settings",
    goLabel: "Take me to Company",
    office: "Rates needed means that trade has no saved price yet. Open Quote rates for that trade from the quote list, or from Company, and enter the prices you use. Nothing is filled in for you. Crew never see these prices.",
    crew: "Prices and quote rates are office-only. They are not shown on your login.",
  },
  {
    id: "staff",
    keywords: ["staff", "invite", "add staff", "add a person", "team member", "login for"],
    go: "staff",
    goLabel: "Take me to Staff",
    office: "Open Staff and send an invite. Pick the job title: that sets whether they are a labourer, operator, supervisor, manager or admin. They join only this company. You cannot invite someone into another company.",
    crew: "Staff invites are sent by an admin, manager or supervisor. Ask them if you need a login for someone else.",
  },
  {
    id: "timesheet",
    keywords: ["timesheet", "time sheet", "clock on", "clock off", "hours"],
    go: "timesheet",
    goLabel: "Take me to Hours",
    office: "Hours are under Timesheet (on a phone, More → Hours). Clock on and off, or add hours manually. Hours on a job do not replace the timesheet.",
    crew: "Open More, then Hours. Clock on when you start and clock off when you finish, or add the hours manually. The hours on a job card do not change your timesheet.",
  },
  {
    id: "leave",
    keywords: ["leave", "sick", "annual leave", "holiday", "day off"],
    go: "leave",
    goLabel: "Take me to Leave",
    office: "Open Leave to request annual leave, sick leave or other leave. An admin or manager can approve it. Approved leave shows when you allocate that person to a job.",
    crew: "Open More, then Leave. Choose annual, sick or other, add the dates, and send the request. Your supervisor decides it.",
  },
  {
    id: "prestart",
    keywords: ["prestart", "pre-start", "machine", "plant", "checklist", "coi", "certificate"],
    go: "prestart",
    goLabel: "Take me to Prestart",
    office: "A prestart is a short check of a machine before anyone uses it. Open Prestart. If there are no machines, tap Add your first machine. Only the name and type are required. Certificate of inspection (COI) is optional: it is the Queensland inspection certificate for some heavy vehicles and trailers, not insurance.",
    crew: "A prestart is a short check before you use a machine. Open More, then Prestart, pick the machine and work through the checklist. If the list is empty, ask a supervisor to add the machine.",
  },
  {
    id: "take5",
    keywords: ["take 5", "take5", "take five", "hazard"],
    go: "take5",
    goLabel: "Take me to Take 5s",
    office: "A Take 5 is the five-step check before work starts: stop, look, assess, control, proceed. It is on by default. Open a job and tap Start Take 5. Take 5s is also in the menu, not only in Company settings. An admin can turn them off under Company.",
    crew: "Before you start a job, tap Start Take 5 on that job. Tick all five steps and note the hazards and what you will do. You can also open Take 5 from More.",
  },
  {
    id: "documents",
    keywords: ["document", "photo", "photos", "swms", "upload", "picture"],
    go: "jobs",
    goLabel: "Take me to Jobs",
    office: "Open the job. Photos are added with Add photos. Documents sit on the job card for the office, and crew documents are the ones marked for the crew. SWMS, when this company has one, is on the job and under SWMS.",
    crew: "Open the job and tap Add photos. Cloud photos are the private copies stored for that job. SWMS, when your company has one, is on the job.",
  },
  {
    id: "email",
    keywords: ["email a job", "email job", "mail the job", "send the job", "share the job"],
    go: "jobs",
    goLabel: "Take me to Jobs",
    office: "Open the job and tap Email job. The client's email is filled in when there is one. Add a Cc if you want one, then tap Send. CallUp sends the email. Other mail app opens your own mail app instead. Nothing is sent until you tap Send.",
    crew: "Open the job and tap Email job. Add the client's email if the box is empty, then tap Send. CallUp sends the email. Other mail app is there if you want your own mail app. Nothing is sent until you tap Send.",
  },
  {
    id: "billing",
    keywords: ["billing", "subscribe", "subscription", "card", "trial end", "payment", "invoice the company"],
    go: "settings",
    goLabel: "Take me to Company",
    office: "Billing is under Company, for an admin. A new company starts a 14-day trial and is not charged on the sign-up screen. Subscribe before the trial ends if you want to keep the account. Card details are optional at sign-up.",
    crew: "Billing is handled by your admin. Ask them if the account says it is paused.",
  },
  {
    id: "chat",
    keywords: ["team chat", "chat", "message the crew", "help assistant", "help bot"],
    go: "chat",
    goLabel: "Take me to Team chat",
    office: "Team chat is the message list for everyone signed in at this company. This Help button answers how to use CallUp. Team chat does not.",
    crew: "Team chat is for messages to people at your company. This Help button answers how to use CallUp.",
  },
]);

function officeUser(ctx) {
  const role = String((ctx && (ctx.staffRole || ctx.role)) || "");
  if (role === "labourer" || role === "operator") return false;
  return !!(ctx && ctx.canSeeMoney);
}

function normalise(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const MONEY_LEAK = /(?:a|au)?\$\s?\d|\bex gst\b|\ba\$\d|\bper month\b|\bunit price\b|\binvoice amount\b/i;

export function helpVisible(me) {
  return !!(me && (me.uid || me.role || me.staffRole));
}

export function matchHelp(question, ctx = {}) {
  const asked = normalise(question);
  const office = officeUser(ctx);
  let best = null;
  let score = 0;
  for (const topic of TOPICS) {
    let n = 0;
    for (const word of topic.keywords) {
      if (asked && normalise(word) && asked.includes(normalise(word))) n += word.length;
    }
    if (n > score) {
      score = n;
      best = topic;
    }
  }
  if (!best) {
    return {
      ok: true,
      topic: "",
      source: "knowledge",
      text: "I can help with jobs, quotes, clients, staff, hours, leave, prestarts, Take 5s, photos and emailing a job. Try one of the suggestions, or ask how to do one of those.",
      go: "",
      goLabel: "",
    };
  }
  return {
    ok: true,
    topic: best.id,
    source: "knowledge",
    text: office ? best.office : best.crew,
    go: best.go,
    goLabel: best.go ? best.goLabel : "",
  };
}

export function replyShowsMoney(text) {
  return MONEY_LEAK.test(String(text || ""));
}

export async function askHelp(question, ctx = {}, caller) {
  const local = matchHelp(question, ctx);
  if (typeof caller !== "function") return local;
  try {
    const remote = await caller(HELP_CALL, {
      question: String(question || "").slice(0, 2000),
      tenantId: ctx.companyId || "",
      businessId: ctx.companyId || "",
    });
    const reply = remote && typeof remote.reply === "string" ? remote.reply.trim() : "";
    const usable = remote && remote.enabled && reply && !/switched off|didn't ask a model|don't have access/i.test(reply);
    if (usable && (officeUser(ctx) || !replyShowsMoney(reply))) {
      return { ...local, text: reply, source: "helper" };
    }
  } catch {
    /* helper is off, offline, or refused — the knowledge answer still works */
  }
  return local;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function helpPanelHtml() {
  const ideas = SUGGESTED_QUESTIONS.map(q => `<button type="button" class="sm-btn" data-help-q="${esc(q)}">${esc(q)}</button>`).join("");
  return `<section class="callup-help" id="helppanel" role="dialog" aria-label="Help">
    <div class="callup-help-bar"><h2>Help</h2><button type="button" class="sm-btn" id="helpx">Close</button></div>
    <p class="sub">Ask how to use CallUp. This does not change any records.</p>
    <div class="callup-help-ideas" id="helpideas">${ideas}</div>
    <div class="callup-help-log" id="helplog" role="log"></div>
    <form id="helpform" class="callup-help-form">
      <input name="q" maxlength="2000" placeholder="How do I…" aria-label="Your question" autocomplete="off">
      <button class="sm-btn primary" type="submit">Ask</button>
    </form>
  </section>`;
}

export function helpAnswerHtml(answer) {
  const go = answer && answer.go && answer.goLabel
    ? `<button type="button" class="sm-btn" data-help-go="${esc(answer.go)}">${esc(answer.goLabel)}</button>`
    : "";
  return `<article class="callup-help-answer"><p>${esc(answer && answer.text || "")}</p>${go}</article>`;
}

export function teamChatHelpCard() {
  return `<div class="callup-help-card"><p><b>Need help using CallUp?</b> Ask the assistant how to add a job, make a quote, or do a prestart.</p><button type="button" class="sm-btn" data-open-help>Ask the assistant</button></div>`;
}
