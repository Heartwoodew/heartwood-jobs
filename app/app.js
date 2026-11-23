// CallUp jobs app. Organisation name and logo come from org-settings.js.
// This install's customer is Heartwood Earthworx. Firebase ids are unchanged.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut, connectAuthEmulator, setPersistence, browserLocalPersistence }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator,
  collection, doc, getDoc, getDocFromCache, getDocs, getDocsFromCache, query, where, orderBy, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, deleteField, serverTimestamp, arrayUnion, runTransaction, Timestamp,
  disableNetwork, enableNetwork }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytes, uploadBytesResumable, deleteObject, connectStorageEmulator, listAll, getMetadata, getBlob }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { firebaseConfig, useEmulator, vapidKey } from "./firebase-config.js";
// Startup graph: auth, the company shell, and the home / run sheet. Everything else is a dynamic import
// below, fetched when that screen opens and prefetched once the first screen has painted.
import { JOB_MONEY_COLLECTION, jobMoneyDoc, mergeJobMoney, splitJobMoney } from "./features/job-money.js";
import { OPEN_STATUSES, staleOpenJobs, mergeJobLists, parseHoursInput } from "./features/job-window.js";
import {
  DISPATCH_CATEGORIES, approvedSheet, dispatchSettingsHtml, estimateDuration, formatEstimate,
  historyMedians, isManualStart, keepsStart, normaliseTime, planAutoTimes, primaryKey, readDispatchLocal,
  sanitizeDispatchSettings, spaceDay, withSortHint, writeDispatchLocal,
} from "./features/dispatch-times.js";
import { installRouteOrder, orderJobsForRun, runSheetId, geoPatch, setRouteDepot } from "./features/route-order.js";
import {
  bindDescriptionPicker, collectSuggestions, descriptionPickerHtml, detailsFromClient, emailsFromRecipientDoc,
  inputAttrs, listsHtml, loadBook, matchClient, prefillPatch, pushRecentEmail, rememberBook, saveBook, unionEmails,
} from "./features/autofill.js";
import { SWMS, SWMS_EMPTY, SWMS_VERSION, sigMs, sigExp, latestSig, statusOf, swmsSignatureData, buildPlaceholderPdf, companySwms, swmsReminderModel, swmsSignoffOrg } from "./features/swms-sign.js";
import {
  acceptLoadingHtml, acceptScreenModel, acceptViewHtml, buildInviteDraft, inviteFailureText,
  newInviteToken, pendingInviteForEmail, staffViewHtml, appOriginFor, invitableRoles, CREW_ROLES,
  canSendPasswordReset, canRemindLocation, forgotPasswordMessage, GOOGLE_ONLY_RESET,
} from "./features/staff-invites.js";
import { saveGuard, settleOrQueue } from "./features/pending-write.js";
import { bootStallHtml, bootWatchdog, readOrCache, trackRead, withTimeout } from "./features/boot-guard.js";
import {
  SAVED_ON_PHONE, deviceOnline, needsSignal, actionForCall, emailOutboxAllowed,
  jobsToWarm, warmReads, profileMiss, makeUpload, makeOutbox, classifyUploadError,
  flushUploads, noteWrite, clearWrite, pendingEntries, indicatorModel, pendingListHtml,
  sharedOfflineStore, registerUploadSync,
} from "./features/offline.js";
import { captureReferralParam, clearStoredReferral, referralGiveUp, storedReferralCode } from "./features/referral.js";
import { PRODUCT_NAME, POWERED_BY, clearSavedOrg, orgSettings, saveOrgSettings, setActiveCompany } from "./org-settings.js";
import {
  buildCompanyCreate, buildFriendCompany, buildTestCompany, companyAccess, companyDetailPatch, companyIdFromName, demoBundle,
  friendCodeOk, friendInviteLink, hoursBrand, isPlatformOwner, newFriendCode,
  ownerProfile, scopeRecord, trialEnd, validateCompanyInput, masterRow, CARD_SETUP_LATER,
  builderSignoff, clientDocId, companyClientNames, companyJobPrefix, companyMailbox, companyStdClients, timesheetMailParts,
  supervisorsPath, docCompanyId, isHeartwoodCompany, buildClientCreate,
} from "./features/company.js";
import { adminViewBannerHtml, bootCompanyView, clearedCompanySession, companyHistoryState, historyStepOnEnter, historyStepOnMasterReturn, IN_COMPANY_VIEW_KEY, masterHistoryState, RETURN_MASTER_KEY, takeReturnMasterFlag, urlMarksCompanyView, withCompanyViewParam, clientFormHtml, companySettingsHtml, failureText as companyFailure, masterDetailHtml, masterPageHtml, pausedAdminHtml, pausedOwnerHtml, pausedStaffHtml, referralBoxHtml, signupFieldErrors, signupFormHtml, trialBannerHtml } from "./features/company-ui.js";
import { pickDashboardBanner } from "./features/dashboard-banners.js";
import {
  addTitle, bindTradeSearch, companyTradesDoc, defaultJobCategory, jobCategorySelectHtml, jobTypeMap, normalizeTrade, readTradeList, removeTitle, renameTitle, resolveCompanySetup,
  sanitizeSkills, sanitizeTitles, sanitizeTradeList, setTitleLevel, skillsEditorHtml,
  titlesAfterTradeChange, titlesEditorHtml, tradeLabel, quotePack,
} from "./features/trades.js";
import { addPresetRow, jobStepsHtml, jobStepsScopeLabel, mergeIndustryPresets, pestControlOn, presetEditorHtml, readPresetEditor, recurrenceHint, removePresetRow } from "./features/industry-presets.js";
import { newSeriesId, planSeries, recurrenceFromForm, repeatFieldHtml, skipPatch, wireRepeatBox } from "./features/recurrence.js";
import { buildCertificate, bytesToBase64, certificatePanelHtml, certificatesEnabled } from "./features/certificates.js";
import { acceptLogoValue, compressLogo, isLogoStoragePath, logoFailureText, logoFileOk, logoUploadPlan } from "./features/company-logo.js";
import {
  accuracyText, brisbaneHM, captureFix, coordText, daysForSheet, editList, entryList, locationConsent,
  locationMap, machineChoicePatch, machinePromptNeeded, machineShiftToResume, mapsHref, needsLocationConsent, newTsId, openClock,
  paidShift, prestartStatus, sheetHours, shiftHours, sortedEntries, stampText,
} from "./features/timesheet.js";
import {
  LIVE_LIMIT_NOTE, LIVE_SHARE_TEXT, SHARE_FIX_WAIT_MS, canSeeCrewMap, companySharesLocation, crewListHtml, crewMapModel,
  crewMapNotice, homeCrewSlot, liveCollectionPath, liveLocationBody, locationRemindBannerHtml, mapFailureStatus, shareIndicator, shouldSendPosition,
} from "./features/live-location.js";

// Same price strip as features/quotes.js noDollars. Kept here so a crew run sheet never paints a dollar
// while the quotes module is still loading.
function noDollars(text) {
  return String(text == null ? "" : text).replace(/(?:A|AU)?\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:ex|inc|incl)\.?\s?GST)?/gi, "[price removed]").replace(/\$/g, "");
}
let installQuotes = () => ({ bindAdmin() {} });
let adminViewRouter = () => "";
let quoteRatesSettingsBlurb = () => "";
let setDefaultDepot = () => {};
let setQuoteTradeSetup = () => {};
let setQuoteFocus = () => {};
let askHelp = async () => ({ text: "", source: "knowledge" });
let helpAnswerHtml = () => "";
let helpPanelHtml = () => "";
let helpVisible = me => !!(me && (me.uid || me.role || me.staffRole));
let capacityViewHtml = () => "";
let shiftWeek = (day) => day;
let planJobPhotoMirrors = () => ({ ok: false, mirrors: [] });
let planStaffReceiptCapture = () => ({ ok: false });
let resolveMembership = () => ({ ok: false, reason: "no-membership" });
let putPlanned = async () => {};
let jobPhotoPrefix = () => ({ prefix: "" });
let storageErrorCode = err => (err && err.code) || "";
let summarizePhotoListing = () => ({ photos: [], failures: [] });
let buildOperationalExport = () => ({ ok: false, reason: "not-ready" });
let retentionAdminText = () => "";
let retentionView = () => ({ warning: false, due: false, state: "" });
let buildJobEmail = () => ({ subject: "", body: "", attachments: [] });
let compressImageBlob = async blob => blob;
let deviceCanShareFiles = () => false;
let emailSendPlan = () => ({ ok: false });
let emailSheetHtml = () => "";
let jpegName = name => name;
let mailtoHref = () => "";
let parseEmailRecipients = () => [];
let photoBudget = () => ({ ok: true, photos: [] });
let photosZip = async () => new Blob();
let selectEmailAttachments = list => list || [];
let shareText = async () => {};
let suggestRecipient = () => "";
let uniqueNames = list => list || [];
let buildJobGallery = () => ({ photos: [] });
let stampExpiresAfter = row => row;
let galleryExportPhotos = () => [];
let photoSlotHtml = () => "";
let lightboxHtml = () => "";
let photoFailureText = () => "";
let decidePhotoEmail = () => ({ send: false });
let mountDocuments = () => {};
let unmountDocuments = () => {};
let openDocumentBlob = async () => {};
let canManageDocuments = role => role === "admin" || role === "manager" || role === "supervisor";
let flushDocumentQueue = async () => {};
let sharedQueue = () => ({ list: async () => [] });
let installChatApp = () => ({ badge() { return ""; }, teamHtml() { return ""; }, jobHtml() { return ""; }, mount() {}, openJob() {}, start() {}, stop() {}, watch() {}, refresh() {} });
let installPush = () => ({ start() {}, stop() {}, mount() {}, settle() {}, panelHtml() { return ""; }, bannerHtml() { return ""; } });
let installCompliance = () => ({ start() {}, stop() {}, bind() {}, abandon() {}, adminHtml() { return ""; }, staffHtml() { return ""; }, adminBannerHtml() { return ""; }, staffBannerHtml() { return ""; }, canSee() { return false; }, canEdit() { return false; }, canPrestart() { return false; }, prestartReminder() { return ""; }, focusPrestart() {}, canEditService() { return false; } });
let DEFAULT_WEIGHTS = {};
let canEditPerformanceSettings = () => false;
let canSeeStaffPerformance = () => false;
let performancePanelHtml = () => "";
let performanceSettingsHtml = () => "";
let periodBounds = () => ({ start: "", end: "" });
let rankPerformance = () => ({ rows: [] });
let sanitizeWeights = weights => weights || {};
let weightsFromForm = () => ({});
let canViewTake5 = () => false;
let hasTake5 = () => false;
let shouldPromptTake5 = () => false;
let take5Enabled = () => true;
let take5EntryVisible = ({ enabled = true } = {}) => enabled !== false;
let take5FormHtml = () => "";
let take5IdFor = () => "";
let take5JobHtml = () => "";
let take5ListHtml = () => "";
let take5Payload = () => ({});
let take5PhotoPath = () => "";
let take5StartButtonHtml = () => "";
let exportAllowed = () => false;
let hoursCsv = () => "";
let invoiceCsv = () => "";
let jobsCsv = () => "";
let reimbursementsCsv = () => "";
let formatReceiptMeasure = () => "";
let isVeoliaSupplier = () => false;
let nextPaidPersonallyControl = () => false;
let parseReceiptMeasures = () => ({});
let receiptDupKey = () => "";
let receiptHasMoney = () => false;
let receiptMeasureFields = () => "";
let receiptNeedsAmount = () => false;
let receiptOwedTotal = () => 0;
let receiptPaidPersonally = () => false;
let reimbursementFromReceipt = () => null;
let validateReceiptUpload = () => ({ ok: false });
let VEOLIA_PAID_NOTE = "";
let assignmentWarning = () => "";
let cellLeaveText = () => "";
let certificateContentType = () => "";
let certificateObjectName = name => name;
let certificateStoragePath = () => "";
let leaveCreateBody = () => ({});
let leaveDecisionBody = () => ({});
let leaveScreenHtml = () => "";
let newLeaveId = () => "";
let plannerLeaveHtml = () => "";
let saveCertificate = async () => {};
let certificateDownloadName = name => name;
let weekLeaveHtml = () => "";
let ACCOUNTS_TO = "";
let XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
let buildHoursReport = () => ({});
let deliverHoursFile = async () => {};
let exportFileName = () => "hours.xlsx";
let newExportId = () => "";
let reportSheets = () => [];
let xlsxBytes = () => new Uint8Array();
let claimCreateBody = () => ({});
let claimDecisionBody = () => ({});
let claimsScreenHtml = () => "";
let newClaimId = () => "";
let receiptContentType = () => "";
let receiptDownloadName = name => name;
let receiptObjectName = name => name;
let receiptStoragePath = () => "";
let RECEIPT_MAX_BYTES = 8 * 1024 * 1024;
let addressWithSuburb = value => value || "";
let bulkCandidates = () => [];
let canImportInbox = me => !!(me && (me.role === "admin" || me.role === "manager" || me.role === "supervisor" || me.staffRole === "manager" || me.staffRole === "supervisor"));
let composeAddress = () => "";
let defaultImportMode = () => "job";
let duplicateWarning = () => "";
let findExistingJob = () => null;
let isImported = () => false;
let parseInboxEmail = () => ({});
let forwardScreenHtml = () => "";
let jobFromDraft = () => ({ ok: false, reason: "loading" });
let inboundToken = () => "";
let collectSupervisorEmails = () => [];
let normalizeSupervisorEmail = () => "";
let readDraftEdits = (root, draft) => draft;
let INBOUND_DOMAIN = "inbound.callupapp.com.au";
let startDesktopInstall = () => {};
let refreshDesktopBanner = () => {};
let desktopBannerWouldShow = () => false;
let SHELL_VERSION = "callup-shell-v149-boot-timeout";
let prepareTicket = () => ({ ok: false, reason: "loading" });
let ticketDialogHtml = () => "";
let ticketFailureText = () => "The ticket could not be sent. Try again.";
let newTicketId = () => "";
let compressTicketShot = async () => { throw Object.assign(new Error("loading"), { code: "compress" }); };
let screenshotUploadPlan = () => ({ path: "", contentType: "image/jpeg", metadata: {} });
let masterTicketsHtml = () => "";
let ticketPage = () => "";
let featuresOn = false;
let packPromise = null;
function loadFeaturePack() {
  if (!packPromise) packPromise = (async () => {
    const [quotes, help, capacity, cloudStorage, retention, jobEmail, gallery, capture, documents, chatUi, push, compliance, performance, take5, exportsMod, receipts, leave, hours, claims, inbox, desktop, inbound, supportTickets] = await Promise.all([
      import("./features/quotes.js"),
      import("./features/help.js"),
      import("./features/capacity.js"),
      import("./features/cloud-storage.js"),
      import("./features/cloud-retention.js"),
      import("./features/job-email.js"),
      import("./features/photo-gallery.js"),
      import("./features/photo-capture.js"),
      import("./features/job-documents.js"),
      import("./features/chat-ui.js"),
      import("./features/push.js"),
      import("./features/compliance.js"),
      import("./features/performance.js"),
      import("./features/take5.js"),
      import("./features/company-exports.js"),
      import("./features/receipts.js"),
      import("./features/leave.js"),
      import("./features/hours-export.js"),
      import("./features/claims.js"),
      import("./features/inbox-import.js"),
      import("./features/desktop-install.js"),
      import("./features/inbound-forward.js"),
      import("./features/support-ticket.js"),
    ]);
    ({ installQuotes, adminViewRouter, quoteRatesSettingsBlurb, setDefaultDepot, setQuoteTradeSetup, setQuoteFocus } = quotes);
    ({ askHelp, helpAnswerHtml, helpPanelHtml, helpVisible } = help);
    ({ capacityViewHtml, shiftWeek } = capacity);
    ({ planJobPhotoMirrors, planStaffReceiptCapture, resolveMembership, putPlanned, jobPhotoPrefix, storageErrorCode, summarizePhotoListing } = cloudStorage);
    ({ buildOperationalExport, retentionAdminText, retentionView } = retention);
    ({ buildJobEmail, compressImageBlob, deviceCanShareFiles, emailSendPlan, emailSheetHtml, jpegName, mailtoHref, parseEmailRecipients, photoBudget, photosZip, selectEmailAttachments, shareText, suggestRecipient, uniqueNames } = jobEmail);
    ({ buildJobGallery, stampExpiresAfter, galleryExportPhotos, photoSlotHtml, lightboxHtml, photoFailureText } = gallery);
    ({ decidePhotoEmail } = capture);
    ({ mountDocuments, unmountDocuments, openDocumentBlob, canManageDocuments, flushDocumentQueue, sharedQueue } = documents);
    ({ installChatApp } = chatUi);
    ({ installPush } = push);
    ({ installCompliance } = compliance);
    ({ DEFAULT_WEIGHTS, canEditPerformanceSettings, canSeeStaffPerformance, performancePanelHtml, performanceSettingsHtml, periodBounds, rankPerformance, sanitizeWeights, weightsFromForm } = performance);
    ({ canViewTake5, hasTake5, shouldPromptTake5, take5Enabled, take5EntryVisible, take5FormHtml, take5IdFor, take5JobHtml, take5ListHtml, take5Payload, take5PhotoPath, take5StartButtonHtml } = take5);
    ({ exportAllowed, hoursCsv, invoiceCsv, jobsCsv, reimbursementsCsv } = exportsMod);
    ({ formatReceiptMeasure, isVeoliaSupplier, nextPaidPersonallyControl, parseReceiptMeasures, receiptDupKey, receiptHasMoney, receiptMeasureFields, receiptNeedsAmount, receiptOwedTotal, receiptPaidPersonally, reimbursementFromReceipt, validateReceiptUpload, VEOLIA_PAID_NOTE } = receipts);
    ({ assignmentWarning, cellLeaveText, certificateContentType, certificateObjectName, certificateStoragePath, leaveCreateBody, leaveDecisionBody, leaveScreenHtml, newLeaveId, plannerLeaveHtml, saveCertificate, certificateDownloadName, weekLeaveHtml } = leave);
    ({ ACCOUNTS_TO, XLSX_MIME, buildHoursReport, deliverHoursFile, exportFileName, newExportId, reportSheets, xlsxBytes } = hours);
    ({ claimCreateBody, claimDecisionBody, claimsScreenHtml, newClaimId, receiptContentType, receiptDownloadName, receiptObjectName, receiptStoragePath, RECEIPT_MAX_BYTES } = claims);
    ({ addressWithSuburb, bulkCandidates, canImportInbox, composeAddress, defaultImportMode, duplicateWarning, findExistingJob, isImported, parseInboxEmail } = inbox);
    ({ startDesktopInstall, refreshDesktopBanner, desktopBannerWouldShow } = desktop);
    ({ forwardScreenHtml, jobFromDraft, inboundToken, collectSupervisorEmails, normalizeSupervisorEmail, readDraftEdits, INBOUND_DOMAIN } = inbound);
    ({ SHELL_VERSION, prepareTicket, ticketDialogHtml, ticketFailureText, newTicketId, compressTicketShot, screenshotUploadPlan, masterTicketsHtml, ticketPage } = supportTickets);
    featuresOn = true;
    mountFeatureApps();
  })();
  return packPromise;
}

const cfg = useEmulator ? { ...firebaseConfig, apiKey: "demo-key", projectId: "demo-heartwood" } : firebaseConfig;
const fb = initializeApp(cfg);
const auth = getAuth(fb);
// Stay signed in on this phone. A cold start with no signal must not ask for the password again.
setPersistence(auth, browserLocalPersistence).catch(() => {});
// Offline cache: jobs already loaded stay readable and writes queue until the phone is back online.
const db = initializeFirestore(fb, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
const storage = getStorage(fb);
// One in-flight read per document. Company and staff docs are asked for from the boot path and again from offline warm-up.
// A boot timeout drops the stored read so Retry starts a new server read instead of joining the stalled one.
const docReads = new Map();
let bootGuard = null;
let bootGen = 0;
function cachedGetDoc(ref, ms = 0, label = "") {
  const key = ref && (ref.path || ref._path);
  if (!key) return ms ? withTimeout(getDoc(ref), ms, label || "doc") : getDoc(ref);
  return trackRead(docReads, key, () => getDoc(ref), ms, label || key);
}
if (useEmulator) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}
if ("serviceWorker" in navigator && !useEmulator) navigator.serviceWorker.register("sw.js", { scope: "./" });
const offlineStore = sharedOfflineStore();
let localWrites = [];
let syncPaint = 0;
let flushBusy = false;
function rememberWrite(item) { localWrites = noteWrite(localWrites, item); paintSync(); }
function forgetWrite(id) { localWrites = clearWrite(localWrites, id); paintSync(); }
// Firestore resolves a write only after the server answers. settleOrQueue lets the form close;
// the original promise still settles later and drops the row from the pending list.
function queueWrite(writePromise, item, doneToast, opts = {}) {
  const announce = opts.announce !== false;
  let pending = true;
  let queued = false;
  // Resolve either way so a late server refusal does not become an unhandled rejection
  // after the form has already closed.
  const tracked = Promise.resolve(writePromise).then(value => {
    pending = false;
    if (item && item.id) forgetWrite(item.id);
    return { ok: true, value };
  }, err => {
    pending = false;
    if (item && item.id) forgetWrite(item.id);
    if (queued && !opts.quietFail) toast("Not saved: " + ((err && (err.code || err.message)) || "failed"));
    return { ok: false, err };
  });
  return settleOrQueue(tracked, opts.ms).then(result => {
    if (result.queued && pending && item && item.id) {
      queued = true;
      rememberWrite(item);
      if (announce) toast(SAVED_ON_PHONE);
      return { queued: true };
    }
    const body = result.value;
    if (!body || body.ok === false) throw (body && body.err) || new Error("Not saved");
    if (doneToast && announce) toast(doneToast);
    paintSync();
    return { queued: false, value: body.value };
  });
}
function paintSync() {
  const n = ++syncPaint;
  pendingSnapshot().then(snap => {
    if (n !== syncPaint) return;
    const chip = $("#syncchip");
    if (!chip) return;
    const model = indicatorModel({ online: deviceOnline(), pendingCount: snap.items.length });
    chip.hidden = false;
    chip.className = "syncchip " + model.mode;
    chip.textContent = model.text;
    chip.setAttribute("aria-label", model.text);
    chip.dataset.pending = String(model.pending);
    const off = !deviceOnline();
    document.querySelectorAll("#emailjob").forEach(btn => {
      btn.disabled = off;
      btn.title = off ? needsSignal("email-job", false).message : "";
    });
    document.querySelectorAll("#billsub, #billportal, #trialsub").forEach(btn => {
      btn.disabled = off;
      btn.title = off ? needsSignal("billing", false).message : "";
    });
  }).catch(() => {});
}
async function pendingSnapshot() {
  const uid = me && me.uid;
  const uploads = uid ? await offlineStore.listFiles(uid) : [];
  const outbox = uid ? await offlineStore.listOutbox(uid) : [];
  let documents = [];
  if (uid) { try { documents = await sharedQueue().list(uid); } catch { documents = []; } }
  const items = pendingEntries({ writes: localWrites, uploads, outbox, documents });
  return { items, uploads, outbox, documents };
}
function openSyncList() {
  pendingSnapshot().then(snap => {
    document.querySelectorAll(".syncover").forEach(node => node.remove());
    const model = indicatorModel({ online: deviceOnline(), pendingCount: snap.items.length });
    const v = document.createElement("div");
    v.className = "emdlg syncover";
    v.innerHTML = `<div class="embox synclist"><h3>${esc(model.text)}</h3>${pendingListHtml(snap.items)}<p class="sub">Photos, receipts and documents stay on this phone until they upload. Job notes, clock times and forms sync through the app's saved copy.</p><button type="button" class="mbtn" data-x>Close</button></div>`;
    document.body.appendChild(v);
    v.querySelector("[data-x]").onclick = () => v.remove();
    v.onclick = ev => { if (ev.target === v) v.remove(); };
  }).catch(() => {});
}
const syncChip = document.querySelector("#syncchip");
if (syncChip) syncChip.onclick = () => openSyncList();
function wakeNetwork() {
  enableNetwork(db).catch(err => console.warn("enableNetwork", err && (err.code || err.message)));
}
window.addEventListener("online", () => { ui.warmKey = ""; paintSync(); flushOffline().catch(() => {}); warmUpcoming().catch(() => {}); wakeNetwork(); });
window.addEventListener("offline", () => paintSync());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") wakeNetwork();
});
if (navigator.serviceWorker) navigator.serviceWorker.addEventListener("message", ev => {
  if (ev.data && ev.data.type === "callup-sync") flushOffline().catch(() => {});
});

// ------------------------------------------------------------------ constants / helpers
// Client names for job/quote forms. Heartwood's builders by default; replaced in place per company (refreshClientLists).
export const CLIENTS = ["Orbit Homes (Qld) Pty Ltd", "Torsion Built Pty Ltd", "Silkwood Homes", "OJ Pippin Homes", "Envision Homes", "Private"];
const TYPES = { spoil: "Spoil removal", backslab: "Backslab", waterproof: "Waterproofing", clean: "Site clean", other: "Other" };
const STATUSES = ["Scheduled", "In progress", "Done", "Cancelled"];
const TZ = "Australia/Brisbane";
const $ = (s, el = document) => el.querySelector(s);
function paintApp(html) {
  if (bootGuard) {
    bootGuard.stage("first paint");
    bootGuard.done();
  }
  const root = $("#app");
  if (root) root.innerHTML = html;
}
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ymd = d => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);           // YYYY-MM-DD in Brisbane
const todayStr = () => (window.HW_TODAY || ymd(new Date()));
const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayLabel = s => new Date(s + "T00:00:00Z").toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
const dowMon = s => (new Date(s + "T00:00:00Z").getUTCDay() + 6) % 7;      // 0 = Monday
const mapsUrl = a => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(a + ", QLD");
function undoToast(msg, undo, ms = 7000) {
  const t = $("#toast"); t.innerHTML = `${esc(msg)} <button type="button" class="toast-undo">Undo</button>`; t.classList.remove("hidden");
  t.querySelector(".toast-undo").onclick = async () => { t.classList.add("hidden"); try { await undo(); } catch (e) { toast("Undo failed: " + (e.code || e.message)); } };
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add("hidden"), ms);
}
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add("hidden"), 2500); }
function showAccountChrome(on) {
  $("#logout")?.classList.toggle("hidden", !on);
  const signedIn = on && (me ? helpVisible(me) : true);
  $("#helpbtn")?.classList.toggle("hidden", !signedIn);
  $("#ticketbtn")?.classList.toggle("hidden", !(on && me));
}
function helpContext() {
  return {
    role: me && me.role,
    staffRole: me && me.staffRole,
    canSeeMoney: typeof canSeeMoney === "function" ? canSeeMoney() : false,
    companyId: typeof myCompanyId === "function" ? myCompanyId() : "",
  };
}
function paintHelpAnswer(answer) {
  const log = $("#helplog");
  if (!log || !answer) return;
  log.insertAdjacentHTML("beforeend", helpAnswerHtml(answer));
  log.scrollTop = log.scrollHeight;
}
async function submitHelpQuestion(question) {
  const text = String(question || "").trim();
  if (!text) return;
  const log = $("#helplog");
  if (log) log.insertAdjacentHTML("beforeend", `<p class="callup-help-ask"><b>You.</b> ${esc(text)}</p>`);
  const answer = await askHelp(text, helpContext(), (name, data) => callAuthed(name, data));
  paintHelpAnswer(answer);
}
function goHelp(view) {
  const panel = $("#helppanel");
  if (panel) panel.remove();
  if (!me) return;
  const admin = me.role === "admin" && !ui.myJobs;
  if (admin) {
    ui.view = view === "timesheet" ? "timesheet" : view;
    ui.navOpen = false;
    renderAdmin();
    return;
  }
  const tabs = { jobs: "week", home: "today", timesheet: "hours", quotes: "quotes", staff: "staff", leave: "leave", prestart: "prestart", take5: "take5", settings: "settings", chat: "more", clients: "more" };
  ui.opSel = null;
  ui.opTab = tabs[view] || "more";
  renderOperator();
}
async function openHelp() {
  if (!helpVisible(me || { uid: "signed-in" })) return;
  await loadFeaturePack();
  let panel = $("#helppanel");
  if (panel) { panel.remove(); return; }
  document.body.insertAdjacentHTML("beforeend", helpPanelHtml(helpContext()));
  panel = $("#helppanel");
  $("#helpx").onclick = () => panel.remove();
  panel.querySelectorAll("[data-help-q]").forEach(btn => btn.onclick = () => submitHelpQuestion(btn.dataset.helpQ));
  $("#helpform").onsubmit = ev => {
    ev.preventDefault();
    const q = ev.target.q.value;
    ev.target.q.value = "";
    submitHelpQuestion(q);
  };
  panel.addEventListener("click", ev => {
    const go = ev.target.closest && ev.target.closest("[data-help-go]");
    if (go) goHelp(go.dataset.helpGo);
  });
}
document.addEventListener("click", ev => {
  const open = ev.target.closest && ev.target.closest("[data-open-help]");
  if (open) { ev.preventDefault(); openHelp(); }
});
document.addEventListener("click", ev => {
  const btn = ev.target.closest && ev.target.closest("[data-raise-ticket]");
  if (!btn) return;
  ev.preventDefault();
  openTicketDialog();
});
const ticketShotUrls = new Set();
async function openTicketDialog() {
  if (!me) return;
  await loadFeaturePack();
  document.querySelectorAll(".ticketover").forEach(node => node.remove());
  const v = document.createElement("div");
  v.className = "emdlg ticketover";
  v.innerHTML = ticketDialogHtml();
  document.body.appendChild(v);
  const close = () => v.remove();
  v.querySelector("[data-x]").onclick = close;
  v.onclick = ev => { if (ev.target === v) close(); };
  const form = v.querySelector("#ticketform");
  form.onsubmit = async ev => {
    ev.preventDefault();
    const err = form.querySelector("#ticketerr");
    const file = form.shot.files && form.shot.files[0];
    let id = "";
    try { id = newTicketId(); } catch { if (err) err.textContent = ticketFailureText("save"); return; }
    const prepared = prepareTicket({
      id,
      subject: form.subject.value,
      description: form.description.value,
      file: file || null,
      uid: me.uid,
      name: me.name,
      email: auth.currentUser && auth.currentUser.email,
      role: me.staffRole || me.role,
      companyId: myCompanyId(),
      companyName: orgSettings().name,
      appVersion: SHELL_VERSION,
      swVersion: SHELL_VERSION,
      userAgent: navigator.userAgent,
      page: ticketPage(location, (me.role === "admin" && !ui.myJobs) ? ui.view : ui.opTab),
    });
    if (!prepared.ok) { if (err) err.textContent = ticketFailureText(prepared.reason); return; }
    const submit = form.querySelector("[type=submit]");
    if (submit) submit.disabled = true;
    try {
      if (prepared.screenshotPath) {
        const blob = await compressTicketShot(file);
        const plan = screenshotUploadPlan(prepared.screenshotPath, { uid: me.uid, companyId: myCompanyId(), ticketId: prepared.id });
        await uploadBytes(storageRef(storage, plan.path), blob, { contentType: plan.contentType, customMetadata: plan.metadata });
      }
      await setDoc(doc(db, "supportTickets", prepared.id), { ...prepared.doc, createdAt: serverTimestamp() });
      close();
      toast("Ticket sent. CallUp support has been notified.");
    } catch (e) {
      if (submit) submit.disabled = false;
      const code = e && (e.code || "");
      if (err) err.textContent = ticketFailureText(String(code).includes("storage/") ? "upload" : (e && e.code) || "save");
    }
  };
}
function paintTicketShots(root) {
  for (const url of ticketShotUrls) URL.revokeObjectURL(url);
  ticketShotUrls.clear();
  root.querySelectorAll("[data-ticket-shot]").forEach(img => {
    const path = img.dataset.ticketShot;
    if (!path) return;
    getBlob(storageRef(storage, path)).then(blob => {
      const url = URL.createObjectURL(blob);
      ticketShotUrls.add(url);
      img.src = url;
    }).catch(() => { img.alt = "Screenshot unavailable"; });
  });
}
// Firestore retries a transaction, then fails with failed-precondition when someone else wrote first.
function txFail(e) {
  const code = String((e && (e.code || e.message)) || "");
  return code.includes("failed-precondition") ? "Someone else just changed this, try again" : (code || "Not saved");
}
function guessType(text) {
  const t = (text || "").toLowerCase();
  const keys = [["slab back blade", "backslab"], ["slab clean", "backslab"], ["back slab", "backslab"], ["backslab", "backslab"], ["spoil", "spoil"], ["clean", "clean"]];
  const hits = keys.filter(([k]) => t.includes(k)).map(([k, v]) => [t.indexOf(k), -k.length, v]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return hits.length ? hits[0][2] : "other";
}

let me = null, staff = [], jobs = [], unsub = null;
let signingUp = false;
let CHAT = { badge() { return ""; }, teamHtml() { return ""; }, jobHtml() { return ""; }, mount() {}, openJob() {}, start() {}, stop() {}, watch() {}, refresh() {} };
let PUSH = { start() {}, stop() {}, mount() {}, settle() {}, panelHtml() { return ""; }, bannerHtml() { return ""; } };
let COMP = { start() {}, stop() {}, bind() {}, abandon() {}, adminHtml() { return ""; }, staffHtml() { return ""; }, adminBannerHtml() { return ""; }, staffBannerHtml() { return ""; }, canSee() { return false; }, canEdit() { return false; }, canPrestart() { return false; }, prestartReminder() { return ""; }, focusPrestart() {}, canEditService() { return false; } };
let QG = { bindAdmin() {} }; // Quotes module; filled after helpers load
let ROUTE = { open() {} };
const ALEX_UID = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";      // Alex has no users/{uid} profile doc; always staff
const ui = { view: "list", staffF: "", typeF: "", photoLists: {}, photoUrls: {}, photoBlobs: {}, photoThumbs: {}, photoThumbTasks: {}, photoErrors: {}, photoJobs: {}, photoPaint: 0, queuedThumbs: {}, holdSideWork: true, startupQueue: [] };
const ADMIN_SAFE = new Set(["home", "jobs", "unscheduled", "completed", "swms", "crew", "master", "clients"]);
const OP_SAFE = new Set(["today", "week", "done", "more", "crew"]);
function queueStartup(fn) { ui.startupQueue.push(fn); }
let deferredBoot = false;
function noteFirstScreen() {
  if (!me || ui.firstScreen) return;
  ui.firstScreen = true;
  const kick = () => {
    const idle = window.requestIdleCallback || (cb => setTimeout(cb, 50));
    idle(() => { beginDeferredStartup().catch(err => console.warn("startup", err && (err.message || err))); }, { timeout: 1500 });
  };
  if (window.requestAnimationFrame) requestAnimationFrame(kick);
  else setTimeout(kick, 0);
}
async function beginDeferredStartup() {
  if (deferredBoot || !me) return;
  deferredBoot = true;
  ui.holdSideWork = false;
  const queued = ui.startupQueue.splice(0);
  for (const fn of queued) {
    try { fn(); } catch (err) { console.warn("startup", err && (err.message || err)); }
  }
  await loadFeaturePack();
  if (!me) return;
  watchPrestartNotices();
  watchLocationNotice();
  watchTake5Flag();
  warmUpcoming(jobs).catch(() => {});
  loadTradeSetup(ui.companyRecord || { companyId: myCompanyId() }).catch(() => {});
  flushOffline().catch(() => {});
  paintSync();
  if (me.role === "admin" && !ui.myJobs) renderAdmin();
  else renderOperator();
}
bootGuard = startBootWatch();
paintSync();

// ------------------------------------------------------------------ auth
try { captureReferralParam(location.search, localStorage); } catch { /* private mode */ }
$("#logout").onclick = () => signOut(auth);
$("#helpbtn")?.addEventListener("click", () => openHelp());
onAuthStateChanged(auth, user => {
  bootSignedIn(user).catch(err => console.warn("boot", err && (err.code || err.message || err)));
});

async function bootSignedIn(user) {
  if (signingUp) return;
  const gen = ++bootGen;
  const live = () => gen === bootGen;
  if (bootGuard) bootGuard.stage("auth");
  if (!user || (me && user && me.uid !== user.uid)) liveShareStop(false);
  if (unsub) { unsub(); unsub = null; }
  CHAT.stop();
  PUSH.stop();
  COMP.stop();
  const inviteToken = new URLSearchParams(location.search).get("invite") || "";
  if (!user) {
    me = null; setActiveCompany(null); $("#who").textContent = ""; showAccountChrome(false);
    if (inviteToken || window.HW_INVITE_PREVIEW) return renderInviteAccept(inviteToken);
    const friendCode = new URLSearchParams(location.search).get("friend") || "";
    if (friendCode) return renderSignup(friendCode);
    return renderLogin();
  }
  if (inviteToken) return renderInviteSignedIn();
  // Admin = UID listed in firestore.rules (Alex, sync, Patrick): detected by being ALLOWED to list users - so if the
  // rules don't (yet) make someone admin they simply fall back to the operator view.
  // users/{uid}.role: "labourer" / "operator" (crew, no $, same access) | "supervisor" (staff shell + canSeeMoney)
  // | "manager" (supervisor, plus company rates, leave decisions and staff up to manager) | "admin".
  // A manager cannot change billing, the plan, company details, or an admin. A manager can change the trade list. Patrick is rules-admin with an operator profile (bookable).
  if (bootGuard) bootGuard.stage("profile");
  let snap = null;
  const userRef = doc(db, "users", user.uid);
  try { snap = await cachedGetDoc(userRef, 8000, "users/" + user.uid); }
  catch {
    try { snap = await getDocFromCache(userRef); }
    catch { snap = null; }
  }
  if (!live()) return;
  const prof = snap && snap.exists() ? snap.data() : null;
  // No signal and no saved profile: stay signed in. Do not show the "no company" screen.
  if (!prof && profileMiss({ online: deviceOnline(), cached: false }).action === "offline-hold") {
    renderOfflineSignedIn(user);
    return;
  }
  // Heartwood admins list only Heartwood profiles (rules deny every other company's staff).
  // Other companies' admins/supervisors use their own profile role below, so this list is Heartwood-only.
  let users = null;
  if (docCompanyId(prof || {}) === "heartwood") {
    const usersQ = query(collection(db, "users"), where("companyId", "==", "heartwood"));
    users = await readOrCache(
      () => getDocs(usersQ),
      () => getDocsFromCache(usersQ),
      8000,
      "users",
    ).catch(() => null);
  }
  if (!live()) return;
  if (!prof && !users) { renderNoAccess(user); return; }
  const bootstrapAdmin = user.uid === ALEX_UID || user.uid === "R7t41e54Ykcdk9WPdVZnDd697iI2";
  const roleAdmin = !!(prof && prof.role === "admin");
  me = users || bootstrapAdmin || roleAdmin
    ? { uid: user.uid, name: (prof && prof.name) || (bootstrapAdmin ? "Alex" : "Admin"), role: "admin", staffRole: prof && prof.role }
    : { uid: user.uid, ...prof };
  me.cloudProfile = prof;
  FOREIGN_UIDS = new Set();
  HOME_UIDS = users ? users.docs.filter(d => docCompanyId(d.data()) === "heartwood").map(d => d.id) : [];
  const token = await withTimeout(user.getIdTokenResult(), 6000, "id-token").catch(() => null);
  if (!live()) return;
  me.platformOwner = isPlatformOwner({
    uid: user.uid,
    email: user.email,
    emailVerified: user.emailVerified === true || token?.claims?.email_verified === true,
    claims: token?.claims || {},
  });
  me.testCompanyId = "";
  let sessionCompanyId = "";
  let sessionStore = null;
  try { sessionStore = sessionStorage; } catch { sessionStore = null; }
  const returnMaster = takeReturnMasterFlag(sessionStore);
  if (bootGuard) bootGuard.stage("company");
  if (me.platformOwner) {
    const sessRef = doc(db, "platformSessions", user.uid);
    const sess = await readOrCache(
      () => getDoc(sessRef),
      () => getDocFromCache(sessRef),
      8000,
      "platformSessions/" + user.uid,
    ).catch(() => null);
    if (!live()) return;
    sessionCompanyId = sess && sess.exists() ? String(sess.data().companyId || "").trim() : "";
  }
  const companyView = bootCompanyView({
    platformOwner: !!me.platformOwner,
    sessionCompanyId,
    urlMarked: urlMarksCompanyView(location.search),
    navType: navigationType(),
    returnMaster,
  });
  let companyViewClearFailed = false;
  if (companyView.clearSession) {
    try { await withTimeout(setDoc(doc(db, "platformSessions", user.uid), clearedCompanySession()), 5000, "platformSessions"); }
    catch (e) {
      companyViewClearFailed = true;
      console.warn("leave company view", e && (e.code || e.message));
    }
  }
  if (!live()) return;
  if (companyView.action === "stay" || companyView.action === "stay-and-mark" || (companyViewClearFailed && sessionCompanyId)) {
    me.testCompanyId = companyViewClearFailed ? sessionCompanyId : companyView.companyId;
    try { sessionStorage.setItem(IN_COMPANY_VIEW_KEY, "1"); } catch { /* private mode: the session doc still restores this view */ }
    if (companyView.action === "stay-and-mark" || companyViewClearFailed || !urlMarksCompanyView(location.search)) {
      const marked = withCompanyViewParam(location.href, true);
      try { history.pushState(companyHistoryState(me.testCompanyId), "", marked); } catch { /* the banner still leaves the company */ }
    }
  } else if (companyView.action === "master") {
    try { sessionStorage.removeItem(IN_COMPANY_VIEW_KEY); } catch { /* the session doc is already clear */ }
    clearSavedOrg();
    setActiveCompany(null);
    try { history.replaceState(masterHistoryState(), "", withCompanyViewParam(location.href, false)); } catch { /* Master still opens */ }
    ui.landOnMaster = true;
  } else if (companyView.action === "strip-mark") {
    try { history.replaceState({ callupView: "home" }, "", withCompanyViewParam(location.href, false)); } catch { /* the param is only a marker */ }
  }
  await loadCompanyBrand();
  if (!live()) return;
  $("#who").textContent = `${me.name} · ${me.role}`; showAccountChrome(true);
  if (ui.companyAccess && ui.companyAccess.paused) {
    renderAccountPaused();
    return;
  }
  showBillingNote();
  ui.staffLogins = [];
  ui.staffLoginsErr = "";
  CLI = null; refreshClientLists();
  ui.emailRecipients = [];
  ui.emailRecipientsFor = "";
  ui.ownReceipts = [];
  ui.jobReceiptRows = [];
  queueStartup(() => {
    if (myCompanyId() !== "heartwood" && (me.role === "admin" || me.role === "manager" || me.role === "supervisor")) loadClients().catch(() => {});
    else if (myCompanyId() === "heartwood") loadClients().catch(() => {});
    loadEmailRecipients();
    watchOwnClock();
    swmsSub();
    leaveStart();
    claimsStart();
    if (me.platformOwner) watchMaster();
  });
  if (me.role === "admin") {
    if (window.HW_PREVIEW_VIEW === "staff") ui.view = "staff";
    if (window.HW_PREVIEW_VIEW === "settings" || window.HW_PREVIEW_VIEW === "company") ui.view = "settings";
    if (window.HW_PREVIEW_VIEW === "master" && me.platformOwner) ui.view = "master";
    if (ui.landOnMaster && me.platformOwner) ui.view = "master";
    const ticketQ = new URLSearchParams(location.search).get("ticket") || "";
    if (/^[A-Za-z0-9]{16,28}$/.test(ticketQ)) ui.ticketFocus = ticketQ;
    if (ui.ticketFocus && me.platformOwner && !me.testCompanyId) ui.view = "master";
    const companyId = myCompanyId();
    const staffSnap = (companyId === "heartwood" && users) || await getDocs(query(collection(db, "users"), where("companyId", "==", companyId))).catch(() => null);
    if (!live()) return;
    // When the unscoped users list is denied, still know this company's own staff so legacy (no companyId) Heartwood sheets load.
    if (!users && staffSnap) HOME_UIDS = staffSnap.docs.filter(d => docCompanyId(d.data()) === companyId).map(d => d.id);
    const logins = (staffSnap ? staffSnap.docs : []).map(d => ({ uid: d.id, ...d.data() }))
      .filter(u => (u.companyId || u.tenantId || "heartwood") === companyId)
      .filter(u => CREW_ROLES.includes(u.role) || u.role === "supervisor" || u.role === "manager");
    staff = companyId === "heartwood"
      ? [{ uid: ALEX_UID, name: "Alex" }, ...logins.filter(u => u.uid !== ALEX_UID)]
      : logins;
    // Today and tomorrow first, so Home can paint. The full office window follows after that paint.
    let windowJobs = [], staleJobs = [];
    const setJobs = () => { jobs = mergeJobLists(windowJobs, staleJobs).map(withMoney); addNameOnlyStaff(jobs); };
    const nearQ = companyJobs([where("date", ">=", todayStr()), where("date", "<=", addDays(todayStr(), 1)), orderBy("date")]);
    let stopNear = onSnapshot(nearQ, s => { windowJobs = s.docs.map(d => ({ id: d.id, ...d.data() })); setJobs(); renderAdmin(); }, e => { console.warn("jobs", e.code, e.message); windowJobs = []; setJobs(); renderAdmin(); });
    const stopShared = () => { CHAT.stop(); PUSH.stop(); COMP.stop(); stopPrestartNotices(); stopLocationNotice(); tsStop(); leaveStop(); claimsStop(); clockWatchStop(); leaveCrewScreen(); perfStop(); if (ui.swmsUnsub) ui.swmsUnsub(); if (ui.masterUnsub) ui.masterUnsub(); ui.masterUnsub = null; };
    unsub = () => { stopNear(); stopShared(); };
    queueStartup(() => {
      stopNear();
      stopNear = () => {};
      // two weeks back (catch overdue work) to 4 weeks ahead, plus anything undated
      const q = companyJobs([where("date", ">=", addDays(todayStr(), -14)), where("date", "<=", addDays(todayStr(), 28)), orderBy("date")]);
      // Older jobs still open (Scheduled / In progress, dated before the window) stay in the office list and search.
      const u1 = onSnapshot(q, s => { windowJobs = s.docs.map(d => ({ id: d.id, ...d.data() })); setJobs(); renderAdmin(); queueDispatchPersist(jobs); }, e => { console.warn("jobs", e.code, e.message); windowJobs = []; setJobs(); renderAdmin(); });
      const u5 = onSnapshot(companyJobs([where("status", "in", [...OPEN_STATUSES])]), s => {
        staleJobs = staleOpenJobs(s.docs.map(d => ({ id: d.id, ...d.data() })), todayStr()); setJobs(); renderAdmin(); queueDispatchPersist(jobs);
      }, e => console.warn("older open jobs", e.code, e.message));
      // Invoicing: every Done job (any date), admin only.
      const u2 = onSnapshot(companyJobs([where("status", "==", "Done")]), s => { ui.done = s.docs.map(d => withMoney({ id: d.id, ...d.data() })); donePill(); if (ui.view === "invoices" || ui.view === "completed" || ui.view === "home") renderAdmin(); }, e => console.warn("done jobs", e.code || e.message));
      const u3 = onSnapshot(query(collection(db, "incidents"), where("companyId", "==", myCompanyId())), s => { ui.incidents = s.docs.map(d => ({ id: d.id, ...d.data() })); ui.perfIncState = "ok"; if (ui.view === "safety" || ui.view === "home" || ui.view === "staff") renderAdmin(); incRefresh(); }, e => { ui.perfIncState = "absent"; console.warn("incidents", e.code); });
      const u4 = onSnapshot(query(collection(db, "invites"), where("tenantId", "==", myTenant()), where("role", "in", [...myInviteRoles()])), s => {
        ui.invites = s.docs.map(d => ({ id: d.id, ...d.data() })); ui.invitesErr = "";
        if (ui.view === "staff") renderAdmin();
        watchInviteMail();
      }, e => { ui.invites = []; ui.invitesErr = e.code || "permission-denied"; if (ui.view === "staff") renderAdmin(); });
      // Company logins for the Staff tab. onSnapshot reads the persistent cache when the phone is offline.
      const u6 = watchStaffRoster();
      moneyStart(renderAdmin);
      const stopCap = startCapacityWatch();
      unsub = () => { u1(); u2(); u3(); u4(); u5(); u6(); stopCap(); moneyStop(); stopShared(); };
      getDocs(companyJobs([where("date", "==", "")])).then(s => { ui.undated = s.docs.map(d => withMoney({ id: d.id, ...d.data() })); addNameOnlyStaff(ui.undated); renderAdmin(); }).catch(e => console.warn("undated", e.code, e.message));
    });
  } else {
    // Operators may only list jobs assigned to them (enforced by firestore.rules).
    // A date filter on top of array-contains needs an index this app does not add, so crew startup stays this query.
    const q = companyJobs([where("assigned", "array-contains", user.uid)]);
    const u1 = onSnapshot(q, s => { jobs = s.docs.map(d => withMoney({ id: d.id, ...d.data() })); renderOperator(); });
    const stopShared = () => { CHAT.stop(); PUSH.stop(); COMP.stop(); stopPrestartNotices(); stopLocationNotice(); tsStop(); leaveStop(); claimsStop(); clockWatchStop(); leaveCrewScreen(); perfStop(); if (ui.swmsUnsub) ui.swmsUnsub(); };
    unsub = () => { u1(); stopShared(); };
    queueStartup(() => {
      // Company supervisors are office (they already read quotes); crew never subscribe and the rules refuse them.
      moneyStart(renderOperator);
      const u3 = onSnapshot(query(collection(db, "incidents"), where("companyId", "==", myCompanyId()), where("reportedBy", "==", user.uid)), s => { ui.incidents = s.docs.map(d => ({ id: d.id, ...d.data() })); if (!ui.opSel && (ui.opTab || "today") === "today") renderOperator(); incRefresh(); }, e => console.warn("incidents", e.code));
      const u4 = canInvite()
        ? onSnapshot(query(collection(db, "invites"), where("tenantId", "==", myTenant()), where("role", "in", [...myInviteRoles()])), s => {
          ui.invites = s.docs.map(d => ({ id: d.id, ...d.data() })); ui.invitesErr = "";
          if ((ui.opTab || "today") === "staff") renderOperator();
          watchInviteMail();
        }, e => { ui.invites = []; ui.invitesErr = e.code || "permission-denied"; if ((ui.opTab || "today") === "staff") renderOperator(); })
        : () => {};
      const u6 = watchStaffRoster();
      if (canInvite() && window.HW_PREVIEW_VIEW === "staff") ui.opTab = "staff";
      const stopCap = startCapacityWatch();
      unsub = () => { u1(); u3(); u4(); u6(); stopCap(); moneyStop(); stopShared(); };
    });
  }
}

function startBootWatch() {
  return bootWatchdog({
    ms: 12000,
    onStall(stage) { renderBootStall(stage); },
  });
}
function renderBootStall(stage) {
  const where = stage || "start";
  console.warn("Stuck at: " + where);
  const root = $("#app");
  if (!root) return;
  root.innerHTML = bootStallHtml(where);
  const retry = $("#bootretry");
  const reload = $("#bootreload");
  const out = $("#bootsignout");
  if (retry) retry.onclick = () => { retryBoot().catch(err => console.warn("boot retry", err && (err.code || err.message || err))); };
  if (reload) reload.onclick = () => location.reload();
  if (out) out.onclick = () => signOut(auth);
}
let bootRetrying = false;
async function retryBoot() {
  if (bootRetrying) return;
  bootRetrying = true;
  try {
    docReads.clear();
    try { await disableNetwork(db); }
    catch (e) { console.warn("boot retry", e && (e.code || e.message)); }
    try { await enableNetwork(db); }
    catch (e) { console.warn("boot retry", e && (e.code || e.message)); }
    if (bootGuard) bootGuard.done();
    bootGuard = startBootWatch();
    await bootSignedIn(auth.currentUser || null);
  } finally {
    bootRetrying = false;
  }
}

function myCompanyId() {
  if (me && me.testCompanyId) return me.testCompanyId;
  const profile = me && me.cloudProfile;
  const company = profile && typeof profile.companyId === "string" ? profile.companyId.trim() : "";
  if (company) return company;
  const tenant = profile && typeof profile.tenantId === "string" ? profile.tenantId.trim() : "";
  return tenant || "heartwood";
}
function myTenant() {
  return myCompanyId();
}
function companyJobs(constraints = []) {
  return query(collection(db, "jobs"), where("companyId", "==", myCompanyId()), ...constraints);
}
// ---- Job money (round 3, Q6): PO value and accepted-quote total live in jobMoney/{jobId}, office only.
// Assigned crew read the whole job document (and their phone caches it), so the job carries no dollars.
// Office lists are merged with jobMoney; a legacy amount still on the job shows until the migration moves it.
const MONEY = new Map();
let moneyUnsub = null;
const withMoney = j => mergeJobMoney(j, MONEY.get(j.id));
function moneyStart(rerender) {
  if (moneyUnsub || !canSeeMoney()) return;
  moneyUnsub = onSnapshot(query(collection(db, JOB_MONEY_COLLECTION), where("companyId", "==", myCompanyId())), s => {
    MONEY.clear(); s.docs.forEach(d => MONEY.set(d.id, d.data()));
    jobs = jobs.map(withMoney);
    if (ui.done) ui.done = ui.done.map(withMoney);
    if (ui.undated) ui.undated = ui.undated.map(withMoney);
    rerender();
  }, e => console.warn("job money", e.code || e.message));
}
function moneyStop() { if (moneyUnsub) moneyUnsub(); moneyUnsub = null; MONEY.clear(); }
function jobMoneyWrite(id, money, extra = {}) {
  return setDoc(doc(db, JOB_MONEY_COLLECTION, id), jobMoneyDoc(id, myCompanyId(), money, { ...extra, updatedAt: serverTimestamp(), updatedBy: me.uid }), { merge: true });
}
// Update a job: money keys go to jobMoney (and clear any legacy copy on the job); the rest to the job.
function writeJob(id, patch) {
  const { job, money, hasMoney } = splitJobMoney(patch, deleteField);
  return Promise.all([updateDoc(doc(db, "jobs", id), job), ...(hasMoney ? [jobMoneyWrite(id, money)] : [])]);
}
function applyJobTypes(setup) {
  ui.tradeSetup = setup;
  const map = jobTypeMap(setup);
  for (const k of Object.keys(TYPES)) delete TYPES[k];
  Object.assign(TYPES, map);
  setQuoteTradeSetup(setup);
}
async function loadTradeSetup(company) {
  const id = (company && company.companyId) || myCompanyId();
  if (typeof window !== "undefined" && Array.isArray(window.HW_PREVIEW_TRADES) && window.HW_PREVIEW_TRADES.length) {
    applyJobTypes(resolveCompanySetup({ companyId: id, trades: window.HW_PREVIEW_TRADES }, null));
    return;
  }
  const snap = await cachedGetDoc(doc(db, "companyTrades", id)).catch(() => null);
  const stored = snap && snap.exists() ? snap.data() : null;
  applyJobTypes(resolveCompanySetup(company || { companyId: id }, stored));
}
async function persistTrades(nextList) {
  const trades = sanitizeTradeList(nextList);
  if (!trades.length) throw Object.assign(new Error("trade"), { code: "trade" });
  const id = myCompanyId();
  const prev = ui.tradeSetup || resolveCompanySetup({ companyId: id }, null);
  const titles = titlesAfterTradeChange(prev.titles, prev.saved, trades);
  const presets = mergeIndustryPresets(prev, trades);
  const catalog = {
    companyId: id, trade: trades[0], trades, extraTrades: trades.slice(1),
    titles: sanitizeTitles(titles), checklists: presets.checklists, photoSteps: presets.photoSteps,
    updatedBy: me.uid, updatedAt: serverTimestamp(),
  };
  await setDoc(doc(db, "companyTrades", id), catalog);
  try { await updateDoc(doc(db, "companies", id), { trades, trade: trades[0] }); }
  catch (e) { console.warn("company trades", e && (e.code || e.message)); }
  applyJobTypes(resolveCompanySetup({ companyId: id, trades, trade: trades[0] }, catalog));
}
async function saveTradeSetup(next) {
  const id = myCompanyId();
  const setup = next || ui.tradeSetup || resolveCompanySetup({ companyId: id }, null);
  const trades = sanitizeTradeList(setup.enabled || [setup.trade]);
  const data = {
    companyId: id,
    trade: trades[0] || setup.trade,
    trades,
    extraTrades: trades.slice(1),
    titles: sanitizeTitles(setup.titles),
    checklists: (setup.checklists || []).slice(0, 60),
    photoSteps: (setup.photoSteps || []).slice(0, 60),
    updatedBy: me.uid,
    updatedAt: serverTimestamp(),
  };
  await setDoc(doc(db, "companyTrades", id), data);
  applyJobTypes(resolveCompanySetup({ companyId: id, trades, trade: data.trade }, data));
}
async function loadCompanyBrand() {
  const id = myCompanyId();
  const companyRef = doc(db, "companies", id);
  let snap = null;
  try { snap = await cachedGetDoc(companyRef, 8000, "companies/" + id); }
  catch (err) {
    if (err && err.code === "boot-timeout") {
      try { snap = await getDocFromCache(companyRef); }
      catch { snap = null; }
    }
  }
  const loaded = snap && snap.exists() ? { ...snap.data(), companyId: id } : null;
  ui.companyRecord = loaded;
  ui.companyStatus = loaded ? String(loaded.status || "") : "";
  const fallback = { companyId: id, name: id === "heartwood" ? "" : "Your company" };
  if (loaded) setActiveCompany(loaded);
  else setActiveCompany(id === "heartwood" ? null : fallback);
  ui.companyAccess = companyAccess(loaded, id);
  if (ui.companyAccess.paused) {
    paintBrand();
    return;
  }
  // Depot for quotes and run sheets: the company's address from settings (Heartwood: Chuwar unless changed there).
  const depot = orgSettings().address;
  setRouteDepot(depot, { heartwood: id === "heartwood" }); setDefaultDepot(depot, { heartwood: id === "heartwood" });
  paintBrand();
  loadDispatchSettings().catch(() => {});
  queueStartup(() => {
    if (me && me.role === "admin" && loaded) {
      if (loaded.referredBy) clearStoredReferral(localStorage);
      else rememberSignupReferral(id).catch(() => {});
    }
  });
}
function dispatchSettingsNow() {
  if (!ui.dispatchSettings) {
    const local = readDispatchLocal(myCompanyId());
    if (local) ui.dispatchSettings = local;
  }
  return sanitizeDispatchSettings(ui.dispatchSettings || {});
}
function dispatchHistory(list) {
  const seen = new Set(), rows = [];
  for (const j of [...(list || []), ...(jobs || []), ...(ui.done || [])]) {
    if (!j || !j.id || seen.has(j.id)) continue;
    seen.add(j.id);
    rows.push(j);
  }
  const entries = [];
  for (const sheet of ui.tsAll || []) if (sheet && sheet.entries) entries.push(...entryList(sheet.entries));
  if (ui.tsMine && ui.tsMine.entries) entries.push(...entryList(ui.tsMine.entries));
  return historyMedians(rows, entries);
}
async function loadDispatchSettings() {
  const id = myCompanyId();
  const local = readDispatchLocal(id);
  if (local) ui.dispatchSettings = local;
  const ref = id === "heartwood" ? doc(db, "meta", "dispatchTimes") : doc(db, "companyMeta", id + "_dispatch");
  try {
    let snap = null;
    try { snap = await getDocFromCache(ref); } catch { snap = null; }
    if (!snap || !snapExists(snap)) snap = await cachedGetDoc(ref);
    if (snap && snapExists(snap)) {
      ui.dispatchSettings = sanitizeDispatchSettings(snap.data());
      writeDispatchLocal(id, ui.dispatchSettings);
    }
  } catch { /* offline, or this login cannot read the company table: defaults still space the day */ }
}
let dispatchSpacing = false;
function queueDispatchPersist(list, dates) {
  if (!me || me.role !== "admin" || ui.persistHold) return;
  ui.persistList = list || jobs;
  if (!dates) ui.persistAll = true;
  else {
    ui.persistDates = ui.persistDates || new Set();
    for (const d of dates) if (d) ui.persistDates.add(d);
  }
  clearTimeout(ui.persistTimer);
  ui.persistTimer = setTimeout(() => { flushDispatchPersist().catch(e => console.warn("dispatch times", e && (e.code || e.message))); }, 80);
}
// BEGIN DISPATCH PERSIST
async function flushDispatchPersist() {
  if (!me || me.role !== "admin" || ui.persistHold) return;
  if (dispatchSpacing) { ui.persistAgain = true; return; }
  const list = ui.persistList || jobs;
  const dates = ui.persistAll ? null : [...(ui.persistDates || [])];
  ui.persistDates = new Set();
  ui.persistAll = false;
  const writes = planAutoTimes(list, {
    settings: dispatchSettingsNow(),
    history: dispatchHistory(list),
    sheets: ui.runSheets || {},
    dates: dates && dates.length ? dates : null,
  });
  if (!writes.length) return;
  dispatchSpacing = true;
  let denied = 0;
  try {
    await Promise.all(writes.map(async w => {
      const hit = (jobs || []).find(j => j.id === w.id) || (ui.undated || []).find(j => j.id === w.id);
      if (hit) Object.assign(hit, { time: w.time, timeSource: "auto", estHours: w.estHours, estSource: w.estSource });
      try {
        await settleOrQueue(updateDoc(doc(db, "jobs", w.id), {
          time: w.time, timeSource: "auto", estHours: w.estHours, estSource: w.estSource,
          updatedAt: serverTimestamp(), updatedBy: me.uid,
        }));
      } catch (e) {
        const code = String(e && (e.code || e.message) || "");
        if (code.includes("permission-denied")) denied++;
        console.warn("dispatch times", code);
      }
    }));
  } finally {
    dispatchSpacing = false;
    if (denied && denied === writes.length) ui.persistHold = true;
    if (ui.persistAgain) { ui.persistAgain = false; queueDispatchPersist(jobs); }
  }
}
// END DISPATCH PERSIST
function ensureDispatchSheets(days) {
  const key = myCompanyId() + "|" + (days || []).join(",");
  if (!days || !days.length || ui.sheetKey === key) return;
  ui.sheetKey = key;
  Promise.all(days.map(d => loadRunSheets(d))).then(() => { if (ui.view === "dispatch") renderAdmin(); }).catch(() => {});
}
function noteDispatch(all, days) {
  ui.dispatchHist = dispatchHistory([...(all || []), ...(ui.done || [])]);
  ensureDispatchSheets(days);
  queueDispatchPersist(all, days);
}
function personUid(row) {
  if (!row || !row.raw) return "_none";
  const person = staff.find(s => skey(s) === row.key);
  return person && person.uid ? person.uid : row.key;
}
function rowPlan(row, day, sched) {
  const rows = sched.filter(j => j.date === day && row.has(j));
  const uid = personUid(row);
  const id = runSheetId(uid, day);
  const saved = id && ui.runSheets ? ui.runSheets[id] : null;
  const sheet = saved && saved.status === "approved" ? saved : null;
  return spaceDay(rows, { settings: dispatchSettingsNow(), history: ui.dispatchHist || dispatchHistory(sched), sheet });
}
function boardHour(slot, job) {
  const t = (slot && slot.time) || (job && job.time) || "07:00";
  const h = parseInt(t, 10);
  if (!Number.isFinite(h)) return 7;
  if (h < 6) return 6;
  if (h > 18) return 18;
  return h;
}
function dispatchChip(j, slot) {
  const away = assignmentWarning(ui.leave || [], j.date, leavePeople(namesOf(j)));
  const time = slot ? slot.time : (j.time || "");
  const est = slot ? formatEstimate(slot.estHours) : "";
  const late = slot && slot.pastFinish;
  const why = slot && slot.estSource === "quote" ? "Hours from the quote" : slot && slot.estSource === "history" ? "Median clocked time for this kind of job" : "Default for this kind of job";
  return `<div class="dchip ${QCLS[queueOf(j)]} t-${j.type} ${j.status === "In progress" ? "inprog" : ""} ${away ? "on-leave" : ""} ${late ? "past-finish" : ""}" draggable="true" data-id="${j.id}" title="${esc(j.client)} – ${esc(j.description)}${est ? " · " + esc(est) : ""}${late ? " · Runs past finish time" : ""}${away ? " · " + away : ""}">${ipTop(j, "sm")}
      <b>${esc(time)}</b> ${esc((j.address || "").split(",")[0])}<div class="sub"><span class="est" title="${esc(why)}">${esc(est)}</span>${esc(jobTypeText(j) || TYPES[j.type] || "")} · #${esc(jobNo(j))}</div>${late ? `<div class="sub past-finish">Runs past finish time</div>` : ""}</div>`;
}
function inviteDisplayNow() {
  return window.HW_TODAY ? new Date(window.HW_TODAY + "T12:00:00+10:00") : new Date();
}
function renderInviteSignedIn() {
  paintBrand();
  $("#who").textContent = "";
  showAccountChrome(true);
  paintApp(`<form class="card login" id="invitebusy">
    <h2>Staff invite</h2>
    <p>This link creates a new login. Sign out, then open it again to set a password.</p>
    <button class="big primary" type="button" id="invitesignout">Sign out</button>
  </form>`);
  $("#invitesignout").onclick = () => signOut(auth);
}
async function openBilling(name, extra = {}) {
  try {
    const result = await callAuthed(name, { companyId: myCompanyId(), origin: location.origin, ...extra });
    if (result.url) location.assign(result.url);
    else toast("Billing did not return a page.");
  } catch (e) {
    toast((e && e.message) || "Billing is not available.");
  }
}
function billingExtra() {
  return ui.companyAccess && ui.companyAccess.trialActive ? { preserveTrial: true } : {};
}
function renderAccountPaused() {
  paintBrand();
  $("#who").textContent = `${me.name} · ${me.role}`;
  showAccountChrome(true);
  const access = ui.companyAccess || {};
  paintApp(access.ownerPaused
    ? pausedOwnerHtml({ platformOwner: !!(me && me.platformOwner) })
    : (me.role === "admin" ? pausedAdminHtml(access) : pausedStaffHtml()));
  const out = $("#pausedout");
  if (out) out.onclick = () => signOut(auth);
  const home = $("#pausedhome");
  if (home) home.onclick = () => leavePausedSession();
  const sub = $("#billsub");
  if (sub) sub.onclick = () => openBilling("createBillingCheckout");
  const portal = $("#billportal");
  if (portal) portal.onclick = () => openBilling("createBillingPortal");
}
async function leavePausedSession() {
  await returnToMasterPage();
}
function trialBannerNow() {
  const access = ui.companyAccess;
  if (!me || me.role !== "admin" || !access || access.paused || !access.trialActive || access.paying) return "";
  const key = access.remind ? `callup.trialRemind.${myCompanyId()}` : `callup.trialBanner.${myCompanyId()}`;
  try { if (sessionStorage.getItem(key) === "1") return ""; } catch { /* private mode: the banner stays */ }
  return trialBannerHtml(access);
}
function currentBanner() {
  const notes = PUSH && typeof PUSH.bannerHtml === "function" ? PUSH.bannerHtml() : "";
  // Days left and "trial ends in" share the trial slot. A trial that has already
  // ended replaces the dashboard with the paused screen, so it is not a second banner.
  return pickDashboardBanner({
    trial: !!trialBannerNow(),
    notifications: !!notes,
    windows: typeof desktopBannerWouldShow === "function" && desktopBannerWouldShow(),
  });
}
function bannerSlotHtml() {
  const choice = currentBanner();
  if (choice === "trial") return trialBannerNow();
  if (choice === "notifications") return PUSH.bannerHtml();
  return "";
}
function bindTrialBanner(root) {
  const bar = root && root.querySelector && root.querySelector("#trialbanner");
  if (!bar) return;
  const dismiss = root.querySelector("#trialdismiss");
  if (dismiss) dismiss.onclick = () => {
    const access = ui.companyAccess || {};
    const key = access.remind ? `callup.trialRemind.${myCompanyId()}` : `callup.trialBanner.${myCompanyId()}`;
    try { sessionStorage.setItem(key, "1"); } catch { /* the banner is gone for this paint either way */ }
    if (me && me.role === "admin" && !ui.myJobs) renderAdmin();
    else renderOperator();
  };
  const sub = root.querySelector("#trialsub");
  if (sub) sub.onclick = () => openBilling("createBillingCheckout", { preserveTrial: true });
}
function showBillingNote() {
  let note = "";
  try {
    note = sessionStorage.getItem("callup.billingNote") || "";
    sessionStorage.removeItem("callup.billingNote");
  } catch { note = ""; }
  if (note) toast(note);
}
async function callAuthed(name, data) {
  const gate = needsSignal(actionForCall(name), deviceOnline());
  if (!gate.ok) throw new Error(gate.message);
  const projectId = useEmulator ? "demo-heartwood" : firebaseConfig.projectId;
  const url = useEmulator
    ? `http://127.0.0.1:5001/${projectId}/australia-southeast1/${name}`
    : `https://australia-southeast1-${projectId}.cloudfunctions.net/${name}`;
  const token = auth.currentUser ? await auth.currentUser.getIdToken() : "";
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: token ? `Bearer ${token}` : "" },
    body: JSON.stringify({ data }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const err = new Error((body.error && body.error.message) || "Billing is not available.");
    throw err;
  }
  return body.result || {};
}
async function rememberSignupReferral(companyId) {
  const code = storedReferralCode(localStorage);
  if (!code || !companyId) return;
  try {
    await callAuthed("attachSignupReferral", { companyId, code });
    clearStoredReferral(localStorage);
  } catch (err) {
    const message = err && err.message;
    if (referralGiveUp(message)) clearStoredReferral(localStorage);
    else console.warn("referral", message || err);
  }
}
function bindReferralCopy(box) {
  const btn = box && box.querySelector("#refcopy");
  const input = box && box.querySelector("#reflink");
  if (!btn || !input || btn.dataset.bound) return;
  btn.dataset.bound = "1";
  btn.onclick = async () => {
    const value = input.value;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(value);
      else throw new Error("clipboard");
      toast("Referral link copied");
    } catch {
      input.focus();
      input.select();
      toast("Select the link and copy it");
    }
  };
}
async function loadReferralBox(root) {
  const box = root && root.querySelector && root.querySelector("#referralbox");
  if (!box || !me || me.role !== "admin") return;
  try {
    const result = await callAuthed("ensureReferralCode", { companyId: myCompanyId(), origin: location.origin });
    box.outerHTML = referralBoxHtml(result);
    bindReferralCopy(root.querySelector("#referralbox"));
  } catch {
    const status = box.querySelector("#referralstatus");
    if (status) status.textContent = "Referral link isn't available yet.";
  }
}
async function callInvite(name, data) {
  const projectId = useEmulator ? "demo-heartwood" : firebaseConfig.projectId;
  const url = useEmulator
    ? `http://127.0.0.1:5001/${projectId}/australia-southeast1/${name}`
    : `https://australia-southeast1-${projectId}.cloudfunctions.net/${name}`;
  let res;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data }) });
  } catch {
    const err = new Error("offline");
    err.code = "offline";
    throw err;
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const err = new Error("invite-failed");
    err.code = res.status === 404 ? "unavailable" : res.status === 429 ? "busy" : "server-error";
    throw err;
  }
  return body.result || {};
}
function renderInviteAccept(token) {
  paintBrand();
  const preview = window.HW_INVITE_PREVIEW;
  if (preview) {
    paintApp(acceptViewHtml(acceptScreenModel(preview, inviteDisplayNow())));
    return bindInviteAccept(token, true);
  }
  paintApp(acceptLoadingHtml());
  callInvite("previewStaffInvite", { token }).then(result => {
    const model = result && result.ok ? acceptScreenModel(result, inviteDisplayNow()) : {
      ok: false, reason: (result && result.reason) || "invalid", name: result && result.name, email: result && result.email,
    };
    paintApp(acceptViewHtml(model));
    if (model.ok) bindInviteAccept(token, false, model.email);
  }).catch(e => {
    paintApp(acceptViewHtml({ ok: false, reason: (e && e.code) || "server-error" }));
  });
}
function bindInviteAccept(token, previewOnly, email) {
  const form = $("#acceptf");
  if (!form || !form.p) return;
  form.onsubmit = async ev => {
    ev.preventDefault();
    const err = $("#aceerr");
    if (form.p.value !== form.p2.value) { err.textContent = inviteFailureText("mismatch"); return; }
    if (previewOnly) { err.textContent = "Preview only. No login was created and no email was sent."; return; }
    err.textContent = "";
    let created = false;
    try {
      const result = await callInvite("acceptStaffInvite", { token, password: form.p.value });
      if (!result.ok) { err.textContent = inviteFailureText(result.reason); return; }
      created = true;
      const address = result.email || email;
      history.replaceState({}, "", location.pathname);
      await signInWithEmailAndPassword(auth, address, form.p.value);
    } catch (e) {
      err.textContent = created ? "Your login was created. Sign in with that password." : inviteFailureText((e && e.code) || "server-error");
    }
  };
}
const logoObjectUrls = Object.create(null);
function orgLogoHtml(org) {
  const url = org && org.logoUrl;
  if (!url) return "";
  if (isLogoStoragePath(url, org.companyId)) {
    return `<img class="orglogo" data-logo-path="${esc(url)}" alt="">`;
  }
  return `<img class="orglogo" src="${esc(url)}" alt="">`;
}
function loadOrgLogos(root = document) {
  const scope = root && root.querySelectorAll ? root : document;
  const tasks = [];
  scope.querySelectorAll("img[data-logo-path]").forEach(img => {
    const path = img.dataset.logoPath;
    if (!path) return;
    if (logoObjectUrls[path]) { img.src = logoObjectUrls[path]; return; }
    tasks.push(getBlob(storageRef(storage, path)).then(blob => {
      if (!logoObjectUrls[path]) logoObjectUrls[path] = URL.createObjectURL(blob);
      document.querySelectorAll(`img[data-logo-path="${CSS.escape(path)}"]`).forEach(el => { el.src = logoObjectUrls[path]; });
    }).catch(() => {
      document.querySelectorAll(`img[data-logo-path="${CSS.escape(path)}"]`).forEach(el => { el.remove(); });
    }));
  });
  return Promise.all(tasks);
}
function paintBrand() {
  const org = orgSettings();
  // Signed out (sign-in, sign-up, invite screens): plain CallUp, no company name.
  if (!me) {
    const el0 = document.querySelector(".brand");
    if (el0) el0.innerHTML = `<span class="wordmark" aria-label="${esc(PRODUCT_NAME)}">Call<span>Up</span></span>`;
    document.title = PRODUCT_NAME;
    return;
  }
  const mark = org.isTest ? `<span class="co-badge co-test">TEST</span>` : org.plan === "friend" ? `<span class="co-badge co-friend">FRIEND</span>` : "";
  const exit = me && me.testCompanyId ? `<button type="button" class="ghost" id="testexit">Exit test company</button>` : "";
  const el = document.querySelector(".brand");
  if (el) el.innerHTML = `<span class="wordmark" aria-label="${esc(PRODUCT_NAME)}">Call<span>Up</span></span><span class="orgline">${orgLogoHtml(org)}${esc(org.name)} ${mark}</span>${exit}`;
  const back = document.querySelector("#testexit");
  if (back) back.onclick = () => leaveTestCompany();
  document.title = `${PRODUCT_NAME} · ${org.name}`;
  loadOrgLogos(el || document);
}
function testCompanyActive() { return orgSettings().isTest === true; }
function holdOutbound(kind, text) {
  window.HW_LAST_MAIL_PREVIEW = { kind, text };
  const id = "tm" + Math.random().toString(36).slice(2, 12);
  setDoc(doc(db, "testMailLog", id), {
    kind, status: "preview", companyId: myCompanyId(), preview: String(text || "").slice(0, 2000), createdAt: serverTimestamp(),
  }).catch(() => {});
  alert("Test company. Nothing was sent.\n\n" + text);
}
// Signed in, but no users/{uid} profile: always leave a way out (sign out / try another login).
function renderOfflineSignedIn(user) {
  paintBrand();
  $("#who").textContent = user.email || "Signed in";
  showAccountChrome(true);
  paintApp(`<form class="card login" id="offlinehold">
    <h2>You're still signed in</h2>
    <p>This phone has no signal, and your profile is not saved on it yet.</p>
    <p class="sub">Open CallUp once with signal. After that, your jobs stay on the phone and you are not asked to sign in again.</p>
    <button class="big ghost" type="button" id="offlineout">Sign out</button>
  </form>`);
  $("#offlineout").onclick = () => signOut(auth);
  paintSync();
}
function renderNoAccess(user) {
  paintBrand();
  $("#who").textContent = user.email || "";
  showAccountChrome(true);
  paintApp(`<form class="card login" id="noaccess">
    <h2>No company yet</h2>
    <p>${esc(user.email)} is signed in, but it isn't linked to a company in ${esc(PRODUCT_NAME)}.</p>
    <p class="sub">If you work for a business that uses ${esc(PRODUCT_NAME)}, ask your admin to send you an invite link. If you were creating a new company, sign out and create it again.</p>
    <button class="big primary" type="button" id="noaccessout">Sign out</button>
  </form>`);
  $("#noaccessout").onclick = () => signOut(auth);
}
function signInFailureText(e) {
  const code = (e && e.code) || "";
  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-login-credentials"].includes(code)) return "That email and password don't match. Check them, or tap Forgot password.";
  if (code === "auth/invalid-email") return "Enter a valid email address.";
  if (code === "auth/too-many-requests") return "Too many tries. Wait a few minutes, or reset your password.";
  if (code === "auth/user-disabled") return "This login has been turned off. Ask your admin.";
  if (code === "auth/network-request-failed") return "No connection. Check your signal and try again.";
  return "Sign-in failed: " + (code || (e && e.message) || "unknown error");
}
function renderLogin(prefill) {
  paintBrand();
  const email = typeof prefill === "string" ? prefill : "";
  paintApp(`<form id="login" class="card login">
    <div class="login-brand"><div class="wordmark" aria-label="${esc(PRODUCT_NAME)}">Call<span>Up</span></div></div>
    <h2>Sign in</h2>
    <p class="sub">Use the email your company gave you.</p>
    <label>Email<input name="e" type="email" autocomplete="username" inputmode="email" required value="${esc(email)}"></label>
    <label>Password<input name="p" type="password" autocomplete="current-password" required></label>
    <button class="big primary">Sign in</button>
    <button class="ghost" type="button" id="forgotpw">Forgot password?</button>
    <button class="big ghost" type="button" id="opencreate">Create a company</button>
    <p id="lerr" class="err"></p>
    <p class="powered">${esc(POWERED_BY)}</p></form>`);
  $("#login").onsubmit = async ev => {
    ev.preventDefault(); const f = ev.target;
    try { await signInWithEmailAndPassword(auth, f.e.value.trim(), f.p.value); }
    catch (e) { $("#lerr").textContent = signInFailureText(e); }
  };
  $("#forgotpw").onclick = () => renderForgot($("#login").e.value);
  $("#opencreate").onclick = () => renderSignup();
}
// In-page email step (not window.prompt, which the installed Home Screen app does not show).
function renderForgot(prefill) {
  paintBrand();
  const email = String(prefill || "").trim();
  paintApp(`<form id="forgot" class="card login" autocomplete="on">
    <div class="login-brand"><div class="wordmark" aria-label="${esc(PRODUCT_NAME)}">Call<span>Up</span></div></div>
    <h2>Reset password</h2>
    <p class="sub">Enter the email you use to sign in.</p>
    <label>Email<input name="e" type="email" autocomplete="username" inputmode="email" required value="${esc(email)}"></label>
    <button class="big primary" type="submit">Email reset link</button>
    <button class="ghost" type="button" id="forgotback">Back to sign in</button>
    <p id="ferr" class="err"></p>
    <p class="powered">${esc(POWERED_BY)}</p></form>`);
  const form = $("#forgot");
  $("#forgotback").onclick = () => renderLogin(form.e.value);
  form.onsubmit = async ev => {
    ev.preventDefault();
    const address = form.e.value.trim();
    const out = $("#ferr");
    if (!address) { out.className = "err"; out.textContent = forgotPasswordMessage("empty"); form.e.focus(); return; }
    out.textContent = "";
    try {
      await sendPasswordResetEmail(auth, address);
      out.className = "sent";
      out.textContent = forgotPasswordMessage("sent");
    } catch (e) {
      const code = (e && e.code) || "sent";
      const neutral = code === "auth/user-not-found" || code === "sent" || !code;
      out.className = neutral ? "sent" : "err";
      out.textContent = forgotPasswordMessage(code);
    }
  };
  if (!email) form.e.focus();
}
function renderSignup(friendCode = "") {
  paintBrand();
  paintApp(signupFormHtml({ friend: friendCodeOk(friendCode) }));
  if (friendCode && !friendCodeOk(friendCode)) {
    const err = $("#signuperr");
    if (err) err.textContent = "That friend invite code is not valid.";
  }
  $("#signupback").onclick = () => renderLogin();
  bindTradeSearch($("#signup"));
  const tradeOrder = [];
  $("#signup").querySelectorAll("input[name=trades]").forEach(el => {
    el.addEventListener("change", () => {
      const at = tradeOrder.indexOf(el.value);
      if (el.checked && at < 0) tradeOrder.push(el.value);
      if (!el.checked && at >= 0) tradeOrder.splice(at, 1);
    });
  });
  const companyEmail = $("#signup").email;
  const accountsEmail = $("#signup").accountsEmail;
  if (companyEmail && accountsEmail) {
    companyEmail.addEventListener("input", () => {
      if (accountsEmail.dataset.touched !== "1") accountsEmail.value = companyEmail.value;
    });
    accountsEmail.addEventListener("input", () => { accountsEmail.dataset.touched = "1"; });
  }
  $("#signup").onsubmit = async ev => {
    ev.preventDefault();
    const f = ev.target;
    const err = $("#signuperr");
    const checkedIds = [...(f.querySelectorAll("input[name=trades]:checked") || [])].map(el => el.value);
    const trades = sanitizeTradeList([...tradeOrder.filter(id => checkedIds.includes(id)), ...checkedIds]);
    if (f.accountsEmail && !f.accountsEmail.value.trim() && f.email.value.trim()) f.accountsEmail.value = f.email.value.trim();
    const problems = signupFieldErrors({
      ownerName: f.ownerName.value, ownerEmail: f.ownerEmail.value, password: f.password.value, trades,
      name: f.name.value, legalName: f.legalName.value, abn: f.abn.value,
      street: f.street.value, suburb: f.suburb.value, state: f.state.value, postcode: f.postcode.value,
      phone: f.phone.value, email: f.email.value, accountsEmail: f.accountsEmail.value, hubdocAddress: f.hubdocAddress.value,
    });
    f.querySelectorAll("[data-err]").forEach(slot => { slot.hidden = true; slot.textContent = ""; });
    f.querySelectorAll("[aria-invalid]").forEach(el => el.removeAttribute("aria-invalid"));
    if (problems.length) {
      for (const problem of problems) {
        const slot = f.querySelector(`[data-err="${problem.field}"]`);
        if (slot) { slot.hidden = false; slot.textContent = problem.message; }
        const named = f.elements[problem.field];
        const field = named && named.setAttribute ? named : f.querySelector(`[name="${problem.field}"]`);
        if (field && field.setAttribute) field.setAttribute("aria-invalid", "true");
      }
      err.textContent = problems.length === 1 ? problems[0].message : `Check the ${problems.length} fields marked below.`;
      const first = f.querySelector("[aria-invalid]") || err;
      if (typeof first.scrollIntoView === "function") first.scrollIntoView({ block: "center" });
      if (typeof first.focus === "function") first.focus();
      return;
    }
    const checked = validateCompanyInput({
      name: f.name.value, legalName: f.legalName.value, abn: f.abn.value,
      street: f.street.value, suburb: f.suburb.value, state: f.state.value, postcode: f.postcode.value,
      phone: f.phone.value, email: f.email.value, accountsEmail: f.accountsEmail.value,
      hubdocAddress: f.hubdocAddress.value, logoUrl: "", signoff: f.name.value,
    });
    if (!checked.ok) { err.textContent = companyFailure(checked.reason); return; }
    signingUp = true;
    let cred = null;
    try {
      cred = await createUserWithEmailAndPassword(auth, f.ownerEmail.value.trim(), f.password.value);
      const companyId = companyIdFromName(checked.value.name);
      const signedUpAt = serverTimestamp();
      if (friendCodeOk(friendCode)) {
        await runTransaction(db, async (tx) => {
          const invRef = doc(db, "friendInvites", friendCode);
          const inv = await tx.get(invRef);
          if (!inv.exists() || inv.data().status !== "pending") throw Object.assign(new Error("invite"), { code: "invite" });
          tx.set(doc(db, "companies", companyId), { ...buildFriendCompany(checked.value, {
            companyId, ownerUid: cred.user.uid, signedUpAt, friendInvite: friendCode,
          }), trades, trade: trades[0] });
          tx.update(invRef, { status: "used", usedBy: cred.user.uid, companyId, usedAt: serverTimestamp() });
        });
      } else {
        await setDoc(doc(db, "companies", companyId), { ...buildCompanyCreate(checked.value, {
          companyId, ownerUid: cred.user.uid, signedUpAt, trialEndsAt: Timestamp.fromDate(trialEnd(new Date())), lastActivityAt: signedUpAt,
        }), trades, trade: trades[0] });
      }
      await setDoc(doc(db, "users", cred.user.uid), { ...ownerProfile(checked.value, companyId, f.ownerName.value.trim()), email: f.ownerEmail.value.trim().toLowerCase(), jobTitle: "Admin", jobTitleId: trades[0] + ":admin" });
      try {
        await setDoc(doc(db, "companyTrades", companyId), { ...companyTradesDoc(companyId, trades, cred.user.uid), updatedAt: serverTimestamp() });
      } catch (err) { console.warn("trade catalog", err && (err.code || err.message)); }
      if (!friendCodeOk(friendCode)) await rememberSignupReferral(companyId);
      const logoFile = f.logoFile && f.logoFile.files && f.logoFile.files[0];
      if (logoFile && logoFileOk(logoFile).ok) {
        try {
          const plan = logoUploadPlan(companyId, cred.user.uid);
          if (plan.ok) {
            const blob = await compressLogo(logoFile);
            await uploadBytes(storageRef(storage, plan.path), blob, { contentType: plan.contentType, customMetadata: plan.metadata });
            await updateDoc(doc(db, "companies", companyId), { logoUrl: plan.path });
          }
        } catch { /* company is already created; they can add the logo in settings */ }
      }
      signingUp = false;
      const addCard = !friendCodeOk(friendCode) && f.addCard && f.addCard.checked;
      if (addCard) {
        try {
          const result = await callAuthed("createBillingCheckout", { companyId, origin: location.origin, preserveTrial: true });
          if (result && result.url) { location.assign(result.url); return; }
          try { sessionStorage.setItem("callup.billingNote", CARD_SETUP_LATER); } catch { /* continue into the app */ }
        } catch (err) {
          const msg = (err && err.message) || "";
          try { sessionStorage.setItem("callup.billingNote", /Card setup isn't available yet/.test(msg) ? msg : CARD_SETUP_LATER); } catch { /* continue into the app */ }
        }
      }
      location.reload();
    } catch (e) {
      // Keep signingUp set while the half-made login is removed, so the auth listener does not
      // swap this form for the sign-in screen and hide the error.
      if (cred) { try { await cred.user.delete(); } catch { try { await signOut(auth); } catch { /* already signed out */ } } }
      signingUp = false;
      const code = e && e.code === "auth/email-already-in-use" ? "email-in-use"
        : e && e.code === "auth/weak-password" ? "weak-password"
        : (e && e.code) || "permission-denied";
      err.textContent = companyFailure(code) || (e.code || e.message);
    }
  };
}
function settingsView() {
  const org = orgSettings();
  const trades = (ui.tradeSetup && ui.tradeSetup.enabled) || readTradeList(org, null);
  // Other companies edit their own quote rates and depot here (Heartwood keeps the Quotes-page button only).
  const rates = me && me.role === "admin" && myCompanyId() !== "heartwood"
    ? `<section class="pad setrates"><h3>Quote rates</h3><p class="sub">${esc(quoteRatesSettingsBlurb(trades))}</p><button type="button" id="setrates" class="sm-btn">Edit quote rates</button></section>`
    : "";
  const perfSet = canEditPerformanceSettings(me) ? performanceSettingsHtml(ui.perfSettings || { weights: DEFAULT_WEIGHTS }, { take5On: ui.take5On !== false }) : "";
  const setup = ui.tradeSetup || resolveCompanySetup({ companyId: myCompanyId() }, null);
  return companySettingsHtml(org, { canEdit: !!(me && me.role === "admin"), trades, canEditTrades: canEditTitles() })
    + presetEditorHtml(setup, { canEdit: canEditTitles() })
    + rates + perfSet + PUSH.panelHtml()
    + dispatchSettingsHtml(dispatchSettingsNow(), { canEdit: canEditTitles() })
    + `<section class="pad"><h3>Support</h3><p class="sub">Send a note to CallUp. Anyone signed in can raise a ticket.</p><button type="button" class="sm-btn" data-raise-ticket>Raise ticket</button></section>`;
}
async function saveDispatchForm(form) {
  if (!canEditTitles()) { toast("An admin or a manager can change dispatch times."); return; }
  const durations = {};
  for (const cat of DISPATCH_CATEGORIES) {
    const input = form.querySelector(`[name="dur_${cat.id}"]`);
    durations[cat.id] = input ? input.value : "";
  }
  const settings = sanitizeDispatchSettings({ dayStart: form.dayStart.value, dayEnd: form.dayEnd.value, travelGapMin: form.travelGapMin.value, durations });
  ui.dispatchSettings = settings;
  ui.persistHold = false;
  writeDispatchLocal(myCompanyId(), settings);
  const id = myCompanyId();
  const payload = {
    companyId: id, dayStart: settings.dayStart, dayEnd: settings.dayEnd, travelGapMin: settings.travelGapMin, durations: settings.durations,
    updatedBy: me.uid, updatedAt: serverTimestamp(),
  };
  const ref = id === "heartwood" ? doc(db, "meta", "dispatchTimes") : doc(db, "companyMeta", id + "_dispatch");
  try {
    await setDoc(ref, payload);
    toast("Dispatch times saved");
  } catch (e) {
    const code = e && (e.code || e.message) || "";
    toast(String(code).includes("permission-denied")
      ? "Saved on this phone. Other phones pick this up once the dispatch settings rules are deployed."
      : "Saved on this phone. " + code);
  }
  queueDispatchPersist(jobs);
  if (me && me.role === "admin") renderAdmin();
}
function bindTradeList(A) {
  const root = A || document;
  root.querySelectorAll("[data-trade-remove]").forEach(b => b.onclick = async () => {
    const cur = (ui.tradeSetup && ui.tradeSetup.enabled) || [];
    const next = cur.filter(id => id !== b.dataset.tradeRemove);
    if (next.length < 1) { toast("Keep at least one trade."); return; }
    try { await persistTrades(next); toast(tradeLabel(b.dataset.tradeRemove) + " removed."); redrawAfterSave(); }
    catch { toast("Couldn't update trades."); }
  });
  root.querySelectorAll("#tradeset, #tradeadd").forEach(form => form.onsubmit = async ev => {
    ev.preventDefault();
    const id = normalizeTrade(form.trade && form.trade.value);
    if (!id || !canEditTitles()) { toast("Only an admin or a manager can change trades."); return; }
    const cur = (ui.tradeSetup && ui.tradeSetup.enabled) || [];
    if (cur.includes(id)) { toast(tradeLabel(id) + " is already on."); return; }
    try {
      await persistTrades([...cur, id]);
      toast(tradeLabel(id) + (quotePack(id) && quotePack(id).ready ? " added. Quote pack ready." : " added. Quote pack coming soon."));
      redrawAfterSave();
    } catch { toast("Couldn't update trades."); }
  });
  const sw = root.querySelector("#quotetrade");
  if (sw) sw.onchange = () => { setQuoteFocus(sw.value); redrawAfterSave(); };
}
function bindPresetEditor(A) {
  const form = A.querySelector("#presetadd");
  if (!form || !canEditTitles()) return;
  const save = async (next) => {
    await saveTradeSetup({ ...ui.tradeSetup, checklists: next.checklists, photoSteps: next.photoSteps });
    toast(pestControlOn(ui.tradeSetup) ? "Checklist saved." : "Photos saved.");
    redrawAfterSave();
  };
  form.onsubmit = async ev => {
    ev.preventDefault();
    const err = form.querySelector("#preseterr");
    const kind = form.kind ? form.kind.value : "photo";
    if (kind !== "photo" && !pestControlOn(ui.tradeSetup)) {
      if (err) err.textContent = "Checklists are only for pest control.";
      return;
    }
    const added = addPresetRow(ui.tradeSetup, { label: form.label.value, kind });
    if (!added.ok) { if (err) err.textContent = "Add a short label."; return; }
    try { await save(added); }
    catch (e) { if (err) err.textContent = e.code || e.message; }
  };
  A.querySelectorAll("[data-preset-remove]").forEach(btn => btn.onclick = async () => {
    const next = removePresetRow(readPresetEditor(A.querySelector("#preseteditor"), ui.tradeSetup), btn.dataset.presetRemove);
    try { await save(next); }
    catch (e) { toast("Not saved: " + (e.code || e.message)); }
  });
  A.querySelectorAll("[data-preset-label]").forEach(input => input.addEventListener("change", async () => {
    const next = readPresetEditor(A.querySelector("#preseteditor"), ui.tradeSetup);
    try { await save(next); }
    catch (e) { toast("Not saved: " + (e.code || e.message)); }
  }));
}
function bindSettings(A) {
  bindTradeList(A);
  bindPresetEditor(A);
  loadReferralBox(A);
  if (canEditPerformanceSettings(me)) ensurePerfWatch();
  const take5Form = A.querySelector("#take5set");
  if (take5Form) take5Form.onsubmit = async ev => {
    ev.preventDefault();
    try {
      await setDoc(doc(db, "take5Settings", myCompanyId()), {
        companyId: myCompanyId(), enabled: !!(take5Form.enabled && take5Form.enabled.checked),
        updatedBy: me.uid, updatedAt: serverTimestamp(),
      });
      ui.take5On = !!(take5Form.enabled && take5Form.enabled.checked);
      toast(ui.take5On ? "Take 5s are on" : "Take 5s are off");
    } catch (e) { toast("Not saved: " + (e.code || e.message)); }
  };
  const weightForm = A.querySelector("#perfweights");
  if (weightForm) weightForm.onsubmit = async ev => {
    ev.preventDefault();
    try { await savePerfDoc({ weights: weightsFromForm(weightForm) }); toast("Ranking weights saved"); }
    catch (e) { toast("Not saved: " + (e.code || e.message)); }
  };
  const dispatchForm = A.querySelector("#dispatchform");
  if (dispatchForm) dispatchForm.onsubmit = ev => { ev.preventDefault(); saveDispatchForm(dispatchForm); };
  const rb = A.querySelector("#setrates");
  if (rb) rb.onclick = () => QG && QG.openRatesEditor();
  const sub = A.querySelector("#billsub");
  const portal = A.querySelector("#billportal");
  if (sub) sub.onclick = () => openBilling("createBillingCheckout", billingExtra());
  if (portal) portal.onclick = () => openBilling("createBillingPortal");
  const form = A.querySelector("#orgform");
  if (!form || form.querySelector("[disabled]")) { loadOrgLogos(A); return; }
  let pendingLogo = null;
  const previewBox = form.querySelector(".logopreview");
  const showLogoPreview = (src, path) => {
    if (!previewBox) return;
    if (!src && !path) { previewBox.hidden = true; previewBox.innerHTML = ""; return; }
    previewBox.hidden = false;
    const img = document.createElement("img");
    img.className = "orglogo-preview";
    img.alt = "Company logo";
    if (path) img.dataset.logoPath = path;
    else img.src = src;
    previewBox.innerHTML = "";
    previewBox.appendChild(img);
    if (path) loadOrgLogos(previewBox);
  };
  const ensureLogoRemove = () => {
    let btn = form.querySelector("#logoremove");
    if (btn) return btn;
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sm-btn";
    btn.id = "logoremove";
    btn.textContent = "Remove logo";
    if (form.logoFile) form.logoFile.insertAdjacentElement("afterend", btn);
    else form.appendChild(btn);
    return btn;
  };
  const bindLogoRemove = () => {
    const btn = form.querySelector("#logoremove");
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.onclick = async () => {
      pendingLogo = "remove";
      if (form.logoFile) form.logoFile.value = "";
      if (form.logoUrl) form.logoUrl.value = "";
      showLogoPreview("");
      btn.remove();
    };
  };
  if (form.logoFile) {
    form.logoFile.onchange = () => {
      const file = form.logoFile.files && form.logoFile.files[0];
      if (!file) return;
      const check = logoFileOk(file);
      if (!check.ok) { toast(logoFailureText(check.reason)); form.logoFile.value = ""; return; }
      pendingLogo = file;
      showLogoPreview(URL.createObjectURL(file));
      bindLogoRemove(ensureLogoRemove());
    };
  }
  bindLogoRemove();
  loadOrgLogos(A);
  form.onsubmit = async ev => {
    ev.preventDefault();
    const org = orgSettings();
    let logoUrl = form.logoUrl ? form.logoUrl.value : (org.logoUrl || "");
    if (pendingLogo === "remove") {
      const old = acceptLogoValue(org.logoUrl, org.companyId);
      if (isLogoStoragePath(old, org.companyId) && logoObjectUrls[old]) {
        URL.revokeObjectURL(logoObjectUrls[old]);
        delete logoObjectUrls[old];
      }
      logoUrl = "";
    } else if (pendingLogo) {
      const plan = logoUploadPlan(org.companyId, me && me.uid);
      if (!plan.ok) { toast(logoFailureText(plan.reason)); return; }
      let blob;
      try { blob = await compressLogo(pendingLogo); }
      catch (e) { toast(logoFailureText((e && e.code) || "compress")); return; }
      try {
        await uploadBytes(storageRef(storage, plan.path), blob, { contentType: plan.contentType, customMetadata: plan.metadata });
        logoUrl = plan.path;
        if (logoObjectUrls[plan.path]) { URL.revokeObjectURL(logoObjectUrls[plan.path]); delete logoObjectUrls[plan.path]; }
      } catch (e) { toast(logoFailureText("upload")); return; }
    }
    if (form.logoUrl) form.logoUrl.value = logoUrl;
    const checked = companyDetailPatch(org, {
      name: form.name.value, legalName: form.legalName.value, abn: form.abn.value,
      street: form.street.value, suburb: form.suburb.value, state: form.state.value, postcode: form.postcode.value,
      phone: form.phone.value, email: form.email.value, accountsEmail: form.accountsEmail.value,
      hubdocAddress: form.hubdocAddress.value, signoff: form.signoff.value, logoUrl,
      ...(form.jobPrefix ? { jobPrefix: form.jobPrefix.value } : {}), ...(form.accountsName ? { accountsName: form.accountsName.value } : {}),
    });
    if (!checked.ok) { toast(companyFailure(checked.reason)); return; }
    try {
      if (Object.keys(checked.patch).length) await updateDoc(doc(db, "companies", org.companyId), checked.patch);
      setActiveCompany({ ...org, ...checked.value, companyId: org.companyId });
      paintBrand();
      toast("Company details saved");
    } catch (e) {
      if (org.companyId === "heartwood") {
        saveOrgSettings(checked.value);
        setActiveCompany(null);
        paintBrand();
        toast("Saved on this phone until the company record is published");
        return;
      }
      toast("Not saved: " + (e.code || e.message));
    }
  };
}
function masterView() {
  const rows = ui.masterRows || [];
  return masterPageHtml(rows, ui.masterFilters || {}, ui.friendInvites || [], location.origin, ui.friendOut || "")
    + masterTicketsHtml(ui.supportTickets || [], { focusId: ui.ticketFocus || "" });
}
function bindMaster(A) {
  const form = A.querySelector("#masterf");
  if (!form) return;
  const apply = () => {
    ui.masterFilters = {
      q: A.querySelector("#masterq").value,
      status: A.querySelector("#masterstatus").value,
      plan: A.querySelector("#masterplan").value,
    };
    renderAdmin();
  };
  form.onchange = apply;
  A.querySelector("#masterq").oninput = apply;
  const testForm = A.querySelector("#testco");
  if (testForm) testForm.onsubmit = ev => { ev.preventDefault(); createTestCompany(testForm); };
  const friendForm = A.querySelector("#friendinv");
  if (friendForm) friendForm.onsubmit = ev => { ev.preventDefault(); createFriendInvite(A.querySelector("#friendout")); };
  A.querySelectorAll("[data-friend-copy]").forEach(b => b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.friendCopy); toast("Link copied. Mail was not sent."); }
    catch { toast("Select the link to copy it. Mail was not sent."); }
  });
  A.querySelectorAll("[data-ticket-toggle]").forEach(btn => btn.onclick = async () => {
    const id = btn.dataset.ticketToggle;
    const next = btn.dataset.ticketNext === "closed" ? "closed" : "open";
    try {
      await updateDoc(doc(db, "supportTickets", id), { status: next, updatedAt: serverTimestamp() });
    } catch (e) { toast((e && (e.code || e.message)) || "Not saved"); }
  });
  const focus = A.querySelector(".ticket-focus");
  if (focus && focus.scrollIntoView) focus.scrollIntoView({ block: "nearest" });
  paintTicketShots(A);
  A.querySelectorAll(".master-row").forEach(tr => {
    tr.onclick = () => {
      const row = (ui.masterRows || []).find(r => r.id === tr.dataset.company);
      const slot = A.querySelector("#masterdetail");
      if (slot) slot.innerHTML = masterDetailHtml(row, { ownCompanyId: ownerHomeCompany() });
      const close = A.querySelector("#masterclose");
      if (close) close.onclick = () => { slot.innerHTML = ""; };
      bindMasterActions(slot, row);
    };
  });
}
function bindMasterActions(slot, row) {
  if (!slot || !row) return;
  const open = slot.querySelector("#testopen");
  const reset = slot.querySelector("#testreset");
  const archive = slot.querySelector("#testarchive");
  if (open) open.onclick = () => openTestCompany(row.id);
  if (reset) reset.onclick = () => resetTestDemo(row.id);
  if (archive) archive.onclick = () => archiveTestCompany(row.id);
  const plan = slot.querySelector("#friendplan");
  if (plan) plan.onsubmit = ev => { ev.preventDefault(); saveFriendPlan(row.id, ev.submitter && ev.submitter.value, plan.end.value); };
  const pause = slot.querySelector("#ownerpause");
  const reactivate = slot.querySelector("#ownerreactivate");
  const openDelete = slot.querySelector("#ownerdeleteopen");
  const dialog = slot.querySelector("#ownerdelete");
  const cancel = slot.querySelector("#ownerdeletecancel");
  const form = slot.querySelector("#ownerdeleteform");
  if (pause) pause.onclick = () => pauseCompanyByOwner(row.id);
  if (reactivate) reactivate.onclick = () => reactivateCompanyByOwner(row.id);
  if (openDelete && dialog) openDelete.onclick = () => { if (dialog.showModal) dialog.showModal(); };
  if (cancel && dialog) cancel.onclick = () => { if (dialog.close) dialog.close(); };
  if (form) form.onsubmit = ev => { ev.preventDefault(); confirmDeleteCompany(row, slot); };
}
function ownerHomeCompany() {
  const profile = me && me.cloudProfile;
  const company = profile && typeof profile.companyId === "string" ? profile.companyId.trim() : "";
  if (company) return company;
  const tenant = profile && typeof profile.tenantId === "string" ? profile.tenantId.trim() : "";
  return tenant || "heartwood";
}
async function pauseCompanyByOwner(companyId) {
  try {
    await updateDoc(doc(db, "companies", companyId), {
      ownerPaused: true,
      ownerPausedAt: serverTimestamp(),
      ownerPausedBy: me.uid,
    });
    toast("Company paused");
  } catch (e) { toast(e.code || e.message); }
}
async function reactivateCompanyByOwner(companyId) {
  try {
    await updateDoc(doc(db, "companies", companyId), {
      ownerPaused: false,
      ownerReactivatedAt: serverTimestamp(),
      ownerReactivatedBy: me.uid,
    });
    toast("Company reactivated");
  } catch (e) { toast(e.code || e.message); }
}
async function confirmDeleteCompany(row, slot) {
  const input = slot.querySelector("[name=confirmName]");
  const err = slot.querySelector("#ownerdeleteerr");
  const typed = input ? input.value : "";
  if (typed !== row.name) {
    if (err) err.textContent = "Type the company name exactly.";
    return;
  }
  try {
    await callAuthed("deleteCompanyAccount", { companyId: row.id, confirmName: typed });
    const dialog = slot.querySelector("#ownerdelete");
    if (dialog && dialog.close) dialog.close();
    slot.innerHTML = "";
    toast("Company deleted");
  } catch (e) {
    if (err) err.textContent = (e && e.message) || "That company could not be deleted.";
  }
}
async function createTestCompany(form) {
  const err = form.querySelector("#testerr");
  const name = form.name.value.trim();
  if (!name) { if (err) err.textContent = "Enter a name."; return; }
  const companyId = companyIdFromName(name);
  const demo = !!form.demo.checked;
  try {
    const signedUpAt = serverTimestamp();
    await setDoc(doc(db, "companies", companyId), buildTestCompany(name, { companyId, ownerUid: me.uid, signedUpAt, demoData: demo }));
    if (demo) await writeDemo(companyId);
    form.reset();
    if (err) err.textContent = "";
    toast("Test company created");
  } catch (e) { if (err) err.textContent = e.code || e.message; }
}
async function writeDemo(companyId) {
  const bundle = demoBundle(companyId);
  for (const person of bundle.staff) await setDoc(doc(db, "users", person.id), person.data);
  for (const job of bundle.jobs) await setDoc(doc(db, "jobs", job.id), job.data);
  await updateDoc(doc(db, "companies", companyId), { demoData: true, staffCount: 2, jobCount: 2, lastActivityAt: serverTimestamp() });
}
async function createFriendInvite(out) {
  const code = newFriendCode();
  try {
    await setDoc(doc(db, "friendInvites", code), { status: "pending", createdBy: me.uid, createdAt: serverTimestamp(), note: "" });
    const link = friendInviteLink(code, location.origin);
    ui.friendOut = code + " · " + link;
    if (out) out.textContent = ui.friendOut;
    toast("Friend invite created. Copy the link below.");
  } catch (e) {
    const msg = e.code || e.message;
    ui.friendOut = msg;
    if (out) out.textContent = msg;
  }
}
function navigationType() {
  try {
    const nav = performance.getEntriesByType("navigation")[0];
    return (nav && nav.type) || "";
  } catch { return ""; }
}
function companyViewBanner({ operator = false } = {}) {
  return adminViewBannerHtml({
    platformOwner: !!(me && me.platformOwner),
    sessionCompanyId: (me && me.testCompanyId) || "",
    companyName: orgSettings().name,
    operatorAdmin: !!(operator && me && me.role === "admin"),
  });
}
function bindMasterReturn(root) {
  const scope = root && root.querySelector ? root : document;
  const btn = scope.querySelector("#backmaster");
  if (btn) btn.onclick = () => returnToMasterPage();
}
function dropViewedCompanyState() {
  if (typeof unsub === "function") {
    try { unsub(); } catch { /* listeners already stopped */ }
    unsub = null;
  }
  jobs = [];
  staff = [];
  if (me) me.testCompanyId = "";
  ui.undated = [];
  ui.done = [];
  ui.companyRecord = null;
  ui.incidents = [];
  ui.invites = [];
  ui.staffLogins = [];
  setActiveCompany(null);
  clearSavedOrg();
}
let leavingCompanyView = false;
async function returnToMasterPage({ fromPop = false } = {}) {
  if (!me || !me.platformOwner || leavingCompanyView) return;
  leavingCompanyView = true;
  const companyId = me.testCompanyId || "";
  try { sessionStorage.setItem(RETURN_MASTER_KEY, "1"); } catch { /* the session clear still runs */ }
  try {
    await setDoc(doc(db, "platformSessions", me.uid), clearedCompanySession());
  } catch (e) {
    leavingCompanyView = false;
    try { sessionStorage.removeItem(RETURN_MASTER_KEY); } catch { /* the next tap tries again */ }
    if (fromPop && companyId) {
      try { history.pushState(companyHistoryState(companyId), "", withCompanyViewParam(location.href, true)); } catch { /* stay on this page */ }
    }
    toast((e && (e.message || e.code)) || "Could not leave this company.");
    return;
  }
  try { sessionStorage.removeItem(IN_COMPANY_VIEW_KEY); } catch { /* reload opens Master from the return flag */ }
  dropViewedCompanyState();
  const bare = withCompanyViewParam(location.href, false);
  if (!fromPop) {
    const step = historyStepOnMasterReturn(history.state);
    try {
      if (step.action === "replace") history.replaceState(step.state, "", bare);
      else history.pushState(step.state, "", bare);
    } catch { /* reload still opens Master */ }
  } else if (urlMarksCompanyView(location.search)) {
    try { history.replaceState(masterHistoryState(), "", bare); } catch { /* the flag opens Master */ }
  }
  location.reload();
}
async function openTestCompany(companyId) {
  const step = historyStepOnEnter(history.state, companyId);
  const marked = withCompanyViewParam(location.href, true);
  const previous = location.pathname + location.search + location.hash;
  try {
    if (step.action === "push") history.pushState(step.state, "", marked);
    else history.replaceState(companyHistoryState(companyId), "", marked);
  } catch { /* the session still opens the company */ }
  try { sessionStorage.setItem(IN_COMPANY_VIEW_KEY, "1"); } catch { /* the address mark is enough after reload */ }
  try {
    await setDoc(doc(db, "platformSessions", me.uid), { companyId });
  } catch (e) {
    try { sessionStorage.removeItem(IN_COMPANY_VIEW_KEY); } catch { /* the address is put back below */ }
    try { history.replaceState({ callupView: "home" }, "", previous); } catch { /* stay on this page */ }
    toast((e && (e.message || e.code)) || "Could not open this company.");
    return;
  }
  location.reload();
}
async function leaveTestCompany() {
  try { await setDoc(doc(db, "platformSessions", me.uid), clearedCompanySession()); }
  catch (e) { toast((e && (e.message || e.code)) || "Could not leave this company."); return; }
  try { sessionStorage.removeItem(IN_COMPANY_VIEW_KEY); } catch { /* reload reads the cleared session */ }
  dropViewedCompanyState();
  try { history.replaceState({ callupView: "home" }, "", withCompanyViewParam(location.href, false)); } catch { /* reload leaves the company */ }
  location.reload();
}
window.addEventListener("popstate", () => {
  if (!me || !me.platformOwner || !me.testCompanyId) return;
  if (urlMarksCompanyView(location.search)) return;
  returnToMasterPage({ fromPop: true });
});
window.addEventListener("pageshow", ev => {
  if (!ev.persisted || !me || !me.platformOwner) return;
  let flagged = false;
  try { flagged = sessionStorage.getItem(IN_COMPANY_VIEW_KEY) === "1"; } catch { return; }
  if (!flagged || urlMarksCompanyView(location.search)) return;
  returnToMasterPage({ fromPop: true });
});
async function resetTestDemo(companyId) {
  if (!confirm("Put the sample jobs and staff names back? Nothing is deleted.")) return;
  try { await writeDemo(companyId); toast("Demo data reset"); }
  catch (e) { toast(e.code || e.message); }
}
async function archiveTestCompany(companyId) {
  if (!confirm("Archive this test company? It stays in the list and is not deleted.")) return;
  try {
    await updateDoc(doc(db, "companies", companyId), { status: "archived", archivedAt: serverTimestamp() });
    if (me.testCompanyId === companyId) await setDoc(doc(db, "platformSessions", me.uid), { companyId: "" });
    toast("Archived");
  } catch (e) { toast(e.code || e.message); }
}
async function saveFriendPlan(companyId, act, end) {
  try {
    if (act === "extend") {
      await updateDoc(doc(db, "companies", companyId), { plan: "friend", friendEndsAt: end ? Timestamp.fromDate(new Date(end + "T00:00:00Z")) : null });
    } else if (act === "trial") {
      await updateDoc(doc(db, "companies", companyId), { plan: "trial", trialEndsAt: Timestamp.fromDate(trialEnd(new Date())) });
    } else if (act === "paid") {
      await updateDoc(doc(db, "companies", companyId), { plan: "paid" });
    }
    toast("Plan saved");
  } catch (e) { toast(e.code || e.message); }
}
function watchMaster() {
  if (!me || !me.platformOwner || ui.masterUnsub) return;
  ui.masterUnsub = onSnapshot(collection(db, "companies"), snap => {
    ui.masterRows = snap.docs.map(d => masterRow(d.id, d.data()));
    if (ui.view === "master") renderAdmin();
  }, () => { ui.masterRows = []; if (ui.view === "master") renderAdmin(); });
  ui.friendUnsub = onSnapshot(collection(db, "friendInvites"), snap => {
    ui.friendInvites = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (ui.view === "master") renderAdmin();
  }, () => { ui.friendInvites = []; });
  ui.ticketUnsub = onSnapshot(query(collection(db, "supportTickets"), orderBy("createdAt", "desc")), snap => {
    ui.supportTickets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (ui.view === "master") renderAdmin();
  }, () => { ui.supportTickets = []; if (ui.view === "master") renderAdmin(); });
}

// ------------------------------------------------------------------ admin
// staff = people with an app login {uid,name} only (Alex, Patrick). Anyone else shows as Unallocated.
// Jobs keep assigned[] (login uids, used by the rules) and assignedNames[] (everyone, used for display/filter).
const staffName = uid => (staff.find(s => s.uid === uid) || {}).name || "?";
const skey = s => s.uid || "name:" + s.name;
function addNameOnlyStaff(list) { /* no name-only staff: only app logins are listed */ }
const namesOf = j => (j.assignedNames && j.assignedNames.length ? j.assignedNames : (j.assigned || []).map(staffName));
const label = n => staff.some(s => !s.uid && s.name === n) ? `${n} (no login)` : n;
function filtered() {
  const f = ui.staffF, sel = staff.find(s => skey(s) === f);
  return jobs.filter(j => (!f || (f === "_none" ? !namesOf(j).length : namesOf(j).map(x => x.toLowerCase()).includes((sel?.name || "").toLowerCase())))
    && jobHasType(j, ui.typeF));
}
// ServiceM8-style queues, derived from existing fields only (status + sm8Status from the importer).
const QUEUES = ["Work Order", "Quote"];          // main Jobs screen: open work only; Completed/Unsuccessful have their own screen
const QCLS = { "Quote": "q-quote", "Work Order": "q-wo", "Unsuccessful": "q-uns", "Completed": "q-comp" };
function queueOf(j) {
  if (j.status === "Cancelled" || j.sm8Status === "Unsuccessful") return "Unsuccessful";
  if (j.status === "Done" || j.sm8Status === "Completed") return "Completed";
  // Explicit CallUp quoteStatus (Draft/Accepted) wins over legacy ServiceM8 sm8Status alone.
  if (j.quoteStatus === "Draft") return "Quote";
  if (j.quoteStatus === "Accepted") return "Work Order";
  if (j.sm8Status === "Quote") return "Quote";
  return "Work Order";
}
const jobNo = j => j.sm8JobNo ? j.sm8JobNo : companyJobPrefix(orgSettings()) + "-" + String(j.id || "").slice(-4).toUpperCase();
const firstLine = s => String(s || "").split(/\n|\. /)[0];
const shortDate = s => s ? new Date(s + "T00:00:00Z").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "Unscheduled";
const NAV = [["home", "⌂", "Home"], ["compliance", "🚐", "Compliance"], ["prestart", "☑", "Prestart"], ["take5", "✋", "Take 5s"], ["chat", "💬", "Team chat"], ["dispatch", "▦", "Dispatch Board"], ["capacity", "▦", "Capacity"], ["jobs", "☰", "Jobs"], ["unscheduled", "◷", "Unscheduled"], ["quotes", "✎", "Quotes"], ["completed", "✔", "Completed"], ["crew", "⌖", "Crew map"], ["safety", "⚠", "Safety"], ["swms", "📋", "SWMS"], ["clients", "👤", "Clients"], ["staff", "👥", "Staff"], ["inbox", "✉", "Inbox", 0, 1], ["forward", "📨", "Job email"],
  ["invoices", "$", "Invoices"], ["reports", "📈", "Reports", 1], ["myjobs", "👷", "My jobs"], ["timesheet", "⏱", "Timesheet"], ["leave", "🌴", "Leave"], ["claims", "🧾", "Reimbursements"], ["reimb", "💵", "Receipt ledger", 0, 1], ["settings", "⚙", "Company"], ["master", "▣", "Master"]];
ui.view = "home"; ui.queue = "All"; ui.dview = "week"; ui.wk = 0; ui.q = "";
const PHONE = matchMedia("(max-width:760px)");
const TOUCH = matchMedia("(pointer:coarse)");
PHONE.addEventListener?.("change", () => { if (me && me.role === "admin") renderAdmin(); });
// Grouped side menu: top items, then collapsible groups (open/closed remembered on this device; the group holding the current screen is always open).
const NAV_TOP = ["home", "chat", "inbox", "forward", "clients", "staff", "master"];
const NAV_FOOT = ["settings"];
const NAV_GROUPS = [["jobs", "☰", "Jobs", ["dispatch", "capacity", "jobs", "unscheduled", "quotes", "completed", "myjobs", "crew"]], ["money", "$", "Money", ["invoices", "claims", "reimb", "timesheet", "leave"]], ["safety", "⚠", "Safety", ["safety", "swms", "prestart", "take5", "compliance"]]];
const NAV_LBL = { safety: "Incidents" };
ui.navCol = (() => { try { return JSON.parse(localStorage.getItem("hwNavCol") || "{}"); } catch { return {}; } })();
function shell(inner) {
  const cur = NAV.find(n => n[0] === ui.view);
  const item = k => { const x = NAV.find(n => n[0] === k); if (!x || x[3] || (k === "inbox" ? !canImport() : (x[4] && !isOwner())) || (k === "forward" && !canForward()) || (k === "invoices" && (!me || me.role !== "admin")) || (k === "staff" && !canInvite()) || (k === "quotes" && !canQuote()) || (k === "capacity" && !canSeeCapacity()) || (k === "compliance" && !COMP.canSee()) || (k === "prestart" && !COMP.canPrestart()) || (k === "take5" && !take5EntryVisible({ enabled: ui.take5On !== false })) || (k === "crew" && !canSeeCrewMap(me))) return "";
    const badge = k === "chat" ? CHAT.badge("staff") : "";
    if (k === "master" && !(me && me.platformOwner)) return "";
    return `<button class="sm-nav ${ui.view === k ? "on" : ""}" data-view="${k}" title="${esc(NAV_LBL[k] || x[2])}"><span class="ic">${x[1]}</span><span class="lbl">${esc(NAV_LBL[k] || x[2])}</span>${badge}</button>`; };
  const grp = ([g, ic, n, ks]) => { const has = ks.includes(ui.view), open = has || !ui.navCol[g];
    return `<div class="sm-grp ${open ? "open" : ""} ${has ? "has" : ""}"><button class="sm-gh" data-grp="${g}" aria-expanded="${open}"><span class="ic">${ic}</span><span class="lbl">${n}</span><span class="car">${open ? "▾" : "▸"}</span></button>
      <div class="sm-gi">${ks.map(item).join("")}</div></div>`; };
  return `${companyViewBanner()}<div class="sm-layout ${ui.navOpen ? "navopen" : ""}"><div class="sm-burgerbar"><button class="sm-burger" id="burger" aria-label="Menu">☰</button><b>${esc(cur ? (NAV_LBL[cur[0]] || cur[2]) : "")}</b></div>
    <nav class="sm-side">${NAV_TOP.map(item).join("")}${NAV_GROUPS.map(grp).join("")}${NAV_FOOT.map(item).join("")}<button type="button" class="sm-nav" data-raise-ticket title="Raise ticket"><span class="ic">?</span><span class="lbl">Raise ticket</span></button></nav>
    <section class="sm-main">${bannerSlotHtml()}${inner}</section></div>`;
}
// ---- Mixed work: a job whose description lines are different task types (spoil vs backslab vs waterproofing vs clean)
const TASK_RX = [["waterproof", /water ?proof/i], ["spoil", /spoil|soil removal/i], ["backslab", /back ?slab|back ?blade|slab clean|level site/i], ["clean", /\b(site |final )?clean\b/i]];
const lineKind = l => (TASK_RX.find(([, rx]) => rx.test(l)) || [null])[0];
function taskLines(desc) {
  let ls = String(desc || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (ls.length <= 1 && ls[0]) ls = ls[0].split(/(?=\b(?:back ?slab|spoil removal|waterproof\w*|site clean|slab clean)\b)/i).map(x => x.trim()).filter(Boolean);
  return ls.map(t => ({ t, k: lineKind(t) }));
}
const mixedKinds = j => [...new Set(taskLines(j.description).map(x => x.k).filter(Boolean))];
const isMixed = j => mixedKinds(j).length > 1;
function jobTypeText(j) {
  const ids = Array.isArray(j && j.types) && j.types.length ? j.types : [(j && j.type) || ""];
  const labels = [];
  for (const id of ids) {
    const label = TYPES[id];
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels.join(", ");
}
function jobHasType(j, type) {
  if (!type) return true;
  if (j && j.type === type) return true;
  return !!(j && Array.isArray(j.types) && j.types.includes(type));
}
const ipPill = (j, cls = "") => j.status === "In progress" ? `<span class="qpill ip ${cls}">In progress</span>` : "";
const ipTop = (j, cls = "") => j.status === "In progress" ? `<div class="ptop">${ipPill(j, cls)}</div>` : "";
const mixedBadge = j => isMixed(j) ? ` <span class="qpill mixed" title="${esc(mixedKinds(j).map(k => TYPES[k] || k).join(" + "))} on one job - split it">Mixed work</span>` : "";
function jobRow(j) {
  const q = queueOf(j), names = namesOf(j).map(label).join(", ");
  return `<tr class="jr" data-id="${j.id}" draggable="true"><td><span class="qdot ${QCLS[q]}" title="${q}"></span></td>
    <td class="jn">#${esc(jobNo(j))}${jobPhotosIcon(j)}</td><td><b>${esc(j.client || "")}</b><div class="sub">${esc(j.address || "-")}</div></td>
    <td>${esc(firstLine(j.description))}${mixedBadge(j)}<div class="sub">${esc(jobTypeText(j) || TYPES[j.type] || "")}${j.po ? " · PO " + esc(j.po) : ""}</div></td>
    <td>${esc(shortDate(j.date))}<div class="sub">${esc(j.time || "")}${j.durationHrs ? " · " + esc(j.durationHrs) + "h" : ""}</div></td>
    <td>${names ? esc(names) : `<span class="unal">Unallocated</span>`}</td>
    <td><span class="pstack">${ipPill(j)}<span class="qpill ${QCLS[q]}">${q}</span></span></td></tr>`;
}
// Job-list search: every typed word must appear somewhere in job no / address (lot, street) / client / PO /
// description / staff. Case-insensitive; "#659" == "659".
const qWords = () => (ui.q || "").toLowerCase().replace(/#/g, " ").split(/\s+/).filter(Boolean);
function matchQ(j) {
  const w = qWords(); if (!w.length) return true;
  const hay = [jobNo(j), j.sm8JobNo, j.client, j.address, j.description, j.po, j.type, jobTypeText(j), TYPES[j.type], (j.types || []).join(" "), namesOf(j).join(" ")].map(x => String(x ?? "")).join(" ").toLowerCase();
  return w.every(x => hay.includes(x));
}
const searchBar = () => `<div class="sbar"><span class="sbar-ic">🔍</span><input id="jq" type="search" inputmode="search" autocomplete="off" placeholder="Search job #, address, client, PO, staff…" value="${esc(ui.q || "")}">${ui.q ? `<button type="button" id="jqx" class="sbar-x" title="Clear" aria-label="Clear search">✕</button>` : ""}</div>`;
function groupByDate(list) {
  const m = new Map(); for (const j of list) { const k = j.date || ""; if (!m.has(k)) m.set(k, []); m.get(k).push(j); }
  return [...m.entries()];
}
function jobsView(all) {
  const t = ui.q.toLowerCase();
  const fs = all.filter(matchQ);
  const open = fs.filter(j => j.date && QUEUES.includes(queueOf(j)));      // unscheduled jobs have their own screen
  if (!QUEUES.includes(ui.queue)) ui.queue = "All";
  const cnt = q => open.filter(j => queueOf(j) === q).length;
  const list = open.filter(j => ui.queue === "All" || queueOf(j) === ui.queue)
    .sort((a, b) => ((a.date || "9") + (a.time || "")).localeCompare((b.date || "9") + (b.time || "")));
  return `<div class="sm-head"><h1>Jobs</h1><span class="headbtns">${canCompanyExport() ? `<button id="jobscsv" class="sm-btn">Download CSV</button>` : ""}${canFindPo() ? `<button id="findall" class="sm-btn" title="Run Find PO on every open and not-yet-invoiced job">🔎 Find all POs</button>` : ""}<button id="new" class="sm-btn primary">+ New Job</button></span></div>${searchBar()}
    <div class="qtabs"><button data-q="All" class="${ui.queue === "All" ? "on" : ""}">All open <span>${open.length}</span></button>
      ${QUEUES.map(q => `<button data-q="${q}" class="${QCLS[q]} ${ui.queue === q ? "on" : ""}"><span class="qdot ${QCLS[q]}"></span>${q} <span>${cnt(q)}</span></button>`).join("")}</div>
    <div class="filters"><select id="fs"><option value="">All staff</option>${staff.map(s => `<option value="${esc(skey(s))}" ${ui.staffF === skey(s) ? "selected" : ""}>${esc(label(s.name))}</option>`).join("")}<option value="_none" ${ui.staffF === "_none" ? "selected" : ""}>Unallocated</option></select>
      <select id="ft">${jobCategorySelectHtml(ui.tradeSetup, ui.typeF, { blank: "All categories" })}</select>
      <span class="muted sub">Showing 2 weeks back to 4 weeks ahead, plus older jobs still open (unscheduled jobs: see Unscheduled)</span></div>
    <table class="jt"><thead><tr><th></th><th>Job #</th><th>Client / Site</th><th>Description</th><th>Scheduled</th><th>Staff</th><th>Status</th></tr></thead>
    <tbody>${groupByDate(list).map(([d, js]) => `<tr class="dayhdr"><td colspan="7">${esc(d ? dayLabel(d) : "Unscheduled")} <span class="cnt">${js.length}</span></td></tr>${js.map(jobRow).join("")}`).join("") || `<tr><td colspan="7" class="muted pad">No jobs in this queue for ${esc(orgSettings().name)}.</td></tr>`}</tbody></table>`;
}
// Unscheduled screen: open jobs with no booking date, newest first. "Schedule" opens the job card on the date field.
// (Jobs created in ServiceM8 more than 90 days ago are not imported at all, see tools/sm8_import.py.)
const createdOf = j => j.sm8Created || (j.createdAt && j.createdAt.toDate ? ymd(j.createdAt.toDate()) : "");
function unscheduledView(all) {
  const t = ui.q.toLowerCase();
  const list = all.filter(j => !j.date && QUEUES.includes(queueOf(j)) && jobHasType(j, ui.typeF)
      && matchQ(j))
    .sort((a, b) => createdOf(b).localeCompare(createdOf(a)) || String(b.sm8JobNo || "").localeCompare(String(a.sm8JobNo || ""), undefined, { numeric: true }));
  return `<div class="sm-head"><h1>Unscheduled jobs <span class="cnt">${list.length}</span></h1><button id="new" class="sm-btn primary">+ New Job</button></div>${searchBar()}
    <p class="sub muted">Open jobs with no booking date, newest first.${myCompanyId() === "heartwood" ? " Jobs created more than 3 months ago are not shown." : ""}</p>
    <table class="jt"><thead><tr><th></th><th>Job #</th><th>Client / Site</th><th>Description</th><th>PO</th><th>Created</th><th></th></tr></thead>
    <tbody>${list.map(j => `<tr class="jr" data-id="${j.id}"><td><span class="qdot ${QCLS[queueOf(j)]}"></span></td><td class="jn">#${esc(jobNo(j))}${jobPhotosIcon(j)}</td>
      <td><b>${esc(j.client || "")}</b><div class="sub">${esc(j.address || "-")}</div></td><td>${esc(firstLine(j.description))}<div class="sub">${esc(jobTypeText(j) || TYPES[j.type] || "")}</div></td>
      <td>${esc(j.po || "—")}</td><td>${createdOf(j) ? esc(shortDate(createdOf(j))) : "—"}</td>
      <td><button type="button" class="sm-btn primary" data-sched="${j.id}">Schedule</button></td></tr>`).join("") || `<tr><td colspan="7" class="muted pad">Nothing unscheduled – nice.</td></tr>`}</tbody></table>`;
}
// ---- Check Xero (Xero users only). Read-only: QUEUES {type:'check'} in xeroQueue; the box worker (tools/xero_queue.py,
// every 5 min 6am-8pm, or by hand) searches Xero invoices with GET only and writes jobs/{id}.xeroCheck
// {checkedAt, status: invoiced/draft/not found/multiple, matches:[{invoiceNumber,status,totalEx,date,amountDue}]}.
const xcAgo = t => { const ms = Date.now() - new Date(t).getTime(); if (!(ms >= 0)) return ""; const m = Math.round(ms / 60000);
  return m < 1 ? "checked just now" : m < 60 ? `checked ${m} min ago` : m < 1440 ? `checked ${Math.round(m / 60)} h ago` : `checked ${Math.round(m / 1440)} d ago`; };
const XC_ST = { PAID: "Paid", AUTHORISED: "Awaiting payment", DRAFT: "Draft", SUBMITTED: "Awaiting approval" };
function xcLabel(j) {
  if (j.xeroCheckPending) return `<span class="qpill xc-wait">Checking…</span>`;
  const x = j.xeroCheck; if (!x) return "";
  const m = x.matches || [], n0 = m[0] || {};
  const lab = x.status === "invoiced" ? `Invoiced ${esc(n0.invoiceNumber || "")} · ${esc(XC_ST[n0.status] || n0.status || "")}` : x.status === "draft" ? `Draft in Xero${n0.invoiceNumber ? " " + esc(n0.invoiceNumber) : ""}`
    : x.status === "multiple" ? `${m.length} matches in Xero` : x.status === "error" ? "Xero check failed" : "Not found in Xero";
  const cls = x.status === "invoiced" ? "xc-ok" : x.status === "draft" ? "xc-draft" : x.status === "multiple" ? "xc-multi" : x.status === "error" ? "q-alert" : "xc-none";
  const tip = m.map(i => `${i.invoiceNumber} ${i.status}${canSeeMoney() ? ` $${(+i.totalEx || 0).toFixed(2)} ex GST` : ""} ${i.date || ""}${canSeeMoney() ? ` due $${(+i.amountDue || 0).toFixed(2)}` : ""}`).join("\n") || x.error || x.note || "";
  return `<span class="qpill ${cls}" title="${esc(tip)}">${lab}</span> <span class="sub muted xc-ago">${esc(xcAgo(x.checkedAt))}</span>`;
}
function xcCell(j) { if (!canXero() || queueOf(j) !== "Completed") return "";
  return `<div class="xc">${xcLabel(j)} <button type="button" class="sm-btn xero xc-btn" data-xc="${j.id}" ${j.xeroCheckPending ? "disabled" : ""}>${j.xeroCheck ? "Re-check" : "Check Xero"}</button></div>`; }
async function checkXero(list) {
  if (testCompanyActive()) return holdOutbound("xero", "Xero check was not queued.");
  if (!canXero()) return; list = list.filter(j => queueOf(j) === "Completed" && !j.xeroCheckPending);
  if (!list.length) { toast("Already checking."); return; }
  for (const j of list) {
    try { await addDoc(collection(db, "xeroQueue"), { type: "check", jobId: j.id, status: "queued", by: auth.currentUser.uid, at: serverTimestamp() });
      await updateDoc(doc(db, "jobs", j.id), { xeroCheckPending: true, xeroCheckQueuedAt: serverTimestamp() }); }
    catch (e) { if (e && e.code === "permission-denied") { alert("Check Xero isn't switched on yet (Firestore rules). Nothing was queued."); return; }
      toast("Couldn't queue the Xero check: " + (e.code || e.message)); return; }
  }
  toast(`Checking ${list.length} job${list.length === 1 ? "" : "s"} in Xero – the box checks every 5 min (6am–8pm).`); renderAdmin();
}
function bindXc(root, pool) { root.querySelectorAll("[data-xc]").forEach(b => b.onclick = e => { e.stopPropagation(); e.preventDefault();
  const j = (pool || []).find(x => x.id === b.dataset.xc) || (ui.done || []).find(x => x.id === b.dataset.xc); if (j) checkXero([j]); }); }
// Completed screen: Completed (default) or Unsuccessful, newest first, grouped by day. Uses the 6-week window plus
// every Done job (ui.done, any date) so older completions are still listed.
function completedView(all) {
  const kind = ui.cq === "Unsuccessful" ? "Unsuccessful" : "Completed", t = ui.q.toLowerCase();
  const m = new Map(); for (const j of [...all, ...(ui.done || [])]) if (!m.has(j.id)) m.set(j.id, j);
  const pool = [...m.values()].filter(j => jobHasType(j, ui.typeF) && matchQ(j));
  const cnt = k => pool.filter(j => queueOf(j) === k).length;
  const list = pool.filter(j => queueOf(j) === kind).sort((a, b) => ((b.date || "") + (b.time || "")).localeCompare((a.date || "") + (a.time || "")));
  const xc = canXero() && kind === "Completed"; ui.xcList = xc ? list : [];
  return `<div class="sm-head"><h1>${kind} jobs</h1>${xc && list.length ? `<button id="xcall" class="sm-btn xero" title="Read-only: looks each job up in Xero. Nothing is created or changed in Xero.">Check all in Xero (${list.length})</button>` : ""}</div>${searchBar()}
    <div class="qtabs">${["Completed", "Unsuccessful"].map(k => `<button data-cq="${k}" class="${QCLS[k]} ${kind === k ? "on" : ""}"><span class="qdot ${QCLS[k]}"></span>${k} <span>${cnt(k)}</span></button>`).join("")}</div>
    <table class="jt"><thead><tr><th></th><th>Job #</th><th>Client / Site</th><th>Description</th><th>Scheduled</th><th>Staff</th><th>Status</th>${xc ? "<th>Xero</th>" : ""}</tr></thead>
    <tbody>${groupByDate(list).map(([d, js]) => `<tr class="dayhdr"><td colspan="${xc ? 8 : 7}">${esc(d ? dayLabel(d) : "No date")} <span class="cnt">${js.length}</span></td></tr>${js.map(j => xc ? jobRow(j).replace(/<\/tr>$/, `<td>${xcCell(j)}</td></tr>`) : jobRow(j)).join("")}`).join("") || `<tr><td colspan="7" class="muted pad">No ${kind.toLowerCase()} jobs</td></tr>`}</tbody></table>`;
}
function rowsFor(all) {
  const rows = staff.map(s => ({ key: skey(s), name: label(s.name), raw: s.name }));
  rows.push({ key: "_none", name: "Unallocated", raw: null });
  const has = (j, r) => r.raw ? namesOf(j).map(x => x.toLowerCase()).includes(r.raw.toLowerCase()) : !namesOf(j).length;
  return rows.map(r => ({ ...r, has: j => has(j, r) }));
}
function dispatchView(all) {
  if (PHONE.matches) return mobileDispatch(all);
  const t0 = todayStr(), wk0 = addDays(addDays(t0, -dowMon(t0)), 7 * ui.wk);
  const dayD = addDays(t0, ui.wk);
  const days = ui.dview === "week" ? [...Array(7)].map((_, i) => addDays(wk0, i)) : [dayD];
  noteDispatch(all, days);
  const sched = all.filter(j => j.date && queueOf(j) !== "Unsuccessful");
  const rows = rowsFor(all);
  const cellAway = (row, day) => {
    if (!row.raw) return "";
    const person = staff.find(s => skey(s) === row.key);
    return cellLeaveText(ui.leave || [], { uid: person && person.uid || "", name: row.raw }, day);
  };
  const orderedChips = (row, day) => rowPlan(row, day, sched).map(slot => {
    const j = sched.find(x => x.id === slot.id);
    return j ? dispatchChip(j, slot) : "";
  }).join("");
  let grid;
  if (ui.dview === "week") {
    grid = `<div class="dgrid" style="grid-template-columns:150px repeat(7,minmax(0,1fr))"><div class="dh"></div>${days.map(d => `<div class="dh ${d === t0 ? "today" : ""}">${shortDate(d)}</div>`).join("")}
      ${rows.map(r => `<div class="dname">${esc(r.name)}</div>${days.map(d => { const away = cellAway(r, d); return `<div class="dcell drop ${d === t0 ? "today" : ""}" data-date="${d}" data-staff="${esc(r.key)}">
        ${away ? `<div class="leave-chip">${esc(away)}</div>` : ""}${orderedChips(r, d)}</div>`; }).join("")}`).join("")}</div>`;
  } else {
    const hrs = [...Array(13)].map((_, i) => 6 + i);
    const plans = new Map(rows.map(r => [r.key, rowPlan(r, dayD, sched)]));
    grid = `<div class="dgrid" style="grid-template-columns:150px repeat(13,minmax(0,1fr))"><div class="dh"></div>${hrs.map(h => `<div class="dh">${h > 12 ? h - 12 + "pm" : h + (h === 12 ? "pm" : "am")}</div>`).join("")}
      ${rows.map(r => `<div class="dname">${esc(r.name)}</div>${hrs.map(h => `<div class="dcell drop" data-date="${dayD}" data-hour="${h}" data-staff="${esc(r.key)}">
        ${h === 6 && cellAway(r, dayD) ? `<div class="leave-chip">${esc(cellAway(r, dayD))}</div>` : ""}${(plans.get(r.key) || []).filter(slot => boardHour(slot) === h).map(slot => { const j = sched.find(x => x.id === slot.id); return j ? dispatchChip(j, slot) : ""; }).join("")}</div>`).join("")}`).join("")}</div>`;
  }
  const leaveBanner = plannerLeaveHtml(ui.leave || [], days, staff.map(s => ({ uid: s.uid || "", name: s.name })));
  return `<div class="sm-head"><h1>Dispatch Board</h1>
      <div class="seg"><button data-dv="day" class="${ui.dview === "day" ? "on" : ""}">Day</button><button data-dv="week" class="${ui.dview === "week" ? "on" : ""}">Week</button></div>
      <button class="sm-btn" data-wk="-1">‹</button><button class="sm-btn" data-wk="0">Today</button><button class="sm-btn" data-wk="1">›</button>
      <span class="drange">${ui.dview === "week" ? shortDate(days[0]) + " – " + shortDate(days[6]) : dayLabel(dayD)}</span>
      <button type="button" class="sm-btn route-open" id="optorder">Optimise order</button>
      <button id="new" class="sm-btn primary">+ New Job</button></div>
    ${leaveBanner}
    <div class="dwrap"><div class="dboard"><p class="touchhint">Tap a job to open it. Press and hold a job to move it to another day or staff member.</p><div class="dgrid-scroll">${grid}</div><p class="sub muted">Drag a job to another day or staff member to reschedule (${esc(syncNote("saved in the app, synced at the next sync", "saved straight away"))}).</p></div>
      </div>`;
}
// Floating "Done today" card (dispatch board + job list). Today = Brisbane date of completedAt (fallback: job date when
// there is no completion stamp). Live via the Done-jobs snapshot. Collapsed state remembered on this device.
const tsDay = v => { if (v == null) return null; const d = v.toDate ? v.toDate() : new Date(v); return isNaN(d) ? null : ymd(d); };
function doneToday() {
  const t = todayStr(), m = new Map();
  for (const j of [...(ui.done || []), ...jobs.filter(x => x.status === "Done")]) {
    if (j.status !== "Done" || m.has(j.id)) continue;
    const cd = j.completedAt === null ? t : tsDay(j.completedAt);        // null = our own pending server timestamp
    if (cd ? cd === t : j.date === t) m.set(j.id, j);
  }
  const ms = j => j.completedAt?.toMillis?.() ?? (j.completedAt === null ? Date.now() : 0);
  return [...m.values()].sort((a, b) => ms(b) - ms(a));
}
// Parallel private Storage mirror. Email and receiptChunks stay until a reviewed cutover.
// Failures here must not block the existing queue. Tenant comes from the profile, not the page.
function cloudMembership() {
  if (!me) return { ok: false, reason: "no-membership" };
  return resolveMembership({ uid: me.uid, profile: me.cloudProfile || null });
}
function b64ToBlob(b64, type) {
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
async function warmUpcoming(list) {
  if (!me || !deviceOnline()) return;
  const today = todayStr();
  const source = (list && list.length ? list : jobs) || [];
  if (!source.length) return;
  const office = me.role === "admin" || me.role === "manager" || me.role === "supervisor" || canSeeMoney();
  const picked = jobsToWarm(source, { today, uid: me.uid, office });
  const key = myCompanyId() + ":" + me.uid + ":" + today + ":" + picked.length + ":" + source.length;
  if (ui.warmKey === key) return;
  ui.warmKey = key;
  const swmsIds = companyHasSwms() ? companySwms(myCompanyId()).map(row => row[0]) : [];
  const reads = warmReads({ jobs: picked, companyId: myCompanyId(), uid: me.uid, swmsIds, today });
  for (const read of reads) {
    try {
      if (read.kind === "documents") {
        const col = collection(db, "jobs", read.jobId, "documents");
        const src = canManageDocuments(documentActorRole()) ? col : query(col, where("visibility", "==", "crew"));
        await getDocs(src);
      } else if (read.kind === "run-sheet") {
        const id = runSheetId(read.uid, read.date);
        if (id) await cachedGetDoc(doc(db, "runSheets", id));
      } else if (read.kind === "company") {
        await cachedGetDoc(doc(db, "companies", read.companyId));
      } else if (read.kind === "prestart-templates") {
        await getDocs(collection(db, "tenants", read.companyId, "prestartTemplates"));
      } else if (read.kind === "fleet") {
        await getDocs(collection(db, "tenants", read.companyId, "fleet"));
      } else if (read.kind === "take5-settings") {
        await getDoc(doc(db, "take5Settings", read.companyId));
      } else if (read.kind === "swms") {
        await getDocs(query(collection(db, "swmsChunks"), where("file", "==", read.id)));
      } else if (read.kind === "swms-signatures") {
        const sigs = read.companyId === "heartwood"
          ? query(collection(db, "swmsSignatures"), where("uid", "==", read.uid))
          : query(collection(db, "swmsSignatures"), where("uid", "==", read.uid), where("companyId", "==", read.companyId));
        await getDocs(sigs);
      }
    } catch { /* a rule or a missing document must not stop the rest of the warm */ }
  }
}
function rememberQueuedThumb(jobId, file) {
  if (!jobId || !file || typeof URL === "undefined" || !URL.createObjectURL) return;
  const type = file.type || "";
  if (!type.startsWith("image/")) return;
  ui.queuedThumbs[jobId] = ui.queuedThumbs[jobId] || [];
  ui.queuedThumbs[jobId].push(URL.createObjectURL(file));
  paintPhotoSlots();
}
async function enqueueUpload(row) {
  const built = makeUpload(row);
  if (!built.ok) return false;
  await offlineStore.putFile(built.row);
  if (built.row.kind === "photo" && built.row.extra && built.row.extra.jobId) rememberQueuedThumb(built.row.extra.jobId, built.row.file);
  paintSync();
  registerUploadSync().catch(() => {});
  return true;
}
async function flushOffline() {
  if (flushBusy || !me || !deviceOnline()) return;
  flushBusy = true;
  try {
    const uid = me.uid;
    const files = await offlineStore.listFiles(uid);
    const result = await flushUploads(files, { online: true, upload: row => sendQueuedFile(row) });
    for (const row of result.uploaded) await offlineStore.removeFile(row.id);
    for (const row of [...result.kept, ...result.refused]) await offlineStore.putFile(row);
    const box = await offlineStore.listOutbox(uid);
    for (const item of box) {
      if (item.hold) continue;
      try {
        if (item.kind === "incident") await replayIncident(item.payload);
        else continue;
        await offlineStore.removeOutbox(item.id);
      } catch (error) {
        const next = { ...item, attempts: (item.attempts || 0) + 1, lastError: String((error && (error.code || error.message)) || "retry"), hold: classifyUploadError(error) === "refused" };
        await offlineStore.putOutbox(next);
      }
    }
    try {
      await flushDocumentQueue({
        queue: sharedQueue(), uid, online: true,
        upload: row => uploadBytes(storageRef(storage, row.path), row.file, { contentType: row.contentType, customMetadata: row.metadata || {} }),
        writeDoc: row => setDoc(doc(db, "jobs", row.firestore.jobId, "documents", row.id), { ...row.firestore, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }),
      });
    } catch { /* the document queue retries on the next open */ }
  } finally {
    flushBusy = false;
    paintSync();
  }
}
async function sendQueuedFile(row) {
  // Receipt bytes are allowed only after the receipt document exists. Write that first.
  if (row.kind === "receipt" && row.extra && !row.extra.firestoreWritten) await writeQueuedReceipt(row);
  await uploadBytes(storageRef(storage, row.path), row.file, { contentType: row.contentType || "application/octet-stream", customMetadata: row.metadata || {} });
  if (row.kind === "photo" && row.extra && row.extra.jobId) {
    const label = row.label || "Photo";
    updateDoc(doc(db, "jobs", row.extra.jobId), { log: arrayUnion(logEntry(`Photo saved from this phone (${label})`)), updatedAt: serverTimestamp(), updatedBy: me.uid }).catch(() => {});
  }
}
async function writeQueuedReceipt(row) {
  const extra = row.extra || {};
  const b64 = await blobToB64(row.file);
  const CH = 700000;
  const n = Math.ceil(b64.length / CH) || 1;
  const rco = extra.companyId && extra.companyId !== "heartwood" ? { companyId: extra.companyId, tenantId: extra.companyId } : {};
  for (let i = 0; i < n; i++) {
    await setDoc(doc(db, "receiptChunks", `${row.id}_${i}`), { rid: row.id, i, uid: me.uid, data: b64.slice(i * CH, (i + 1) * CH), ...rco });
  }
  await setDoc(doc(db, "receipts", row.id), {
    uid: me.uid, workerName: extra.workerName || me.name, ...extra.measures, supplier: extra.supplier, paidPersonally: extra.paidPersonally,
    jobNo: extra.jobNo || null, jobId: extra.jobId || null, address: extra.address || null, chunks: n, mime: "image/jpeg",
    bytes: row.bytes || Math.round(b64.length * 0.75), status: "queued", createdAt: serverTimestamp(), createdAtIso: extra.createdAtIso || new Date().toISOString(), ...rco,
  });
  row.extra.firestoreWritten = true;
}
function blobToB64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
async function replayIncident(data) {
  return runTransaction(db, async tx => {
    const cref = doc(db, "incidentCounter", myCompanyId() === "heartwood" ? "main" : myCompanyId());
    const c = await tx.get(cref);
    const n = (c.exists() ? c.data().n : 0) + 1;
    const reportNo = incPad(n);
    const id = myCompanyId() === "heartwood" ? reportNo : myCompanyId() + "_" + reportNo;
    tx.set(cref, { n });
    tx.set(doc(db, "incidents", id), { ...data, createdAt: data.createdAt || serverTimestamp(), seq: n, reportNo });
    return { id, reportNo };
  });
}
// Job photos go to Storage first, so a phone with no signal must not sit silently on "Saving photos" for the
// SDK's 10-minute retry window. Offline skips straight to the email fallback. Each photo uploads resumably with a
// progress toast and is cancelled if no bytes move for PHOTO_STALL_MS. One failed photo no longer fails the batch:
// stored photos stay stored and only the failed ones are offered for email.
const PHOTO_STALL_MS = 45000;
function uploadJobPhoto(target, file, onProgress) {
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef(storage, target.path), file, { contentType: target.contentType, customMetadata: target.metadata });
    let timer = null, settled = false;
    const fail = e => { if (settled) return; settled = true; clearTimeout(timer); reject(e); };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { fail(Object.assign(new Error("upload-stalled"), { code: "upload-stalled" })); try { task.cancel(); } catch {} }, PHOTO_STALL_MS);
    };
    arm();
    task.on("state_changed", snap => {
      arm();
      if (onProgress && snap.totalBytes) onProgress(snap.bytesTransferred / snap.totalBytes);
    }, fail, () => { if (settled) return; settled = true; clearTimeout(timer); resolve(); });
  });
}
function photoFailReason(e) {
  const code = e && (e.code || e.message);
  if (code === "upload-stalled" || code === "photo-file-missing") return code;
  return storageErrorCode(e);
}
async function queuePlannedPhotos(j, files, plan) {
  let queued = 0;
  for (const target of plan.uploads || []) {
    const file = files[target.sourceIndex];
    if (!file) continue;
    const id = (target.path || "").split("/").pop() || ("p" + queued + Date.now());
    const ok = await enqueueUpload({
      id, kind: "photo", uid: me.uid, companyId: myCompanyId(), path: target.path,
      contentType: target.contentType, metadata: target.metadata, label: file.name || ("Photo " + jobNo(j)),
      file, extra: { jobId: j.id },
    });
    if (ok) queued += 1;
  }
  return queued;
}
async function mirrorJobPhotos(j, files) {
  const at = galleryNow();
  let plan = planJobPhotoMirrors({
    membership: cloudMembership(), job: j,
    files: files.map((f, i) => ({
      name: f.name, type: f.type || "image/jpeg", size: f.size || 1,
      photoId: (`p${i}${Math.random().toString(36).slice(2, 10)}`).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 41),
    })),
  });
  if (!plan.ok) { console.warn("cloud photo mirror skipped", (plan.skipped || []).map(s => s.reason).join(",") || "none"); return { ok: false, reason: (plan.skipped || []).map(s => s.reason).join(",") || "none", uploaded: [], skipped: plan.skipped || [] }; }
  plan = stampExpiresAfter(plan, j, at);
  if (!deviceOnline()) {
    const queued = await queuePlannedPhotos(j, files, plan);
    if (queued) return { ok: false, reason: "queued", uploaded: [], skipped: plan.skipped || [], queued };
    return { ok: false, reason: "offline", uploaded: [], skipped: files.map((f, sourceIndex) => ({ sourceIndex, name: f && f.name, reason: "offline" })) };
  }
  const total = (plan.uploads || []).length, failed = [], queuedIndexes = new Set();
  let at1 = 0, signalLost = "", lastMsg = "", lastMove = Date.now();
  const say = pct => {
    lastMove = Date.now();
    lastMsg = total > 1 ? `Saving photo ${at1} of ${total}… ${Math.round(pct * 100)}%` : `Saving photo… ${Math.round(pct * 100)}%`;
    toast(lastMsg);
  };
  // Keep the status on screen while bytes are not moving, so a weak signal does not look like nothing happened.
  const keepUp = setInterval(() => { if (lastMsg) toast(Date.now() - lastMove > 5000 ? `${lastMsg} · weak signal, still trying` : lastMsg); }, 2000);
  try { await putPlanned(plan, async target => {
    const file = files[target.sourceIndex];
    at1++;
    try {
      if (!file) throw Object.assign(new Error("photo-file-missing"), { code: "photo-file-missing" });
      // Once the signal has gone, don't make the rest wait out their own stall timers.
      if (!signalLost && typeof navigator !== "undefined" && navigator.onLine === false) signalLost = "offline";
      if (signalLost) throw Object.assign(new Error(signalLost), { code: signalLost });
      say(0);
      await uploadJobPhoto(target, file, say);
      return target;
    } catch (e) {
      const reason = e && e.code === "offline" ? "offline" : photoFailReason(e);
      if (["offline", "upload-stalled", "storage/retry-limit-exceeded"].includes(reason)) signalLost = signalLost || reason;
      console.warn("cloud photo upload", reason);
      if (["offline", "upload-stalled", "storage/retry-limit-exceeded"].includes(reason) && file) {
        const id = (target.path || "").split("/").pop() || ("p" + target.sourceIndex);
        const saved = await enqueueUpload({
          id, kind: "photo", uid: me.uid, companyId: myCompanyId(), path: target.path,
          contentType: target.contentType, metadata: target.metadata, label: file.name || ("Photo " + jobNo(j)),
          file, extra: { jobId: j.id },
        });
        if (saved) { queuedIndexes.add(target.sourceIndex); return null; }
      }
      failed.push({ sourceIndex: target.sourceIndex, name: file && file.name, reason });
      return null;
    }
  }); } finally { clearInterval(keepUp); }
  const uploaded = (plan.uploads || []).filter(u => !failed.some(f => f.sourceIndex === u.sourceIndex) && !queuedIndexes.has(u.sourceIndex));
  const skipped = [...(plan.skipped || []), ...failed];
  if (!uploaded.length && queuedIndexes.size && !failed.length && !(plan.skipped || []).length) {
    return { ok: false, reason: "queued", uploaded: [], skipped: [], queued: queuedIndexes.size };
  }
  if (!uploaded.length && !queuedIndexes.size) return { ok: false, reason: (failed[0] && failed[0].reason) || "mirror-failed", uploaded: [], skipped };
  // Not a retention anchor, including on a completed job. Listing still uses the
  // job's completion or existing activity date. This only asks other open phones to list again.
  // Staff can't write cloudPhotosAt (rules). Their upload already bumps photosEmailedAt, which photoMark also watches.
  if (me && me.role === "admin") updateDoc(doc(db, "jobs", j.id), { cloudPhotosAt: at.toISOString() }).catch(e => console.warn("cloud photo stamp not saved", e.code || e.message));
  // Refresh the gallery in the background. Listing every photo's metadata must not hold up "Photos saved".
  ensurePhotoList(j, true).then(paintPhotoSlots);
  return { ok: true, uploaded, skipped };
}
function galleryNow() {
  const pin = typeof window !== "undefined" ? window.HW_TODAY : "";
  if (typeof pin === "string" && /^\d{4}-\d{2}-\d{2}$/.test(pin)) return new Date(pin + "T12:00:00+10:00");
  return new Date();
}
function photoMark(j) { return String(j && j.cloudPhotosAt || "") + "|" + String(j && j.photosEmailedAt || ""); }
function rememberJob(j) { if (j && j.id) ui.photoJobs[j.id] = j; }
function findJob(id) {
  return [...(jobs || []), ...(ui.done || []), ...(ui.undated || [])].find(j => j.id === id) || ui.photoJobs[id] || null;
}
async function loadJobPhotoListing(j) {
  const prefix = jobPhotoPrefix(cloudMembership(), j);
  if (!prefix.ok) return { ok: false, reason: prefix.reason };
  const listed = await listAll(storageRef(storage, prefix.prefix));
  const rows = [];
  for (const itemRef of listed.items || []) {
    const path = itemRef.fullPath || itemRef.path;
    try {
      const meta = await getMetadata(itemRef);
      rows.push({ path, contentType: meta.contentType || "", customMetadata: meta.customMetadata || {}, size: meta.size, timeCreated: meta.timeCreated || null });
    } catch (e) {
      rows.push({ path, error: e });
    }
  }
  return summarizePhotoListing(rows);
}
function ensurePhotoList(j, force) {
  if (!j?.id) return Promise.resolve();
  const mark = photoMark(j);
  const row = ui.photoLists[j.id];
  if (!force && row && row.mark === mark && row.status === "ready") return Promise.resolve(row);
  if (!force && row && row.mark === mark && row.status === "loading" && row.pending) return row.pending;
  const seq = (row?.seq || 0) + 1;
  ui.photoLists[j.id] = { status: "loading", count: row?.count || 0, mark, seq, error: "" };
  const pending = loadJobPhotoListing(j).then(res => {
    if (ui.photoLists[j.id]?.seq !== seq) return;
    const current = findJob(j.id) || j;
    if (!res.ok) ui.photoLists[j.id] = { status: "error", count: 0, mark: photoMark(current), seq, error: res.reason || "error" };
    else {
      const gallery = buildJobGallery({ membership: cloudMembership(), job: current, listing: res.items, now: galleryNow() });
      ui.photoLists[j.id] = {
        status: gallery.ok ? "ready" : "error", count: gallery.ok ? gallery.photos.length : 0,
        mark: photoMark(current), seq, gallery: gallery.ok ? gallery : null, error: gallery.ok ? "" : (gallery.reason || "error"),
      };
    }
    paintPhotoSlots();
  }).catch(e => {
    if (ui.photoLists[j.id]?.seq !== seq) return;
    ui.photoLists[j.id] = { status: "error", count: 0, mark, seq, error: storageErrorCode(e) };
    paintPhotoSlots();
  });
  ui.photoLists[j.id].pending = pending;
  paintPhotoSlots();
  return pending;
}
function watchJobPhotos(j) {
  return ensurePhotoList(j).then(() => { paintPhotoSlots(); });
}
function paintPhotoSlots() {
  if (ui.photoObserver) ui.photoObserver.disconnect();
  document.querySelectorAll("[data-photoslot]").forEach(el => {
    const id = el.dataset.photoslot;
    const row = ui.photoLists[id];
    const photos = (row?.gallery?.photos || []).map(p => ({
      path: p.path,
      thumb: ui.photoThumbs[p.path] || "",
      failed: !!ui.photoErrors?.[p.path],
      error: ui.photoErrors?.[p.path] || "",
    }));
    const queued = ui.queuedThumbs[id] || [];
    const queuedHtml = queued.length ? `<div class="qthumbs">${queued.map(src => `<img src="${esc(src)}" alt="">`).join("")}<p class="sub">${esc(SAVED_ON_PHONE)}</p></div>` : "";
    el.innerHTML = queuedHtml + photoSlotHtml({
      jobId: id, status: row?.status || "loading", count: row?.count || 0,
      role: el.dataset.photorole || "both", variant: el.dataset.photovariant === "sm" ? "sm" : "phone",
      iconHtml: el.dataset.photovariant === "sm" ? "" : ICO.photos,
      error: row?.error || "",
      emailedCount: Number(findJob(id)?.photosEmailedCount) || 0,
      photos, retentionText: row?.gallery?.retentionText || "",
    });
    el.dataset.settled = row && row.status && row.status !== "loading" ? "1" : "";
    el.querySelectorAll("button.pth[data-photo-path]").forEach(b => b.onclick = ev => {
      ev.preventDefault(); ev.stopPropagation();
      const job = findJob(id); if (job) openPhotoLightbox(job, b.dataset.photoPath);
    });
    el.querySelectorAll("[data-photoretry]").forEach(b => b.onclick = ev => {
      ev.preventDefault(); ev.stopPropagation();
      const job = findJob(b.dataset.photoretry); if (job) ensurePhotoList(job, true).then(() => paintPhotoSlots());
    });
  });
  queuePhotoThumbs();
}
function photoObserver() {
  if (ui.photoObserver) return ui.photoObserver;
  if (typeof IntersectionObserver !== "function") return null;
  ui.photoObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      ui.photoObserver.unobserve(entry.target);
      const img = entry.target.querySelector?.("img[data-photo-path]") || entry.target;
      loadThumb(img);
    }
  }, { root: null, rootMargin: "600px 0px" });
  return ui.photoObserver;
}
function queuePhotoThumbs(root) {
  const scope = root && root.querySelectorAll ? root : document;
  scope.querySelectorAll("button.pth[data-photo-path]").forEach(btn => {
    const img = btn.querySelector("img[data-photo-path]");
    if (!img || img.getAttribute("src") || btn.closest("[hidden]")) return;
    const io = photoObserver();
    if (io) io.observe(btn);
    else loadThumb(img);
  });
}
async function blobForPhoto(path) {
  if (ui.photoBlobs[path]) return ui.photoBlobs[path];
  const blob = await getBlob(storageRef(storage, path));
  ui.photoBlobs[path] = blob;
  if (!ui.photoUrls[path]) ui.photoUrls[path] = URL.createObjectURL(blob);
  return blob;
}
async function thumbUrlFor(path) {
  if (ui.photoThumbs[path]) return ui.photoThumbs[path];
  const blob = await blobForPhoto(path);
  const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" }).catch(() => null);
  if (!bmp) {
    ui.photoThumbs[path] = ui.photoUrls[path];
    return ui.photoThumbs[path];
  }
  const edge = Math.max(bmp.width, bmp.height) || 1;
  const k = Math.min(1, 320 / edge);
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const out = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.72));
  ui.photoThumbs[path] = URL.createObjectURL(out || blob);
  return ui.photoThumbs[path];
}
function loadThumb(img) {
  const path = img && img.dataset.photoPath;
  if (!path) return Promise.resolve();
  const paint = src => {
    if (!src) return;
    document.querySelectorAll("img[data-photo-path]").forEach(el => {
      if (el.dataset.photoPath !== path) return;
      el.hidden = false;
      el.src = src;
    });
  };
  if (ui.photoThumbs[path]) { paint(ui.photoThumbs[path]); return Promise.resolve(); }
  if (!ui.photoThumbTasks[path]) {
    ui.photoThumbTasks[path] = thumbUrlFor(path).catch(e => {
      const code = storageErrorCode(e);
      ui.photoErrors = ui.photoErrors || {};
      ui.photoErrors[path] = code;
      document.querySelectorAll("button.pth").forEach(btn => {
        if (btn.dataset.photoPath !== path) return;
        btn.disabled = true;
        btn.classList.add("perr");
        btn.textContent = photoFailureText(code);
      });
      return "";
    });
  }
  return ui.photoThumbTasks[path].then(paint);
}
function photoCaption(j, path) {
  const meta = ui.photoLists[j.id]?.gallery?.photos?.find(p => p.path === path);
  if (meta?.timeCreated) {
    const d = new Date(meta.timeCreated);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString("en-AU", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });
  }
  return "Job photo";
}
function lightboxHost() {
  return document.querySelector("dialog[open]") || document.body;
}
async function openPhotoLightbox(j, path, index) {
  const photos = ui.photoLists[j.id]?.gallery?.photos || [];
  if (!photos.length || !j) return;
  let i = Number.isInteger(index) ? index : photos.findIndex(p => p.path === path);
  if (i < 0) i = 0;
  i = ((i % photos.length) + photos.length) % photos.length;
  const photo = photos[i];
  let src = "";
  let caption = photoCaption(j, photo.path);
  try {
    await blobForPhoto(photo.path);
    src = ui.photoUrls[photo.path] || "";
  } catch (e) {
    caption = photoFailureText(storageErrorCode(e));
  }
  const host = lightboxHost();
  host.querySelectorAll(".pview").forEach(node => node.remove());
  const wrap = document.createElement("div");
  wrap.innerHTML = lightboxHtml({ src, caption, closeHtml: "×", index: i, count: photos.length });
  const el = wrap.firstElementChild;
  el.dataset.jobId = j.id;
  el.dataset.index = String(i);
  host.appendChild(el);
  wireLightbox(el, j);
  el.focus();
}
function wireLightbox(el, j) {
  const close = () => { if (el.isConnected) el.remove(); };
  const step = delta => openPhotoLightbox(j, null, (Number(el.dataset.index) || 0) + delta);
  el.querySelector(".px").onclick = ev => { ev.preventDefault(); ev.stopPropagation(); close(); };
  el.querySelector(".pp")?.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); step(-1); });
  el.querySelector(".pn")?.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); step(1); });
  let x0 = null;
  el.addEventListener("touchstart", ev => { x0 = ev.changedTouches && ev.changedTouches[0] ? ev.changedTouches[0].clientX : null; }, { passive: true });
  el.addEventListener("touchend", ev => {
    if (x0 == null || !ev.changedTouches || !ev.changedTouches[0]) return;
    const dx = ev.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) < 48) return;
    step(dx < 0 ? 1 : -1);
  }, { passive: true });
  el.addEventListener("keydown", ev => {
    if (ev.key === "ArrowRight") { ev.preventDefault(); step(1); }
    else if (ev.key === "ArrowLeft") { ev.preventDefault(); step(-1); }
    else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(); }
  });
  const dlg = el.closest("dialog");
  if (dlg) dlg.addEventListener("cancel", ev => { if (!el.isConnected) return; ev.preventDefault(); close(); });
}
async function downloadGalleryCopy(j) {
  const gallery = ui.photoLists[j.id]?.gallery;
  if (!gallery?.ok) return toast("Couldn't build the download.");
  const blobs = {};
  for (const p of gallery.photos) {
    const blob = await blobForPhoto(p.path);
    blobs[p.path] = new Uint8Array(await blob.arrayBuffer());
  }
  return downloadCloudCopy(j, galleryExportPhotos(gallery, blobs, j));
}
function mirrorReceipt(receiptId, b64, job, written) {
  const blob = b64ToBlob(b64, "image/jpeg");
  const plan = planStaffReceiptCapture({
    membership: cloudMembership(), job, receiptId, receiptDoc: written,
    file: { type: "image/jpeg", size: blob.size || 1, name: "original.jpg" },
  });
  if (!plan.ok) { console.warn("cloud receipt mirror skipped", plan.reason); return Promise.resolve(); }
  return uploadBytes(storageRef(storage, plan.storage.path), blob, {
    contentType: plan.storage.contentType, customMetadata: plan.storage.metadata,
  });
}
function cloudRetentionHtml(j) {
  if (!me || me.role !== "admin") return "";
  const view = retentionView(j, new Date());
  return `<p class="sub cloudret">${esc(retentionAdminText(view))} <button type="button" class="sm-btn" id="cloudexport">Download cloud copy</button></p>`;
}
function cloudExpiryNotice(all) {
  if (!me || me.role !== "admin") return "";
  const seen = new Set();
  const pool = [...(all || []), ...(ui.done || [])].filter(j => j && j.id && !seen.has(j.id) && seen.add(j.id));
  const now = new Date();
  let soon = 0, due = 0;
  for (const j of pool) {
    const view = retentionView(j, now);
    if (view.warning) soon += 1;
    else if (view.due && view.state !== "held" && view.state !== "purged") due += 1;
  }
  if (!soon && !due) return "";
  return `<p class="sub cloudret">Cloud copies: ${soon ? soon + " expiring within 14 days. " : ""}${due ? due + " past the 3-month operational window. " : ""}Deletion is not scheduled. Invoices, GST and Xero records are not part of that deletion. Accounting records are normally kept 5 years.</p>`;
}
async function downloadCloudCopy(j, photos) {
  const built = buildOperationalExport({ membership: cloudMembership(), scope: "job", jobId: j.id, jobs: [j], photos: photos || [], now: galleryNow() });
  if (!built.ok) return toast(built.reason === "not-authorised" ? "Only an admin can download the cloud copy." : "Couldn't build the download.");
  const blob = new Blob([built.zip], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = built.filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  toast("Downloaded operational copy. Invoices and Xero records are not in the zip.");
}
// ---- Receipts: worker photo + amount -> receipts/{id} + receiptChunks (base64 JPEG, kept until cutover).
// The box (tools/receipts_worker.py, cron every 2 min) emails it from Alex's account to his Hubdoc email-in address,
// records personally-paid ones in reimbursements/ (owner only) and notifies Alex. A Veolia supplier is on account:
// reimbursementFromReceipt returns null, and that row must not be written. Workers only see their own Queued/Filed.
const OWNER_UID = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
const isOwner = () => me && me.uid === OWNER_UID;
// Who sees anything Xero (profit chart, Send to Xero, Xero labels/wording). Explicit list, NOT the admin role, so future
// staff (even admins) see no Xero unless added here AND in firestore.rules xeroUser(). Alex, Patrick.
const XERO_UIDS = [OWNER_UID, "R7t41e54Ykcdk9WPdVZnDd697iI2"];
const canXero = () => !!me && XERO_UIDS.includes(me.uid) && myCompanyId() === "heartwood";
const canCompanyExport = () => exportAllowed({ role: me && me.role, companyId: myCompanyId() });
// Money ($ PO/invoice/receipt/profit amounts): admins + users/{uid}.role "supervisor". Operators (staff) see none in the UI.
// App roles on users/{uid}: "operator" (staff) | "supervisor" (sees money, still operator shell unless also Firebase-admin).
// ServiceM8 sync runs only for Heartwood (box sm8_import / sm8_push). Other CallUp companies never see ServiceM8 wording.
// Internal field names (sm8JobNo, sm8Status, sm8Uuid) are unchanged.
const usesSm8Sync = () => myCompanyId() === "heartwood";
const syncNote = (heartwoodText, otherText) => usesSm8Sync() ? heartwoodText : otherText;
const canSeeMoney = () => !!me && (me.role === "admin" || me.role === "manager" || me.role === "supervisor" || me.staffRole === "manager" || me.staffRole === "supervisor");
const canSeeCapacity = () => canSeeMoney();
// Job text shown to crew (operators). Descriptions imported from ServiceM8 or typed by the office can mention a price;
// crew never see dollar figures, so they get the same price filter the quote-to-job copy uses.
const crewText = t => canSeeMoney() ? String(t ?? "") : noDollars(t);
const canInvite = () => !!(me && (me.role === "admin" || me.role === "manager" || me.role === "supervisor" || me.staffRole === "manager" || me.staffRole === "supervisor"));
const canEditTitles = () => !!(me && (me.role === "admin" || me.role === "manager" || me.staffRole === "manager"));
// Inbox and import: admins and supervisors. Operators (staff) do not see the Inbox.
// Builder-email Inbox and Find PO (Orbit portal, Alex's mailbox, box workers) are Heartwood-only.
const canImport = () => canImportInbox(me) && myCompanyId() === "heartwood";
// Forwarded job email: same people who can open Inbox (admin, manager, supervisor). Crew cannot.
// Heartwood job writes stay with an admin. Other companies' office can approve.
const canForward = () => canImportInbox(me);
const canMintForward = () => !!(me && (me.role === "admin" || me.role === "manager" || me.staffRole === "manager" || (myCompanyId() === "heartwood" && (isOwner() || me.uid === "R7t41e54Ykcdk9WPdVZnDd697iI2"))));
const canEditForwardSupervisors = () => canForward() && (myCompanyId() === "heartwood" ? !!(me && me.role === "admin") : true);
const canApproveForward = () => canForward() && (myCompanyId() !== "heartwood" || !!(me && me.role === "admin"));
const canFindPo = () => myCompanyId() === "heartwood";
// Quotes: same people who see money (admins + users.role/staffRole supervisor). Ordinary staff: no Quotes nav or dollars.
const canQuote = () => canSeeMoney();
// Business quote rates: admin or manager. Supervisors can read and use rates while quoting, not change them.
// Company billing, plan and company settings stay admin-only (me.role === "admin").
const canEditQuoteRates = () => !!(me && (me.role === "admin" || me.role === "manager" || me.staffRole === "manager"));
async function shrinkImage(file, max = 1600, q = 0.72) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error("Can't read that image - try a JPEG/PNG photo");
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height)), c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", q).split(",")[1];
}

function receiptTonnesLabel(r) {
  const m = formatReceiptMeasure({ tonnes: r && r.tonnes }, () => "");
  return m ? ` <span class="sub">${esc(m)}</span>` : "";
}
function receiptAmountInput(r) {
  const id = (r && (r.receiptId || r.id)) || "";
  return `<form class="raddamt" data-rid="${esc(id)}"><input name="amt" type="number" step="0.01" min="0" inputmode="decimal" placeholder="$ amount" required><button class="sm-btn">Save amount</button></form>`;
}
async function saveReceiptAmount(r, value) {
  const measures = parseReceiptMeasures({ amount: value });
  if (!measures.ok || !measures.amountInc) { toast("Enter a dollar amount greater than 0."); return; }
  const id = (r && (r.receiptId || r.id)) || "";
  if (!id) return;
  await updateDoc(doc(db, "receipts", id), { amountInc: measures.amountInc });
  const hasLed = (ui.reimb || []).some(x => (x.receiptId || x.id) === id);
  if (hasLed) await updateDoc(doc(db, "reimbursements", id), { amountInc: measures.amountInc, needsAmount: false });
  toast("Amount saved");
}
function receiptDialog(j) {
  const jn = j ? String(jobNo(j) || "") : "";
  let d = $("#rdlg"); if (!d) { d = document.createElement("dialog"); d.id = "rdlg"; d.className = "rdlg"; document.body.appendChild(d); }
  d.innerHTML = `<form id="rf" method="dialog"><h3>🧾 Upload receipt${jn ? ` · Job #${esc(jn)}` : ""}</h3>${j ? `<div class="sub">${esc(j.address || "")}</div>` : ""}
    <label class="rphoto">Photo of the receipt<input name="photo" type="file" accept="image/*" capture="environment" required></label>
    <div class="row"><label>Amount $ (inc GST)<input name="amt" type="number" step="0.01" min="0" inputmode="decimal"></label>
      <label>Tonnes<input name="tonnes" type="number" step="0.001" min="0" inputmode="decimal"></label></div>
    <p class="sub">Enter a dollar amount or the tonnes (or both). Tip dockets can be uploaded with just the weight.</p>
    <label>Job # (optional)<input name="job" inputmode="numeric" placeholder="e.g. 697" value="${esc(jn)}" ${j ? "readonly" : ""}></label>
    <label>Supplier / what it was for<input name="sup" required placeholder="e.g. Bunnings - silt fence" ${inputAttrs("supplier")}></label>
    <label class="ck" id="rpaidbox"><input type="checkbox" name="mine" checked> I paid for this myself (reimburse me)</label>
    <p class="sub" id="rveolianote" hidden>${VEOLIA_PAID_NOTE}</p>
    <p class="sub" id="rpaidhint">Uncheck if this went on the company account (for example a Remondis tip docket).</p>
    <p id="rerr" class="err"></p>
    <div class="btns"><button value="cancel" formnovalidate class="sm-btn">Close</button><button value="send" class="sm-btn primary" id="rsend">Upload</button></div>
    <h4>My recent receipts</h4><div id="rmine" class="sub">Loading…</div></form>`;
  refreshAutofillLists();
  d.showModal();
  const f = $("#rf"), mine = $("#rmine");
  const syncPaid = () => {
    const label = f.querySelector("#rpaidbox");
    const note = f.querySelector("#rveolianote");
    const hint = f.querySelector("#rpaidhint");
    const next = nextPaidPersonallyControl({ supplier: f.sup.value, checkboxVisible: !label.hidden, checked: f.mine.checked });
    label.hidden = !next.checkboxVisible;
    f.mine.checked = next.checked;
    note.hidden = !next.note;
    if (hint) hint.hidden = !!next.note;
  };
  f.sup.addEventListener("input", syncPaid);
  f.sup.addEventListener("change", syncPaid);
  const supValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  if (supValue && supValue.set) {
    try {
      Object.defineProperty(f.sup, "value", {
        configurable: true, enumerable: supValue.enumerable,
        get() { return supValue.get.call(this); },
        set(v) { supValue.set.call(this, v); syncPaid(); },
      });
    } catch { /* typed and picked values still come through input and change */ }
  }
  syncPaid();
  getDocs(query(collection(db, "receipts"), where("uid", "==", me.uid))).then(sn => {
    const all = sn.docs.map(x => ({ id: x.id, ...x.data() })).filter(r => docCompanyId(r) === myCompanyId());
    ui.ownReceipts = all;
    refreshAutofillLists();
    const L = all.sort((a, b) => String(b.createdAtIso || "").localeCompare(String(a.createdAtIso || ""))).slice(0, 8);
    mine.innerHTML = L.map(r => `<div class="rrow"><span>${esc(String(r.createdAtIso || "").slice(0, 10))} · ${esc(r.supplier || "")}${(() => { const m = formatReceiptMeasure(r, $$); const need = isOwner() && receiptNeedsAmount(r) ? " · needs $" : ""; return (m ? " · " + esc(m) : "") + need; })()}</span>
      <span class="qpill ${r.status === "filed" ? "q-comp" : ""}">${r.status === "filed" ? "Filed" : "Queued"}</span></div>`).join("") || "None yet.";
  }).catch(e => { mine.textContent = "Receipts not available yet (" + (e.code || e.message) + ")"; });
  f.onsubmit = async ev => {
    if (ev.submitter?.value !== "send") return; ev.preventDefault();
    const file = f.photo.files[0];
    const checked = validateReceiptUpload({ hasPhoto: !!file, supplier: f.sup.value, amount: f.amt.value, tonnes: f.tonnes.value });
    if (!checked.ok) { $("#rerr").textContent = checked.reason; return; }
    $("#rsend").disabled = true; $("#rsend").textContent = "Uploading…";
    try {
      const b64 = await shrinkImage(file);
      const blob = b64ToBlob(b64, "image/jpeg");
      const ref = doc(collection(db, "receipts"));
      const supplier = f.sup.value.trim();
      const paidPersonally = receiptPaidPersonally(supplier, f.mine.checked);
      const measures = receiptMeasureFields(checked.measures);
      const extra = {
        measures, supplier, paidPersonally, workerName: me.name, companyId: myCompanyId(),
        jobNo: f.job.value.trim().replace(/^#/, "") || null, jobId: j ? j.id : null, address: j ? (j.address || null) : null,
        createdAtIso: new Date().toISOString(), firestoreWritten: false,
      };
      const tenant = (cloudMembership().ok && cloudMembership().tenantId) || myCompanyId();
      const path = `tenants/${tenant}/receipts/${ref.id}/original`;
      const metadata = { tenantId: tenant, receiptId: ref.id, uploaderUid: me.uid, purpose: "receipt" };
      const holdReceipt = async () => {
        const ok = await enqueueUpload({
          id: ref.id, kind: "receipt", uid: me.uid, companyId: myCompanyId(), path, contentType: "image/jpeg",
          metadata, label: supplier || "Receipt", file: blob, extra,
        });
        if (!ok) throw new Error("queue");
        rememberQueuedThumb(j ? j.id : "receipts", blob);
        d.close();
        toast(SAVED_ON_PHONE);
      };
      if (!deviceOnline()) { await holdReceipt(); return; }
      const task = (async () => {
        const CH = 700000, n = Math.ceil(b64.length / CH);
        // Other companies' receipts carry their companyId, so the Heartwood Hubdoc worker never files them.
        const rco = myCompanyId() === "heartwood" ? {} : { companyId: myCompanyId(), tenantId: myCompanyId() };
        for (let i = 0; i < n; i++) await setDoc(doc(db, "receiptChunks", `${ref.id}_${i}`), { rid: ref.id, i, uid: me.uid, data: b64.slice(i * CH, (i + 1) * CH), ...rco });
        const written = { id: ref.id, uid: me.uid, jobId: extra.jobId, status: "queued" };
        await setDoc(ref, { uid: me.uid, workerName: me.name, ...measures, supplier, paidPersonally,
          jobNo: extra.jobNo, jobId: written.jobId, address: extra.address, chunks: n, mime: "image/jpeg", bytes: Math.round(b64.length * 0.75),
          status: "queued", createdAt: serverTimestamp(), createdAtIso: extra.createdAtIso, ...rco });
        return written;
      })();
      const result = await settleOrQueue(task);
      rememberEntries({ supplier });
      if (result.queued) { d.close(); toast(SAVED_ON_PHONE); return; }
      d.close(); toast(myCompanyId() === "heartwood" ? "Receipt uploaded - queued for Hubdoc" : "Receipt uploaded"); if (j) loadJobReceipts(j);
      mirrorReceipt(ref.id, b64, j || null, result.value).catch(e => console.warn("cloud receipt mirror", e && (e.code || e.message) || e));
    } catch (e) {
      if (classifyUploadError(e) === "retry") {
        try {
          const b64 = await shrinkImage(file);
          const blob = b64ToBlob(b64, "image/jpeg");
          const ref = doc(collection(db, "receipts"));
          const supplier = f.sup.value.trim();
          const tenant = (cloudMembership().ok && cloudMembership().tenantId) || myCompanyId();
          await enqueueUpload({
            id: ref.id, kind: "receipt", uid: me.uid, companyId: myCompanyId(),
            path: `tenants/${tenant}/receipts/${ref.id}/original`, contentType: "image/jpeg",
            metadata: { tenantId: tenant, receiptId: ref.id, uploaderUid: me.uid, purpose: "receipt" },
            label: supplier || "Receipt", file: blob,
            extra: { measures: receiptMeasureFields(checked.measures), supplier, paidPersonally: receiptPaidPersonally(supplier, f.mine.checked), workerName: me.name, companyId: myCompanyId(), jobNo: f.job.value.trim().replace(/^#/, "") || null, jobId: j ? j.id : null, address: j ? (j.address || null) : null, createdAtIso: new Date().toISOString(), firestoreWritten: false },
          });
          rememberQueuedThumb(j ? j.id : "receipts", blob);
          d.close(); toast(SAVED_ON_PHONE); return;
        } catch { /* show the error below */ }
      }
      $("#rerr").textContent = "Not uploaded: " + (e.code || e.message); $("#rsend").disabled = false; $("#rsend").textContent = "Upload";
    }
  };
}
// Job card: Upload receipt + that job's receipts. Workers see their own; Alex sees all (rules enforce the same).
const jobReceiptsHtml = j => `<h4>Receipts</h4><button type="button" class="sm-btn" id="jrcbtn">🧾 Upload receipt</button><div id="jrc" class="jrc sub">Loading…</div>`;
async function loadJobReceipts(j) {
  const box = $("#jrc"); if (!box) return;
  try {
    const qs = isOwner() ? query(collection(db, "receipts"), where("jobId", "==", j.id)) : query(collection(db, "receipts"), where("jobId", "==", j.id), where("uid", "==", me.uid));
    const L = (await getDocs(qs)).docs.map(x => ({ id: x.id, ...x.data() })).filter(r => docCompanyId(r) === myCompanyId()).sort((a, b) => String(b.createdAtIso || "").localeCompare(String(a.createdAtIso || "")));
    ui.jobReceiptRows = L;
    refreshAutofillLists();
    if ($("#jrc") !== box) return;
    box.innerHTML = L.map(r => `<div class="rrow"><span>🧾 ${esc(String(r.createdAtIso || "").slice(0, 10))}${(() => { const m = formatReceiptMeasure(r, $$); const need = isOwner() && receiptNeedsAmount(r) ? "needs $" : ""; const shown = [m, need].filter(Boolean).join(" · "); return shown ? ` · <b>${esc(shown)}</b>` : ""; })()} · ${esc(r.supplier || "")}${isOwner() ? ` · ${esc(r.workerName || "")}${r.paidPersonally ? (receiptNeedsAmount(r) ? " (to reimburse · needs $)" : " (to reimburse)") : ""}` : ""}</span>
      <span class="qpill ${r.status === "filed" ? "q-comp" : ""}">${r.status === "filed" ? "Filed" : "Queued"}</span></div>`).join("") || "No receipts on this job yet.";
  } catch (e) { box.textContent = "Receipts not available yet (" + (e.code || e.message) + ")"; }
}
function wireJobReceipts(j) { const b = $("#jrcbtn"); if (!b) return; b.onclick = () => receiptDialog(j); loadJobReceipts(j); }
function reimbView() {
  if (!isOwner()) return `<div class="sm-head"><h1>Reimbursements</h1></div><p class="muted pad">Owner only.</p>`;
  reimbSubs();
  const L = ui.reimb || [], open = owedList(), by = {};
  for (const r of open) (by[r.workerName || "?"] ||= []).push(r);
  const hd = ui.hubdocCfg?.email || "";
  return `<div class="sm-head"><h1>Reimbursements</h1><span class="sub">Owed to workers for receipts they paid personally (owner only)</span></div>
    <div class="filters"><label>Hubdoc email-in address <input id="hdmail" value="${esc(hd)}" placeholder="yourname.xxxx@app.hubdoc.com" size="34"></label>
      <button id="hdsave" class="sm-btn">Save</button><span class="sub">${hd ? "Receipts are emailed here from the company mailbox." : "<b>Not set</b> - receipts stay queued until it is."}</span></div>
    ${Object.keys(by).length ? Object.entries(by).map(([w, rs]) => `<h3>${esc(w)} · owed <b>${$$(receiptOwedTotal(rs))}</b> inc GST (${rs.filter(receiptHasMoney).length}${rs.some(receiptNeedsAmount) ? ` · ${rs.filter(receiptNeedsAmount).length} need $` : ""})</h3>
      <table class="jt"><thead><tr><th>Date</th><th>Supplier / for</th><th>Job</th><th>Amount</th><th>Hubdoc</th><th></th></tr></thead><tbody>${rs.map(r => `<tr data-rb="${esc(r.id)}">
        <td>${esc(String(r.date || "").slice(0, 10))}</td><td>${esc(r.supplier || "")}${receiptTonnesLabel(r)}</td><td>${r.jobNo ? "#" + esc(r.jobNo) : ""}</td><td>${receiptNeedsAmount(r) ? receiptAmountInput(r) : $$(r.amountInc)}</td>
        <td><span class="qpill ${r.hubdocStatus === "filed" ? "q-comp" : ""}">${r.hubdocStatus === "filed" ? "Filed" : "Queued"}</span></td>
        <td>${receiptNeedsAmount(r) ? `<span class="sub">Needs $ before payback</span>` : `<button class="sm-btn rbpaid">Mark paid</button>`}</td></tr>`).join("")}</tbody></table>`).join("") : `<p class="muted pad">Nothing owed.</p>`}
    <p class="sub">Paid: ${L.filter(r => r.paid).length} entr${L.filter(r => r.paid).length === 1 ? "y" : "ies"} (${$$(receiptOwedTotal(L.filter(r => r.paid)))}).</p>`;
}
function bindReimb(A) {
  if (!isOwner()) return;
  reimbSubs();
  if (!ui.reimbSub) {
    ui.reimbSub = onSnapshot(collection(db, "reimbursements"), s => { ui.reimb = s.docs.map(x => ({ id: x.id, ...x.data() })); if (ui.view === "reimb") renderAdmin(); },
      e => toast("Reimbursements not available: " + (e.code || e.message)));
    getDoc(doc(db, "ownerSettings", "hubdoc")).then(x => { ui.hubdocCfg = x.data() || {}; if (ui.view === "reimb") renderAdmin(); }).catch(() => {});
  }
  if ($("#hdsave")) $("#hdsave").onclick = async () => { const v = $("#hdmail").value.trim().toLowerCase();
    if (v && !/^[a-z0-9._+-]+@app\.hubdoc\.com$/.test(v)) return toast("Hubdoc addresses end in @app.hubdoc.com");
    try { await setDoc(doc(db, "ownerSettings", "hubdoc"), { email: v || null, updatedAt: serverTimestamp() }); ui.hubdocCfg = { email: v }; toast("Saved"); renderAdmin(); }
    catch (e) { toast("Not saved: " + (e.code || e.message)); } };
  A.querySelectorAll(".raddamt").forEach(f => f.onsubmit = ev => { ev.preventDefault();
    const r = (ui.reimb || []).concat(ui.rqueued || []).find(x => (x.receiptId || x.id) === f.dataset.rid);
    saveReceiptAmount(r || { id: f.dataset.rid, paidPersonally: true }, f.amt.value).catch(e => toast("Not saved: " + (e.code || e.message))); });
  A.querySelectorAll(".rbpaid").forEach(b => b.onclick = async () => { const id = b.closest("[data-rb]").dataset.rb;
    const r = (owedList() || []).find(x => x.id === id) || (ui.reimb || []).find(x => x.id === id);
    if (receiptNeedsAmount(r)) return toast("Add the dollar amount before marking this paid back.");
    if (!armBtn(b, "Mark paid", "Tap again: paid")) return;
    try { await markReimbursed(r); toast("Marked paid"); }
    catch (e) { toast("Not saved: " + (e.code || e.message)); } });
}
function donePill() {
  let el = $("#donepill");
  const show = me && me.role === "admin" && !ui.myJobs && (ui.view === "dispatch" || ui.view === "jobs");
  let fw = $("#fabwrap");
  if (!show) { if (fw) fw.remove(); return; }
  if (!fw) { fw = document.createElement("div"); fw.id = "fabwrap"; fw.className = "fabwrap";
    document.body.appendChild(fw); }
  if (!el) { el = document.createElement("div"); el.id = "donepill"; fw.appendChild(el); }
  const L = doneToday(), open = localStorage.getItem("hwDonePill") === "open";
  const amt = j => j.invoiceAmount ?? j.poAmount ?? null, known = L.filter(j => amt(j) != null);
  const tot = known.reduce((t, j) => t + +amt(j), 0);
  const who = j => j.completedByName || (namesOf(j).join(", ") || "—");
  el.className = "donepill" + (open ? " open" : "");
  el.innerHTML = `<button type="button" class="dp-head" aria-expanded="${open}"><span class="dp-tick">✓</span> <b>${L.length}</b> done today${canSeeMoney() && known.length ? ` · ${$$(tot)}` : ""}<span class="dp-car">${open ? "▾" : "▴"}</span></button>
    ${open ? `<div class="dp-body">${L.map(j => `<button type="button" class="dp-row" data-dp="${esc(j.id)}"><span class="dp-no">#${esc(jobNo(j))}</span>
      <span class="dp-main"><b>${esc(tidyAddress(j.address || "").split(",")[0])}</b> · ${esc(jobTypeText(j) || TYPES[j.type] || firstLine(j.description || ""))}<small>${esc(who(j))}</small></span>
      <span class="dp-amt">${canSeeMoney() && amt(j) != null ? $$(amt(j)) : ""}</span></button>`).join("") || `<p class="sub pad">Nothing completed yet today.</p>`}
      ${canSeeMoney() ? `<div class="dp-foot sub">Total ex GST ${$$(tot)}${known.length < L.length ? ` (${L.length - known.length} without a PO/invoice amount)` : ""}</div>` : ""}</div>` : ""}`;
  el.querySelector(".dp-head").onclick = () => { localStorage.setItem("hwDonePill", open ? "closed" : "open"); donePill(); };
  el.querySelectorAll("[data-dp]").forEach(b => b.onclick = () => { const j = L.find(x => x.id === b.dataset.dp); if (j) editJob(j); });
}
// ---- Timesheets: timesheets/{uid}_{weekStart}. The week document is unchanged for accounts.
// Clock on / clock off adds one entry per shift, with a server timestamp and one GPS fix at that tap.
// While that shift is open, the latest position is shared with managers. Clock off deletes it. No trail is kept.
// Manual shifts are labelled Manual and keep an edit trail. Alex still emails accounts; he alone marks Sent.
const ACCOUNTS_EMAIL = "accounts@heartwoodew.com";
const TS_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TS_CONSENT_KEY = "hwTsLocConsent";
const weekStartOf = s => { const d = new Date(s + "T00:00:00Z"); return addDays(s, -((d.getUTCDay() + 6) % 7)); };
const dmy = s => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "";
const tsDow = ds => TS_DAYS[(new Date(ds + "T00:00:00Z").getUTCDay() + 6) % 7];
function tsHours(d) { return shiftHours(d); }
const tsTotal = days => Math.round(Object.values(days || {}).reduce((t, d) => t + shiftHours(d), 0) * 100) / 100;
const hrs = h => (Math.round((+h || 0) * 100) / 100).toFixed(2).replace(/\.?0+$/, "") + " h";
function tsWeek() { ui.tsWs = ui.tsWs || weekStartOf(todayStr()); return ui.tsWs; }
// Other companies' timesheets carry companyId so their admins can read them and Heartwood never does.
function tsCompanyField() { return { companyId: myCompanyId() }; }
// Heartwood admins can list every login; anyone belonging to another company is kept out of Heartwood lists.
let FOREIGN_UIDS = new Set();
// Heartwood sheets saved by an older app version have no companyId, so the scoped list misses them. Fetch those
// by id (uid_week) for Heartwood's own staff; the rules allow reading a sheet with no companyId as Heartwood.
let HOME_UIDS = [];
function tsFetchUnscoped(ws) {
  const have = new Set((ui.tsAll || []).map(t => t.id));
  const miss = HOME_UIDS.filter(u => !have.has(`${u}_${ws}`));
  if (!miss.length) return;
  Promise.all(miss.map(u => getDoc(doc(db, "timesheets", `${u}_${ws}`)).catch(() => null))).then(rs => {
    if (ui.tsSubWs !== ws || ui.tsAllWs !== ws) return;
    const ids = new Set((ui.tsAll || []).map(t => t.id));
    const add = rs.filter(r => r && r.exists() && !ids.has(r.id)).map(r => ({ id: r.id, ...r.data() })).filter(t => docCompanyId(t) === "heartwood");
    if (!add.length) return;
    ui.tsAll = [...ui.tsAll, ...add];
    if (tsIsAdminSheet() && !tsSnapshotBlocked()) ui.tsPaint?.();
  });
}
function tsIsAdminSheet() { return !!(me && me.role === "admin" && !ui.myJobs && ui.view === "timesheet"); }
function tsStop() {
  ui.hxSub?.(); ui.hxSub = null;
  ui.tsSub?.(); ui.tsSub = null; ui.tsSubWs = null; ui.tsAll = null; ui.tsAllWs = null;
  ui.tsWatch?.(); ui.tsWatch = null; ui.tsWatchId = null; ui.tsMine = undefined;
  ui.tsPrev = null; ui.tsPrevFor = "";
  ui.tsEdit = null; ui.tsDirty = false; ui.tsBusy = false; ui.tsAsk = null;
}
function tsSnapshotBlocked() {
  if (ui.tsBusy || ui.tsAsk || (ui.tsMachineShift && document.getElementById("tsmachine"))) return true;
  if ($("#dlg")?.open) return true;
  return !!((ui.tsDirty || ui.tsEdit) && ($("#tsman") || $("#tsf")));
}
function tsRerender() {
  ui.tsForce = true;
  try { if (ui.tsPaint) ui.tsPaint(); }
  finally { ui.tsForce = false; }
}
function tsWorkerReady() { return ui.tsWatchId === `${me.uid}_${tsWeek()}` && ui.tsMine !== undefined; }
function tsHasConsent(sheet) {
  let stored = false;
  try { stored = localStorage.getItem(TS_CONSENT_KEY) === "1"; } catch { /* private mode */ }
  const already = !!(sheet && sheet.locationConsentAt) || !!(ui.tsMine && ui.tsMine.locationConsentAt) || !!(ui.tsPrev && ui.tsPrev.locationConsentAt);
  return !needsLocationConsent({ stored, already });
}
function tsOwnSheet() {
  if (tsIsAdminSheet()) return (ui.tsAll || []).find(t => t.uid === me.uid) || null;
  return ui.tsMine || null;
}
function tsSheets() {
  const ws = tsWeek();
  const own = tsOwnSheet();
  const here = openClock(own?.entries);
  if (here) return { ws, sheet: own, entry: here, where: "view" };
  if (ws === weekStartOf(todayStr())) {
    const prev = openClock(ui.tsPrev?.entries);
    if (prev) return { ws: ui.tsPrev.weekStart, sheet: ui.tsPrev, entry: prev, where: "prev" };
  }
  return { ws, sheet: own, entry: null, where: "view" };
}
function tsNav() {
  const ws = tsWeek(), cur = ws === weekStartOf(todayStr());
  return `<div class="ts-nav"><button type="button" class="sm-btn" data-tsw="-7">‹</button><b>Mon ${dmy(ws)} – Sun ${dmy(addDays(ws, 6))}</b><button type="button" class="sm-btn" data-tsw="7">›</button>${cur ? "" : `<button type="button" class="sm-btn" data-tsw="0">This week</button>`}</div>`;
}
function tsWeekTotal(sheet) {
  return `<div class="ts-tot">Week total <b>${hrs(sheet ? sheetHours(sheet) : 0)}</b></div><p class="ts-privacy">A 30-minute lunch comes off each finished shift unless a break is entered.</p>`;
}
function tsFixLine(label, fix) {
  if (!fix) return "";
  const when = stampText(fix.at);
  const head = `${label}${when ? " " + when : ""}`;
  if (fix.fix === "no location") return `<p class="ts-loc">${esc(head)}: <b>no location</b></p>`;
  if (fix.fix !== "gps" || typeof fix.lat !== "number") return when ? `<p class="ts-stamp">${esc(head)}</p>` : "";
  const acc = accuracyText(fix);
  return `<p class="ts-loc">${esc(head)}: <a href="${esc(mapsHref(fix.lat, fix.lng))}" target="_blank" rel="noopener">Map</a> <span class="sub">${esc(coordText(fix))}${acc ? " · " + esc(acc) : ""}</span></p>`;
}
function tsAdjustedLine(raw, field, fix) {
  if (!editList(raw).length || !fix) return "";
  const hm = brisbaneHM(fix.at), cur = raw[field] || "";
  if (!hm || !cur || hm === cur) return "";
  return `<p class="ts-stamp">Adjusted to ${esc(ampm(cur))}. Original stamp ${esc(stampText(fix.at))} stays.</p>`;
}
function tsEntryCard(raw, canEdit) {
  const e = paidShift(raw) || raw;
  const badge = raw.source === "manual" ? `<span class="ts-badge manual">Manual</span>` : `<span class="ts-badge clock">Clocked</span>`;
  const day = e.date ? `${tsDow(e.date)} ${dmy(e.date).slice(0, 5)}` : "";
  const hours = shiftHours(e);
  const open = raw.source === "clock" && raw.status !== "closed";
  const span = `${e.start ? ampm(e.start) : "—"}${e.finish ? " – " + ampm(e.finish) : open ? " · still on" : ""}`;
  const br = e.breakStart && e.breakEnd ? `<p class="sub">Break ${esc(ampm(e.breakStart))} – ${esc(ampm(e.breakEnd))}</p>` : raw.status === "break" ? `<p class="sub">On break${e.breakStart ? " from " + esc(ampm(e.breakStart)) : ""}</p>` : "";
  const job = [e.job, e.note].filter(Boolean).join(" — ");
  const audit = raw.source === "manual" ? `<p class="sub">Entered by ${esc(raw.enteredByName || "")}${raw.enteredAt ? " · " + esc(stampText(raw.enteredAt)) : ""}</p>` : "";
  const edits = editList(raw).map(ed => `<p class="sub">Edited by ${esc(ed.byName || "")}${ed.at ? " · " + esc(stampText(ed.at)) : ""}${ed.summary ? " · " + esc(ed.summary) : ""}</p>`).join("");
  return `<article class="ts-entry">${badge}<div class="ts-dl"><b>${esc(day)}</b><span class="ts-h">${hours ? hrs(hours) : open ? "On" : ""}</span></div>
    <p class="ts-when">${esc(span)}</p>${br}${job ? `<p class="sub">${esc(job)}</p>` : ""}
    ${tsFixLine("Clocked on", raw.clockOn)}${tsAdjustedLine(raw, "start", raw.clockOn)}
    ${tsFixLine("Clocked off", raw.clockOff)}${tsAdjustedLine(raw, "finish", raw.clockOff)}
    ${tsFixLine("Break start", raw.breakOn)}${tsFixLine("Break end", raw.breakOff)}
    ${audit}${edits}
    ${tsMachineStatusHtml(raw)}
    ${canEdit ? `<button type="button" class="sm-btn tsedit" data-eid="${esc(raw.id)}">Edit</button>` : ""}</article>`;
}
function tsLegacyCards(sheet, canEdit) {
  if (!sheet) return "";
  const taken = new Set(entryList(sheet.entries).map(e => e.date));
  return TS_DAYS.map((n, i) => {
    const ds = addDays(sheet.weekStart || tsWeek(), i);
    if (taken.has(ds)) return "";
    const d = (sheet.days || {})[ds];
    if (!d || (!d.start && !d.finish && !d.note)) return "";
    const h = shiftHours(d);
    return `<article class="ts-entry"><span class="ts-badge week">Week hours</span><div class="ts-dl"><b>${n} ${dmy(ds).slice(0, 5)}</b><span class="ts-h">${h ? hrs(h) : ""}</span></div>
      <p class="ts-when">${esc(d.start ? ampm(d.start) : "—")}${d.finish ? " – " + esc(ampm(d.finish)) : ""}</p>
      ${d.note ? `<p class="sub">${esc(d.note)}</p>` : ""}
      ${canEdit ? `<button type="button" class="sm-btn tslegacy" data-legacy="${ds}">Edit as manual</button>` : ""}</article>`;
  }).join("");
}
function tsCards(sheet, canEdit) {
  const entries = sortedEntries(sheet?.entries).map(raw => tsEntryCard(raw, canEdit)).join("");
  const legacy = tsLegacyCards(sheet, canEdit);
  if (!entries && !legacy) return `<p class="sub">No shifts this week yet.</p>`;
  return entries + legacy;
}
function tsClockHtml() {
  if (tsIsAdminSheet()) { if (!(ui.tsAll && ui.tsAllWs === tsWeek())) return ""; }
  else if (!tsWorkerReady()) return "";
  if (ui.tsAsk) {
    const label = { on: "Agree and clock on", off: "Agree and clock off", "break-start": "Agree and start break", "break-end": "Agree and end break" }[ui.tsAsk] || "Agree and continue";
    return `<div class="ts-consent" role="dialog" aria-label="Location at clock on and clock off"><p>${esc(locationConsent(orgSettings().name))}</p>
      <p>${esc(LIVE_SHARE_TEXT)} If you say no to the browser, you still clock on and the map shows location off.</p>
      <button type="button" class="ts-go on" id="tsagree">${label}</button>
      <button type="button" class="sm-btn" id="tsno">Not now</button></div>`;
  }
  const active = tsSheets();
  const cur = tsWeek() === weekStartOf(todayStr());
  if (!active.entry && !cur) return `<p class="ts-privacy">Clock on and clock off stay on the current week. <button type="button" class="sm-btn" data-tsw="0">This week</button></p>`;
  const e = active.entry ? paidShift(active.entry) : null;
  const where = active.where === "prev" ? " from last week" : "";
  const main = ui.tsBusy ? `<button type="button" class="ts-go" disabled>Checking location…</button>`
    : active.entry ? `<p class="ts-live">${active.entry.status === "break" ? "On break" : "Clocked on"}${where}${e.start ? " · " + esc(ampm(e.start)) : ""}</p>
        <button type="button" class="ts-go off" id="tsclockoff">Clock off</button>
        <div class="ts-break">${active.entry.status === "break" ? `<button type="button" class="ts-mini" id="tsbrkend">Break end</button>` : `<button type="button" class="ts-mini" id="tsbrk">Break start</button>`}</div>`
      : `<p class="ts-live">Not clocked on</p><button type="button" class="ts-go on" id="tsclockon">Clock on</button>`;
  return `<div class="ts-clock">${main}${shareLine()}<p class="ts-privacy">${esc(LIVE_SHARE_TEXT)} It updates about once a minute while CallUp is open. Clocking off stops it. A browser can't keep sharing after the phone locks.</p><p class="ts-privacy">One location is also saved on the timesheet when you tap Clock on, Clock off, Break start, or Break end.</p></div>`;
}
function tsTenant() {
  const m = cloudMembership();
  return m && m.ok && m.tenantId ? m.tenantId : "heartwood";
}
function tsShiftById(id) {
  if (!id) return null;
  const sheets = [tsOwnSheet(), ui.tsPrev];
  for (const sheet of sheets) {
    if (sheet && sheet.entries && sheet.entries[id]) return sheet.entries[id];
  }
  return null;
}
function tsEnsureFleet() {
  if (ui.tsFleetState) return;
  ui.tsFleetState = "loading";
  getDocs(collection(db, "tenants", tsTenant(), "fleet")).then(s => {
    ui.tsFleet = s.docs.map(d => ({ id: d.id, ...d.data() })).filter(a => a && a.name).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    ui.tsFleetState = "ok";
    if (ui.tsMachineShift) tsRerender();
  }).catch(() => { ui.tsFleet = []; ui.tsFleetState = "absent"; if (ui.tsMachineShift) tsRerender(); });
}
function tsEnsurePrestarts() {
  if (ui.tsPrestartState) return;
  ui.tsPrestartState = "loading";
  getDocs(collection(db, "tenants", tsTenant(), "prestarts")).then(s => {
    ui.tsPrestarts = s.docs.map(d => ({ id: d.id, ...d.data() }));
    ui.tsPrestartState = "ok";
    tsRerender();
  }).catch(() => { ui.tsPrestarts = []; ui.tsPrestartState = "absent"; tsRerender(); });
}
function tsMachineHtml() {
  if (!ui.tsMachineShift) {
    const open = tsSheets();
    if (open.entry && machineShiftToResume(open.entry)) { ui.tsMachineShift = open.entry.id; ui.tsMachineWs = open.ws; }
  }
  const entry = tsShiftById(ui.tsMachineShift);
  if (!ui.tsMachineShift || (entry && entry.machineChoice)) return "";
  if (entry && !machinePromptNeeded(entry, ui.tsMachineShift)) return "";
  tsEnsureFleet();
  const assets = ui.tsFleetState === "ok" ? (ui.tsFleet || []) : [];
  const buttons = assets.map(a => `<button type="button" class="ts-mini tsmach" data-asset="${esc(a.id)}" data-name="${esc(a.name)}">${esc(a.name)}${a.rego ? " · " + esc(a.rego) : ""}</button>`).join("");
  return `<div class="ts-machine" id="tsmachine"><p><b>Which machine are you on today?</b></p>
    ${ui.tsFleetState === "loading" ? `<p class="sub">Loading machines…</p>` : ""}
    <div class="ts-fleet">${buttons}<button type="button" class="ts-mini tsmach" data-asset="">No machine / other work</button>
    <button type="button" class="sm-btn" id="tsmachskip">Skip</button></div></div>`;
}
function tsMachineStatusHtml(entry) {
  if (!entry || !entry.machineChoice || entry.id === ui.tsMachineShift) return "";
  const label = entry.machineChoice === "asset" ? entry.machineName : entry.machineChoice === "none" ? "No machine / other work" : "Skipped";
  const line = `<p class="sub">Machine: ${esc(label || "Skipped")}</p>`;
  if (entry.machineChoice !== "asset" || !entry.machineId) return line;
  if (ui.tsPrestartState !== "ok" && ui.tsPrestartState !== "absent") { tsEnsurePrestarts(); return line; }
  const status = prestartStatus({ available: ui.tsPrestartState === "ok", records: ui.tsPrestarts, assetId: entry.machineId, day: entry.date || todayStr() });
  if (status.kind === "soon") return line + `<p class="ts-soon">Prestart coming soon</p>`;
  if (status.kind === "done") {
    const when = stampText(status.when) || "today";
    return line + `<p class="ts-prestart">Prestart done (${esc(when)}, ${esc(status.by || "someone")})</p>`;
  }
  return line + `<p class="ts-prestart">Prestart isn't done for this machine today.</p><button type="button" class="sm-btn tsprestart" data-asset="${esc(entry.machineId)}">Open prestart</button>`;
}
function stopPrestartNotices() {
  if (ui.prestartNoticeUnsub) {
    try { ui.prestartNoticeUnsub(); } catch { /* already stopped */ }
  }
  ui.prestartNoticeUnsub = null;
  ui.prestartNotices = [];
}
function noticeMs(row) {
  const value = row && row.createdAt;
  if (!value) return 0;
  if (typeof value.toDate === "function") {
    try { return value.toDate().getTime() || 0; } catch { return 0; }
  }
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return 0;
}
function watchPrestartNotices() {
  stopPrestartNotices();
  if (!me || !COMP.canPrestart || !COMP.canPrestart()) return;
  const companyId = myCompanyId();
  const startedAt = Date.now();
  ui.prestartToasted = {};
  ui.prestartNoticeUnsub = onSnapshot(query(collection(db, "users", me.uid, "prestartNotices"), where("companyId", "==", companyId)), snap => {
    const next = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const pushOn = PUSH.model && PUSH.model().enabled;
    if (!pushOn) {
      for (const row of next) {
        if (!row.body || ui.prestartToasted[row.id]) continue;
        if (noticeMs(row) < startedAt - 15000) continue;
        ui.prestartToasted[row.id] = true;
        toast(row.body);
      }
    }
    ui.prestartNotices = next;
    if (me.role === "admin" && !ui.myJobs) return;
    if (!ui.opSel && (ui.opTab || "today") === "today") renderOperator();
  }, () => { ui.prestartNotices = []; });
}
function tsOpenPrestart(assetId) {
  ui.prestartAsset = assetId || "";
  if (COMP.focusPrestart) COMP.focusPrestart(assetId || "", ui.prestartKind || "");
  const admin = me.role === "admin" && !ui.myJobs;
  if (admin) { ui.view = "prestart"; ui.navOpen = false; renderAdmin(); }
  else { ui.opTab = "prestart"; renderOperator(); }
  const select = document.querySelector("#prestartform [name=assetId]");
  if (select && assetId) { select.value = assetId; select.dispatchEvent(new Event("change")); return; }
  if (select || document.querySelector("#prestartform")) return;
  if (!document.querySelector("#prestartform, [data-ctab=prestart]")) {
    ui.tsPrestartState = "absent";
    if (admin) { ui.view = "timesheet"; renderAdmin(); }
    else { ui.opTab = "hours"; renderOperator(); }
  }
}
async function tsChooseMachine(choice, asset) {
  const patch = machineChoicePatch(choice, asset);
  const id = ui.tsMachineShift;
  const ws = ui.tsMachineWs || tsWeek();
  if (!patch || !id) return;
  try {
    const sheet = await tsLoad(ws);
    const prev = sheet && sheet.entries && sheet.entries[id];
    if (!prev) { toast("You're clocked on. The machine list didn't save."); return; }
    if (prev.machineChoice) { ui.tsMachineShift = null; tsRerender(); return; }
    await updateDoc(doc(db, "timesheets", `${me.uid}_${ws}`), {
      [`entries.${id}.machineChoice`]: patch.machineChoice,
      [`entries.${id}.machineId`]: patch.machineId,
      [`entries.${id}.machineName`]: patch.machineName,
      lastEntryId: id,
      updatedAt: serverTimestamp(),
      updatedAtIso: new Date().toISOString(),
    });
    ui.tsMachineShift = null;
    if (patch.machineChoice === "asset") tsEnsurePrestarts();
  } catch (err) {
    toast("You're clocked on. The machine wasn't saved.");
  }
  tsRerender();
}
function tsManualForm(sheet) {
  const legacyDs = String(ui.tsEdit || "").startsWith("legacy:") ? ui.tsEdit.slice(7) : "";
  const existing = ui.tsEdit && ui.tsEdit !== "new" && !legacyDs ? (sheet?.entries || {})[ui.tsEdit] : null;
  const day = legacyDs ? ((sheet?.days || {})[legacyDs] || {}) : null;
  const e = existing || { date: legacyDs || (tsWeek() === weekStartOf(todayStr()) ? todayStr() : tsWeek()), start: day?.start || "", finish: day?.finish || "", breakStart: day?.breakStart || "", breakEnd: day?.breakEnd || "", job: "", note: day?.note || "" };
  const clock = !!(existing && existing.source === "clock");
  const dates = TS_DAYS.map((n, i) => { const ds = addDays(tsWeek(), i); return `<option value="${ds}" ${e.date === ds ? "selected" : ""}>${n} ${dmy(ds).slice(0, 5)}</option>`; }).join("");
  return `<form id="tsman" class="ts-man"><div class="ts-dl">${clock ? `<span class="ts-badge clock">Clocked</span>` : `<span class="ts-badge manual">Manual</span>`}<b>${existing ? "Edit shift" : "Add hours manually"}</b></div>
    ${clock ? `<div class="ts-keep"><p>The original clock stamp stays visible after you save.</p>${tsFixLine("Clocked on", existing.clockOn)}${tsFixLine("Clocked off", existing.clockOff)}${tsFixLine("Break start", existing.breakOn)}${tsFixLine("Break end", existing.breakOff)}</div><input type="hidden" name="date" value="${esc(existing.date)}">` : `<label>Day<select name="date">${dates}</select></label>`}
    <div class="ts-in"><label>Start<input type="time" name="start" value="${esc(e.start || "")}"></label><label>Finish<input type="time" name="finish" value="${esc(e.finish || "")}"></label></div>
    <div class="ts-in"><label>Break start<input type="time" name="breakStart" value="${esc(e.breakStart || "")}"></label><label>Break end<input type="time" name="breakEnd" value="${esc(e.breakEnd || "")}"></label></div>
    <label>Job<input name="job" maxlength="200" value="${esc(existing?.job || e.job || "")}" placeholder="Site or job"></label>
    <label>Notes<input name="note" maxlength="200" value="${esc(existing?.note || e.note || "")}" placeholder="Optional"></label>
    <p id="tsmsg" class="sub"></p>
    <div class="btns"><button type="button" class="sm-btn" id="tsmancancel">Cancel</button><button type="submit" class="sm-btn primary">Save shift</button></div></form>`;
}
function tsManualArea(sheet) {
  if (ui.tsEdit) return tsManualForm(sheet);
  return `<button type="button" class="sm-btn ts-add" id="tsadd">Add manual hours</button>`;
}
function tsGrid(sheet) {
  const ws = tsWeek(), days = (sheet && sheet.days) || {};
  return `<form id="tsf" class="ts-form"><p class="sub">Or type the week. Saving here does not clock you on.</p>${TS_DAYS.map((n, i) => { const ds = addDays(ws, i), d = days[ds] || {};
    return `<div class="ts-day" data-ds="${ds}"><div class="ts-dl"><b>${n}</b> <span class="sub">${dmy(ds).slice(0, 5)}</span><span class="ts-h">${tsHours(d) ? hrs(tsHours(d)) : ""}</span></div>
      <div class="ts-in"><label>Start<input type="time" name="start" value="${esc(d.start || "")}"></label><label>Finish<input type="time" name="finish" value="${esc(d.finish || "")}"></label>
      <span class="ts-lunch">less 30 min lunch</span></div>
      <input class="ts-note" name="note" placeholder="Note / job (optional)" value="${esc(d.note || "")}"></div>`; }).join("")}
    <div class="ts-tot">Week total <b id="tstot">${hrs(tsTotal(days))}</b></div>
    <div class="btns"><span id="tsmsg" class="sub">${sheet && sheet.sent ? `Sent to accounts ${esc(dmy(String(sheet.sentAt || "").slice(0, 10)))}${String(sheet.updatedAtIso || "") > String(sheet.sentAt || "") ? " · edited since" : ""}` : sheet ? "Saved" : ""}</span>
      <button type="submit" class="sm-btn primary">Save hours</button></div></form>`;
}
function tsEditor() {
  if (!tsWorkerReady()) return tsNav() + `<p class="sub pad">Loading…</p>`;
  const sheet = ui.tsMine;
  const has = entryList(sheet?.entries).length > 0;
  const body = !has && !ui.tsEdit ? tsGrid(sheet) : has ? `${tsCards(sheet, true)}${tsWeekTotal(sheet)}` : "";
  return `${tsNav()}${tsLeaveFor(me.uid, me.name)}${tsClockHtml()}${tsMachineHtml()}${tsManualArea(sheet)}${body}`;
}
const TS_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const tsDayLbl = (ds, wd) => `${wd} ${+ds.slice(8, 10)} ${TS_MON[+ds.slice(5, 7) - 1]}`;
const tsLong = (ds, wd) => `${tsDayLbl(ds, wd)} ${ds.slice(0, 4)}`;
const ampm = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ""); if (!m) return t || ""; const h = +m[1]; return `${h % 12 || 12}:${m[2]}${h < 12 ? "am" : "pm"}`; };
const hr1 = h => { const r = Math.round(h * 100) / 100; return (Number.isInteger(r * 10) ? r.toFixed(1) : String(r)) + " hrs"; };
function tsText(t, name, eol = "\n") {
  const ws = t.weekStart, entries = sortedEntries(t.entries).map(paidShift);
  const tm = timesheetMailParts(orgSettings(), me && me.name);
  const L = [tm.greeting, "", `Here are ${name}'s hours for the week of ${tsLong(ws, "Mon")} to ${tsLong(addDays(ws, 6), "Sun")}.`, ""];
  if (!entries.length) {
    let worked = 0;
    TS_DAYS.forEach((n, i) => { const ds = addDays(ws, i), d = (t.days || {})[ds] || {}, h = tsHours(d);
      if (h) { worked++; L.push(`${tsDayLbl(ds, n)}   ${ampm(d.start)} to ${ampm(d.finish)}   ${hr1(h)}`); if (d.note) L.push(`      ${d.note}`); }
      else if (d.note) L.push(`${tsDayLbl(ds, n)}   not worked (${d.note})`); });
    if (!worked) L.push("No hours entered this week.");
    L.push("", "A 30-minute lunch break has already been taken off each day.", "", `TOTAL: ${hr1(tsTotal(t.days))}`, "", "Thanks,", tm.sender, orgSettings().signoff, POWERED_BY);
    return L.join(eol);
  }
  let worked = 0;
  const used = new Set();
  for (const e of entries) {
    used.add(e.date);
    const h = shiftHours(e);
    const kind = e.source === "manual" ? "manual" : "clocked";
    const br = e.breakStart && e.breakEnd ? ` (break ${ampm(e.breakStart)} to ${ampm(e.breakEnd)})` : "";
    if (h) { worked++; L.push(`${tsDayLbl(e.date, tsDow(e.date))}   ${ampm(e.start)} to ${ampm(e.finish)}   ${hr1(h)}   ${kind}${br}`); }
    else if (e.source === "clock" && e.status !== "closed") L.push(`${tsDayLbl(e.date, tsDow(e.date))}   clocked on ${ampm(e.start)} (not clocked off yet)`);
    const note = [e.job, e.note].filter(Boolean).join(" — ");
    if (note) L.push(`      ${note}`);
  }
  TS_DAYS.forEach((n, i) => {
    const ds = addDays(ws, i);
    if (used.has(ds)) return;
    const d = (t.days || {})[ds] || {}, h = tsHours(d);
    if (h) { worked++; L.push(`${tsDayLbl(ds, n)}   ${ampm(d.start)} to ${ampm(d.finish)}   ${hr1(h)}`); if (d.note) L.push(`      ${d.note}`); }
  });
  if (!worked) L.push("No hours entered this week.");
  L.push("", "Clocked rows were stamped at clock on and clock off. Manual rows were typed in.", "A 30-minute lunch is taken off unless a break was entered.", "", `TOTAL: ${hr1(sheetHours(t))}`, "", "Thanks,", tm.sender, orgSettings().signoff, POWERED_BY);
  return L.join(eol);
}
function tsPeople(L) {
  const known = new Set();
  const people = [];
  for (const p of staff) {
    if (p.uid === ALEX_UID) continue;
    known.add(p.uid);
    people.push({ uid: p.uid, name: p.name });
  }
  for (const t of L) {
    if (known.has(t.uid)) continue;
    known.add(t.uid);
    people.push({ uid: t.uid, name: t.name || (staff.find(p => p.uid === t.uid) || {}).name || "?" });
  }
  return people;
}
function tsPerson(p, t) {
  const away = tsLeaveFor(p.uid, p.name, t && t.weekStart);
  if (!t) return `<div class="ts-card"><h3>${esc(p.name)}</h3>${away}<p class="sub">No hours entered for this week.</p></div>`;
  const sent = t.sent ? ` <span class="qpill q-comp">Sent ${esc(dmy(String(t.sentAt || "").slice(0, 10)))}</span>` : "";
  const edited = t.sent && String(t.updatedAtIso || "") > String(t.sentAt || "") ? ` <span class="qpill">Edited since sent</span>` : "";
  const legacyTable = `<table class="jt ts-t"><thead><tr><th>Day</th><th>Start</th><th>Finish</th><th>Lunch</th><th>Hours</th><th>Note</th></tr></thead><tbody>${TS_DAYS.map((n, i) => { const ds = addDays(t.weekStart, i), d = (t.days || {})[ds] || {};
    return `<tr><td>${n} ${dmy(ds).slice(0, 5)}</td><td>${esc(d.start || "")}</td><td>${esc(d.finish || "")}</td><td>${tsHours(d) ? "−30m" : ""}</td><td>${tsHours(d) ? hrs(tsHours(d)) : ""}</td><td>${esc(d.note || "")}</td></tr>`; }).join("")}</tbody></table>`;
  const detail = entryList(t.entries).length ? tsCards(t, t.uid === me.uid) : legacyTable;
  const send = !isOwner() ? "" : `<div class="btns"><button type="button" class="sm-btn tscopy">Copy</button>${t.sent ? `<button type="button" class="sm-btn tsunsent">Unmark sent</button>` : ""}</div>`;
  return `<div class="ts-card" data-tsid="${esc(t.id)}"><h3>${esc(p.name)} · <b>${hrs(sheetHours(t))}</b>${sent}${edited}</h3>${away}${detail}${send}</div>`;
}
function tsAdmin() {
  const ws = tsWeek(), L = ui.tsAll && ui.tsAllWs === ws ? ui.tsAll : null;
  if (!L) return tsNav() + `<p class="sub pad">Loading…</p>`;
  const people = tsPeople(L);
  const shown = ui.tsStaff ? people.filter(p => p.uid === ui.tsStaff) : people;
  const sum = shown.reduce((n, p) => n + sheetHours(L.find(t => t.uid === p.uid) || {}), 0);
  const who = ui.tsStaff ? (people.find(p => p.uid === ui.tsStaff) || {}).name || "Staff" : "all staff";
  return `${tsNav()}<h2 class="ts-live">Your shift</h2>${tsClockHtml()}${tsMachineHtml()}${tsManualArea(tsOwnSheet())}<label class="ts-filter">Staff <select id="tsstaff"><option value="">All staff</option>${people.map(p => `<option value="${esc(p.uid)}" ${ui.tsStaff === p.uid ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
    <div class="ts-tot">Total <b>${hrs(sum)}</b> <span class="sub">${esc(who)}</span></div>${hxPanel(ws)}
    ${shown.map(p => tsPerson(p, L.find(t => t.uid === p.uid) || null)).join("") || `<p class="sub">Nobody matches that filter.</p>`}`;
}
// ---- Hours spreadsheet for accounts: build .xlsx in the browser, store it privately, queue one email.
// tools/hours_export_mailer.py (box routine, Gmail connector as alex@heartwoodew.com) sends it to accounts@ only.
const hxStatus = x => x.status === "sent" ? `<span class="qpill q-comp">Emailed ${esc(dmy(String(x.sentAt || "").slice(0, 10)))}</span>`
  : x.status === "failed" ? `<span class="qpill q-warn" title="${esc(x.error || "")}">Send failed${(x.attempts || 0) >= 5 ? " (gave up)" : ", will retry"}</span>`
  : x.status === "sending" ? `<span class="qpill">Sending…</span>` : `<span class="qpill">Queued, emails within ~15 min</span>`;
function hxPaint() { try { if (typeof ui.tsPaint === "function") ui.tsPaint(); } catch (e) { console.warn("hours paint", e); } }
function hxErrText(e) { return (e && (e.code || e.message)) || "unknown error"; }
function hxPanel(ws) {
  if (!me || me.role !== "admin") return "";
  const L = (ui.hxList || []).filter(x => x.weekStart === ws).slice(0, 3);
  const customer = canCompanyExport();
  const mail = customer ? hoursBrand(orgSettings()).accountsEmail : ACCOUNTS_TO;
  return `<div class="ts-card hx-card"><h3>${customer ? "Hours" : "Hours spreadsheet for accounts"}</h3>
    <p class="sub">${customer
      ? `Download this week's hours as a spreadsheet or a CSV. The first sheet is hours for each day. The spreadsheet can also be emailed to ${esc(mail)}.`
      : `Builds an Excel file (.xlsx) for Mon ${dmy(ws)} – Sun ${dmy(addDays(ws, 6))}. The first sheet is hours for each day. A leave day shows Annual, Sick, Other, or Pending. The second sheet lists each shift. It saves on this device and emails ${esc(mail)}.`}</p>
    <div class="btns"><button type="button" class="sm-btn primary" id="hxgo"${ui.hxBusy ? " disabled" : ""}>${ui.hxBusy ? "Building…" : customer ? "Make spreadsheet" : "📊 Make & send hours spreadsheet"}</button>
    <button type="button" class="sm-btn" id="hxdl"${ui.hxBusy ? " disabled" : ""}>Download only</button>
    ${customer ? `<button type="button" class="sm-btn" id="hxcsv">Download hours CSV</button>` : ""}</div>
    ${ui.hxErr ? `<p class="err" role="alert" id="hxerr">${esc(ui.hxErr)}</p>` : ""}
    ${L.map(x => `<p class="sub hx-row">${esc(x.fileName || "")} · ${esc(String(x.totalHours ?? ""))} h · ${hxStatus(x)}</p>`).join("")}</div>`;
}
function hxSubs() {
  if (ui.hxSub || !me || me.role !== "admin") return;
  ui.hxSub = () => {};
  ui.hxSub = onSnapshot(query(collection(db, "hoursExports"), where("companyId", "==", myCompanyId()), orderBy("createdAt", "desc")), s => {
    ui.hxList = s.docs.slice(0, 20).map(d => ({ id: d.id, ...d.data() }));
    if (ui.hxListErr) { ui.hxListErr = ""; if (!ui.hxBusy) ui.hxErr = ""; }
    if (tsIsAdminSheet() && !ui.tsDirty && !ui.tsEdit) hxPaint();
  }, e => {
    ui.hxListErr = hxErrText(e);
    ui.hxErr = "Hours spreadsheet list not available: " + ui.hxListErr;
    if (tsIsAdminSheet()) hxPaint();
  });
}
async function hxRun(send) {
  const ws = tsWeek(), L = ui.tsAll && ui.tsAllWs === ws ? ui.tsAll : null;
  if (ui.hxBusy) return;
  if (!L) { ui.hxErr = "Timesheets are still loading. Wait a moment and try again."; hxPaint(); return; }
  const brand = hoursBrand(orgSettings());
  if (send && testCompanyActive()) {
    holdOutbound("hours", `Preview only. Hours for ${brand.titleName} were not emailed.`);
    return;
  }
  let rep, name, bytes;
  try {
    rep = buildHoursReport({ weekStart: ws, people: tsPeople(L), sheets: L, leaves: ui.leave || [], jobs });
    if (send && !rep.people.length && !confirm("No hours entered for this week. Email an empty spreadsheet anyway?")) return;
    name = exportFileName(brand.fileName, ws);
    bytes = xlsxBytes(reportSheets(rep, { company: brand.titleName }));
  } catch (e) {
    ui.hxErr = "Could not build the spreadsheet: " + hxErrText(e);
    toast(ui.hxErr);
    hxPaint();
    return;
  }
  ui.hxErr = "";
  // Save or open the share sheet before any redraw, while this tap is still a user gesture.
  const delivered = deliverHoursFile({ bytes, filename: name, mime: XLSX_MIME });
  if (!send) {
    try {
      const saved = await delivered;
      if (saved.cancelled) return;
      if (!saved.ok) { ui.hxErr = saved.error || "Download failed"; toast(ui.hxErr); }
      else toast("Downloaded " + name);
    } catch (e) { ui.hxErr = "Download failed: " + hxErrText(e); toast(ui.hxErr); }
    hxPaint();
    return;
  }
  ui.hxBusy = true;
  hxPaint();
  let queued = false;
  try {
    const id = newExportId(), path = `hoursExports/${id}/${name}`;
    await uploadBytes(storageRef(storage, path), bytes, { contentType: XLSX_MIME, customMetadata: { purpose: "hours-export", uploaderUid: me.uid, exportId: id, companyId: brand.companyId } });
    await setDoc(doc(db, "hoursExports", id), { weekStart: ws, weekEnd: addDays(ws, 6), to: brand.accountsEmail, fileName: name, storagePath: path,
      people: rep.people.length, totalHours: rep.total, status: "queued", attempts: 0, createdBy: me.uid, createdByName: String(me.name || "").slice(0, 80), createdAt: serverTimestamp(),
      companyId: brand.companyId, companyName: brand.subjectName });
    queued = true;
    toast("Spreadsheet queued for " + brand.accountsEmail);
  } catch (e) {
    ui.hxErr = "Not queued: " + hxErrText(e) + ". The file is still saved on this device if the download or share sheet opened.";
    toast("Not queued: " + hxErrText(e));
  }
  let saveNote = "";
  try {
    const saved = await delivered;
    if (!saved.cancelled && !saved.ok) saveNote = saved.error || "The file was not saved on this device.";
  } catch (e) { saveNote = "Download failed: " + hxErrText(e); }
  if (queued && !ui.hxListErr) ui.hxErr = saveNote;
  else if (saveNote) ui.hxErr = [ui.hxErr, saveNote].filter(Boolean).join(" ");
  ui.hxBusy = false;
  hxPaint();
}
function locationNoticeHtml() {
  const note = ui.locationNotice;
  if (!note || !me || note.companyId !== myCompanyId()) return "";
  const live = ui.liveShare || {};
  if (live.clockedOn === true && live.sharing === "gps") return "";
  return locationRemindBannerHtml(note.body);
}
function openClockScreen() {
  if (!me) return;
  ui.opSel = null;
  if (me.role === "admin" && !ui.myJobs) { ui.view = "timesheet"; renderAdmin(); }
  else { ui.opTab = "hours"; renderOperator(); }
}
function stopLocationNotice() {
  if (ui.locationNoticeUnsub) {
    try { ui.locationNoticeUnsub(); } catch { /* already stopped */ }
  }
  ui.locationNoticeUnsub = null;
  ui.locationNotice = null;
}
function watchLocationNotice() {
  stopLocationNotice();
  if (!me || !me.uid) return;
  const companyId = myCompanyId();
  ui.locationNoticeUnsub = onSnapshot(doc(db, "users", me.uid, "locationNotices", "current"), snap => {
    const data = snap.exists() ? (snap.data() || null) : null;
    ui.locationNotice = data && data.companyId === companyId ? data : null;
    if (me.role === "admin" && !ui.myJobs) {
      if (ui.view === "home" || ui.view === "timesheet") renderAdmin();
      return;
    }
    if (!ui.opSel && ((ui.opTab || "today") === "today" || ui.opTab === "hours")) renderOperator();
  }, () => { ui.locationNotice = null; });
}
function tsView() {
  const admin = me.role === "admin";
  return `<div class="sm-head"><h1>Timesheet</h1><span class="sub">${admin ? "Clocked and manual hours" : "Clock on, or enter your hours"}</span></div>${locationNoticeHtml()}<div class="ts-wrap">${admin ? tsAdmin() : tsEditor()}</div>`;
}
function tsLeaveFor(uid, name, week) {
  return weekLeaveHtml(ui.leave || [], week || tsWeek(), { uid, name });
}
function leaveCanDecide() {
  return !!(me && (me.role === "admin" || me.role === "manager" || me.role === "supervisor" || me.staffRole === "manager" || me.staffRole === "supervisor"));
}
function leaveCanOpen() {
  return !!(me && me.role === "admin");
}
function leaveStop() {
  ui.leaveUnsub?.();
  ui.leaveUnsub = null;
}
// Heartwood keeps the root collections; every other company keeps leave and claims under companies/{id}/,
// so no company's list can ever include another company's requests.
function coPath(name) { return myCompanyId() === "heartwood" ? [name] : ["companies", myCompanyId(), name]; }
function lvColl() { return collection(db, ...coPath("leaveRequests")); }
function lvDoc(id) { return doc(db, ...coPath("leaveRequests"), id); }
function rcColl() { return collection(db, ...coPath("reimbursementClaims")); }
function rcDoc(id) { return doc(db, ...coPath("reimbursementClaims"), id); }
function leaveStart() {
  leaveStop();
  if (!me) { ui.leave = []; return; }
  const src = leaveCanDecide()
    ? lvColl()
    : query(lvColl(), where("uid", "==", me.uid));
  ui.leaveUnsub = onSnapshot(src, snap => {
    ui.leave = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    ui.leaveState = "ok";
    const jobForm = document.getElementById("jf");
    if (jobForm) refreshJobLeaveWarn(jobForm);
    if (document.activeElement?.closest?.("#leaveform, .lv-decide")) return;
    const admin = me.role === "admin" && !ui.myJobs;
    if (admin && (ui.view === "leave" || ui.view === "timesheet" || ui.view === "dispatch" || ui.view === "capacity")) renderAdmin();
    else if (!admin && (ui.opTab === "leave" || ui.opTab === "hours")) renderOperator();
  }, () => { ui.leave = []; ui.leaveState = "absent"; });
}
function leavePeople(names) {
  return (names || []).map(name => {
    const row = staff.find(s => String(s.name).toLowerCase() === String(name).toLowerCase());
    return { uid: row && row.uid || "", name };
  });
}
function confirmIfOnLeave(date, names) {
  const text = assignmentWarning(ui.leave || [], date, leavePeople(names));
  if (!text) return true;
  return confirm(text + " Save this job anyway?");
}
function refreshJobLeaveWarn(form) {
  const el = form.querySelector("#leavewarn");
  if (!el || !form.date) return;
  const picked = [...form.querySelectorAll("[name=assigned]:checked")].map(x => staff.find(s => skey(s) === x.value)).filter(Boolean);
  const text = assignmentWarning(ui.leave || [], form.date.value, picked.map(s => ({ uid: s.uid || "", name: s.name })));
  el.hidden = !text;
  el.textContent = text ? text + " Saving still assigns them." : "";
}
function capacityCover() {
  return { from: addDays(todayStr(), -14), to: addDays(todayStr(), 28) };
}
function capacityScreen() {
  ui.capacityCover = capacityCover();
  const src = me.role === "admin" ? [...(jobs || []), ...(ui.done || [])] : (ui.officeJobs || []);
  return capacityViewHtml({
    people: (staff || []).map(s => ({ uid: s.uid || "", name: s.name || "", companyId: s.companyId, tenantId: s.tenantId })),
    jobs: src,
    leaves: ui.leave || [],
    weekStart: shiftWeek(todayStr(), ui.capWk || 0),
    companyId: myCompanyId(),
    coverage: ui.capacityCover,
    today: todayStr(),
    staffKnown: !!(staff && staff.length),
    error: ui.capacityErr || "",
    offline: typeof navigator !== "undefined" && navigator.onLine === false
  });
}
function startCapacityWatch() {
  ui.capacityCover = capacityCover();
  ui.capacityErr = "";
  if (!canSeeCapacity() || me.role === "admin") return () => {};
  const q = companyJobs([where("date", ">=", ui.capacityCover.from), where("date", "<=", ui.capacityCover.to), orderBy("date")]);
  const stop = onSnapshot(q, snap => {
    ui.officeJobs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    ui.capacityErr = "";
    const admin = me.role === "admin" && !ui.myJobs;
    if (admin && ui.view === "capacity") renderAdmin();
    else if (!admin && ui.opTab === "capacity") renderOperator();
  }, e => {
    ui.officeJobs = ui.officeJobs || [];
    ui.capacityErr = e.code || "unavailable";
    if (ui.opTab === "capacity") renderOperator();
  });
  if (!staff.length) {
    getDocs(query(collection(db, "users"), where("companyId", "==", myCompanyId()))).then(snap => {
      const companyId = myCompanyId();
      const logins = snap.docs.map(d => ({ uid: d.id, ...d.data() }))
        .filter(u => (u.companyId || u.tenantId || "heartwood") === companyId)
        .filter(u => CREW_ROLES.includes(u.role) || u.role === "supervisor" || u.role === "manager" || u.role === "admin");
      if (logins.length) staff = logins;
      if (ui.opTab === "capacity") renderOperator();
    }).catch(() => {});
  }
  return stop;
}
function leaveView() {
  return `<div class="sm-head"><h1>Leave</h1><span class="sub">Annual, sick, or other</span></div><div class="lv-wrap">${leaveScreenHtml({
    requests: ui.leave || [], uid: me.uid, canDecide: leaveCanDecide(), canOpenCert: leaveCanOpen(), error: ui.leaveErr || "",
  })}</div>`;
}
async function openLeaveCert(id) {
  const row = (ui.leave || []).find(item => item.id === id);
  if (!row || !row.certificatePath) return;
  if (row.uid !== me.uid && !leaveCanOpen()) { toast("Only that person and an admin can open the certificate."); return; }
  try {
    const blob = await getBlob(storageRef(storage, row.certificatePath));
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    link.download = row.certificateName || "certificate";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    toast("Certificate not opened (" + (e.code || "storage") + ").");
  }
}
async function downloadLeaveCert(id) {
  const row = (ui.leave || []).find(item => item.id === id);
  if (!row || !row.certificatePath) return;
  if (row.uid !== me.uid && !leaveCanOpen()) { toast("Only that person and an admin can open the certificate."); return; }
  const filename = certificateDownloadName(row);
  const fileRef = storageRef(storage, row.certificatePath);
  try {
    const blob = await getBlob(fileRef);
    let downloadUrl = "";
    try {
      const storageMod = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js");
      downloadUrl = await storageMod.getDownloadURL(fileRef);
    } catch { downloadUrl = ""; }
    const saved = await saveCertificate({ blob, downloadUrl, filename });
    if (!saved.ok) toast("Certificate not downloaded.");
  } catch (e) {
    toast("Certificate not downloaded (" + (e.code || "storage") + ").");
  }
}
function bindLeave(A) {
  const form = A.querySelector("#leaveform");
  if (form) form.onsubmit = async ev => {
    ev.preventDefault();
    // One request per tap: a second tap while the first is uploading or saving made a duplicate request.
    if (form.dataset.busy === "1") return;
    form.dataset.busy = "1";
    const btn = form.querySelector("button[type=submit]");
    if (btn) btn.disabled = true;
    try { await submitLeave(form, A); } finally { delete form.dataset.busy; if (btn) btn.disabled = false; }
  };
  async function submitLeave(form, A) {
    const err = A.querySelector("#leaveerr");
    const file = form.certificate.files[0];
    const id = newLeaveId();
    let certificatePath = "";
    let certificateName = "";
    if (file) {
      const objectName = certificateObjectName(file.type);
      const contentType = certificateContentType(file.type);
      if (!objectName) { if (err) err.textContent = "Use a photo (JPEG, PNG, WebP) or a PDF."; return; }
      if (file.size > 8 * 1024 * 1024) { if (err) err.textContent = "The certificate must be 8 MB or smaller."; return; }
      certificatePath = certificateStoragePath(me.uid, id, objectName);
      certificateName = String(file.name || objectName).slice(0, 120);
      const certMeta = { purpose: "leave-certificate", uploaderUid: me.uid, requestId: id };
      if (!deviceOnline()) {
        const ok = await enqueueUpload({ id, kind: "leave-cert", uid: me.uid, companyId: myCompanyId(), path: certificatePath, contentType, metadata: certMeta, label: certificateName, file });
        if (!ok) { if (err) err.textContent = "The certificate could not be kept on this phone."; return; }
      } else {
        try {
          await uploadBytes(storageRef(storage, certificatePath), file, { contentType, customMetadata: certMeta });
        } catch (e) {
          if (classifyUploadError(e) !== "retry") {
            if (err) err.textContent = "The certificate was not saved (" + (e.code || "storage") + "). Nothing was requested.";
            return;
          }
          const ok = await enqueueUpload({ id, kind: "leave-cert", uid: me.uid, companyId: myCompanyId(), path: certificatePath, contentType, metadata: certMeta, label: certificateName, file });
          if (!ok) { if (err) err.textContent = "The certificate was not saved (" + (e.code || "storage") + "). Nothing was requested."; return; }
        }
      }
    }
    const built = leaveCreateBody({
      id, uid: me.uid, name: me.name, type: form.type.value, start: form.start.value, end: form.end.value,
      startHalf: form.startHalf.value, endHalf: form.endHalf.value, reason: form.reason.value, certificatePath, certificateName,
    });
    if (!built.ok) { if (err) err.textContent = built.reason; return; }
    try {
      const saved = await queueWrite(setDoc(lvDoc(id), { ...built.data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }), { id: "leave:" + id, kind: "leave", label: "Leave request" }, "", { announce: false });
      form.reset();
      if (err) err.textContent = saved && saved.queued ? SAVED_ON_PHONE : "";
      toast(saved && saved.queued ? SAVED_ON_PHONE : "Leave request sent");
      redrawAfterSave();
    } catch (e) {
      if (err) err.textContent = "Not saved: " + (e.code || e.message);
    }
  }
  A.querySelectorAll(".lv-decide").forEach(decide => {
    decide.onsubmit = async ev => {
      ev.preventDefault();
      const status = ev.submitter && ev.submitter.value;
      const built = leaveDecisionBody({ status, note: decide.note.value, uid: me.uid, name: me.name });
      const msg = decide.querySelector(".lv-msg");
      if (!built.ok) { if (msg) msg.textContent = built.reason; return; }
      try {
        const saved = await queueWrite(updateDoc(lvDoc(decide.dataset.id), { ...built.data, decidedAt: serverTimestamp(), updatedAt: serverTimestamp() }), { id: "leave-decision:" + decide.dataset.id, kind: "leave", label: status === "approved" ? "Approve leave" : "Decline leave" }, "", { announce: false });
        toast(saved && saved.queued ? SAVED_ON_PHONE : (status === "approved" ? "Leave approved" : "Leave declined"));
        redrawAfterSave();
      } catch (e) {
        if (msg) msg.textContent = "Not saved: " + (e.code || e.message);
      }
    };
  });
  A.querySelectorAll(".lv-cert").forEach(btn => { btn.onclick = () => openLeaveCert(btn.dataset.cert); });
  A.querySelectorAll(".lv-cert-dl").forEach(btn => { btn.onclick = () => downloadLeaveCert(btn.dataset.cert); });
}
function claimsIsAdmin() {
  // Approve, decline and mark paid: manager and admin only. Supervisors see their own claim amount and cannot decide.
  return !!(me && (me.role === "admin" || me.role === "manager" || me.staffRole === "manager"));
}
function claimsStop() {
  ui.claimsUnsub?.();
  ui.claimsUnsub = null;
}
function claimsStart() {
  claimsStop();
  if (!me) { ui.claims = []; return; }
  const src = claimsIsAdmin()
    ? rcColl()
    : query(rcColl(), where("uid", "==", me.uid));
  ui.claimsUnsub = onSnapshot(src, snap => {
    ui.claims = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    ui.claimsErr = "";
    if (document.activeElement?.closest?.("#claimform, .rc-decide")) return;
    const admin = me.role === "admin" && !ui.myJobs;
    if (admin && ui.view === "claims") renderAdmin();
    else if (!admin && ui.opTab === "claims") renderOperator();
  }, e => { ui.claims = []; ui.claimsErr = "Couldn't load claims (" + (e.code || "error") + ")."; });
}
function claimJobs() {
  const list = [...(jobs || []), ...(claimsIsAdmin() ? (ui.undated || []) : [])];
  const seen = new Set();
  return list.filter(j => j && j.id && !seen.has(j.id) && seen.add(j.id))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .map(j => ({ id: j.id, label: `${jobNo(j)} · ${String(j.client || j.address || "").slice(0, 60)}${j.date ? " · " + j.date : ""}` }));
}
function claimsArgs() {
  return { claims: ui.claims || [], uid: me.uid, isAdmin: claimsIsAdmin(), jobs: claimJobs(), today: todayStr(), error: ui.claimsErr || "", filter: ui.claimsFilter || "open" };
}
function claimsView() {
  const csv = canCompanyExport() ? `<button type="button" class="sm-btn" id="claimcsv">Download CSV</button>` : "";
  return `<div class="sm-head"><h1>Reimbursements</h1><span class="sub">Staff claims for things they paid for</span>${csv}</div><div class="lv-wrap">${claimsScreenHtml(claimsArgs())}</div>`;
}
async function downloadClaimReceipt(id) {
  const row = (ui.claims || []).find(item => item.id === id);
  if (!row || !row.receiptPath) return;
  if (row.uid !== me.uid && !claimsIsAdmin()) { toast("Only that person, a manager or an admin can open the receipt."); return; }
  const fileRef = storageRef(storage, row.receiptPath);
  try {
    const blob = await getBlob(fileRef);
    let downloadUrl = "";
    try {
      const storageMod = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js");
      downloadUrl = await storageMod.getDownloadURL(fileRef);
    } catch { downloadUrl = ""; }
    const saved = await saveCertificate({ blob, downloadUrl, filename: receiptDownloadName(row) });
    if (!saved.ok) toast("Receipt not downloaded.");
  } catch (e) {
    toast("Receipt not downloaded (" + (e.code || "storage") + ").");
  }
}
function bindClaims(A, rerender) {
  const csv = A.querySelector("#claimcsv");
  if (csv) csv.onclick = () => downloadClaimsCsv();
  const form = A.querySelector("#claimform");
  if (form) form.onsubmit = async ev => {
    ev.preventDefault();
    const err = A.querySelector("#claimerr");
    const say = text => { if (err) err.textContent = text; };
    if (form.dataset.busy) return;
    const file = form.receipt.files[0];
    const id = newClaimId();
    const jobSel = form.jobId;
    const jobOpt = jobSel && jobSel.selectedOptions && jobSel.selectedOptions[0];
    const draft = {
      id, uid: me.uid, name: me.name, date: form.date.value, amount: form.amount.value, supplier: form.supplier.value,
      category: form.category.value, notes: form.notes.value, paidWith: (form.querySelector("[name=paidWith]:checked") || {}).value,
      jobId: jobSel ? jobSel.value : "", jobLabel: jobOpt ? (jobOpt.dataset.label || "") : "", receiptPath: "", receiptName: "",
    };
    let objectName = "";
    if (file) {
      objectName = receiptObjectName(file.type);
      if (!objectName) return say("Use a photo (JPEG, PNG, WebP) or a PDF.");
      if (file.size > RECEIPT_MAX_BYTES) return say("The receipt must be 10 MB or smaller.");
      draft.receiptPath = receiptStoragePath(me.uid, id, objectName);
      draft.receiptName = String(file.name || objectName).slice(0, 120);
    }
    const built = claimCreateBody(draft);
    if (!built.ok) return say(built.reason);
    form.dataset.busy = "1";
    try {
      if (file) {
        const contentType = receiptContentType(file.type);
        const metadata = { purpose: "reimbursement-receipt", uploaderUid: me.uid, claimId: id };
        if (!deviceOnline()) {
          const ok = await enqueueUpload({ id, kind: "claim-receipt", uid: me.uid, companyId: myCompanyId(), path: draft.receiptPath, contentType, metadata, label: draft.receiptName || "Receipt", file });
          if (!ok) return say("The receipt could not be kept on this phone. Nothing was claimed.");
        } else {
          try {
            await uploadBytes(storageRef(storage, draft.receiptPath), file, { contentType, customMetadata: metadata });
          } catch (e) {
            if (classifyUploadError(e) !== "retry") return say("The receipt was not saved (" + (e.code || "storage") + "). Nothing was claimed.");
            const ok = await enqueueUpload({ id, kind: "claim-receipt", uid: me.uid, companyId: myCompanyId(), path: draft.receiptPath, contentType, metadata, label: draft.receiptName || "Receipt", file });
            if (!ok) return say("The receipt was not saved (" + (e.code || "storage") + "). Nothing was claimed.");
          }
        }
      }
      const saved = await queueWrite(setDoc(rcDoc(id), { ...built.data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }), { id: "claim:" + id, kind: "claim", label: "Reimbursement" }, "Claim submitted");
      rememberEntries({ supplier: built.data.supplier || form.supplier.value });
      form.reset();
      say(saved && saved.queued ? SAVED_ON_PHONE : "");
    } catch (e) {
      say("Not saved: " + (e.code || e.message));
    } finally {
      delete form.dataset.busy;
    }
  };
  A.querySelectorAll(".rc-decide").forEach(decide => {
    decide.onsubmit = async ev => {
      ev.preventDefault();
      const status = ev.submitter && ev.submitter.value;
      const built = claimDecisionBody({ from: decide.dataset.from, status, note: decide.note.value, uid: me.uid, name: me.name, receiptPath: decide.dataset.receipt || "" });
      if (!built.ok) { toast(built.reason); return; }
      try {
        await queueWrite(updateDoc(rcDoc(decide.dataset.id), {
          ...built.data, decidedAt: serverTimestamp(), paidAt: status === "paid" ? serverTimestamp() : null, updatedAt: serverTimestamp(),
        }), { id: "claim-decision:" + decide.dataset.id, kind: "claim", label: "Reimbursement decision" }, status === "approved" ? "Claim approved" : status === "paid" ? "Marked paid" : "Claim declined");
      } catch (e) {
        toast("Not saved: " + (e.code || e.message));
      }
    };
  });
  A.querySelectorAll("[data-rc-receipt]").forEach(btn => { btn.onclick = () => downloadClaimReceipt(btn.dataset.rcReceipt); });
  A.querySelectorAll("[data-rc-filter]").forEach(btn => { btn.onclick = () => { ui.claimsFilter = btn.dataset.rcFilter; rerender(); }; });
}
async function tsLoad(ws, opts = {}) {
  const ref = doc(db, "timesheets", `${me.uid}_${ws}`);
  try {
    const snap = await getDoc(ref);
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch (e) {
    // No signal: a clock punch must still work. Use this phone's copy (the watched week is always cached).
    if (!opts.offlineOk || (e.code !== "unavailable" && e.code !== "failed-precondition")) throw e;
    try { const snap = await getDocFromCache(ref); return snap.exists() ? { id: snap.id, ...snap.data() } : null; }
    catch { return ui.tsWatchId === `${me.uid}_${ws}` && ui.tsMine !== undefined ? ui.tsMine : null; }
  }
}
// A queued punch that the server later refuses must not stay silent.
function tsLate(write) {
  return write.catch(e => { toast("Clock time not saved: " + (e.code || e.message)); throw e; });
}
async function tsWrite(ws, sheet, entries, lastEntryId, opts = {}) {
  const days = daysForSheet({ days: (sheet && sheet.days) || {}, entries });
  const ref = doc(db, "timesheets", `${me.uid}_${ws}`);
  const data = {
    uid: me.uid,
    name: String(me.name || "Staff").slice(0, 80),
    weekStart: ws,
    weekEnd: addDays(ws, 6),
    days,
    totalHrs: sheetHours({ days, entries }),
    updatedAt: serverTimestamp(),
    updatedAtIso: new Date().toISOString(),
    lastEntryId,
    ...tsCompanyField(),
  };
  if (opts.consent) data.locationConsentAt = serverTimestamp();
  // Update one shift key. Rewriting the whole entries map makes the rules re-check every stamp.
  // opts.fields: only these keys of the shift changed. Rewriting the whole shift resends its pending server
  // times as null when the phone is offline, and the rules then refuse the clock-off after the fact.
  if (sheet) {
    if (opts.fields && opts.fields.length) for (const k of opts.fields) data[`entries.${lastEntryId}.${k}`] = entries[lastEntryId][k];
    else data[`entries.${lastEntryId}`] = entries[lastEntryId];
    return queueWrite(tsLate(updateDoc(ref, data)), { id: "timesheet:" + ws + ":" + lastEntryId, kind: "timesheet", label: "Clock time" }, "", { announce: false, quietFail: true });
  }
  data.entries = { [lastEntryId]: entries[lastEntryId] };
  return queueWrite(tsLate(setDoc(ref, data)), { id: "timesheet:" + ws + ":" + lastEntryId, kind: "timesheet", label: "Clock time" }, "", { announce: false, quietFail: true });
}
const tsQueuedNote = r => (r && r.queued ? " · " + SAVED_ON_PHONE : "");
function tsFixAt(fix) { return { ...locationMap(fix), at: serverTimestamp() }; }
function tsDiffSummary(prev, next) {
  const bits = [];
  for (const [k, label] of [["date", "Day"], ["start", "Start"], ["finish", "Finish"], ["breakStart", "Break start"], ["breakEnd", "Break end"], ["job", "Job"], ["note", "Note"]]) {
    if ((prev[k] || "") !== (next[k] || "")) bits.push(`${label} ${prev[k] || "—"} → ${next[k] || "—"}`);
  }
  return bits.join(". ").slice(0, 200);
}
function shareLine() {
  const ind = shareIndicator(ui.liveShare || {});
  if (!ind.visible || ind.mode === "ask") return "";
  return `<p class="loc-share ${ind.mode}" role="status">${esc(ind.text)}</p>`;
}
let shareRun = null;
let liveCleared = false;
function paintShareStatus() {
  const ind = shareIndicator(ui.liveShare || {});
  const el = document.getElementById("locshare");
  if (!el) return;
  el.hidden = !ind.visible;
  el.textContent = ind.text || "";
  el.className = "loc-share " + (ind.mode || "off");
}
function liveDocRef(companyId) {
  return doc(db, ...liveCollectionPath(companyId || myCompanyId()), me.uid);
}
function disarmShareWatch() {
  if (!shareRun) return;
  if (shareRun.watch != null && navigator.geolocation && typeof navigator.geolocation.clearWatch === "function") {
    navigator.geolocation.clearWatch(shareRun.watch);
  }
  shareRun.watch = null;
  if (shareRun.timer) clearInterval(shareRun.timer);
  shareRun.timer = null;
  if (shareRun.gaveUp) clearTimeout(shareRun.gaveUp);
  shareRun.gaveUp = null;
}
function positionFix(pos) {
  const c = pos && pos.coords;
  if (!c || typeof c.latitude !== "number" || typeof c.longitude !== "number") return { fix: "no location" };
  return { fix: "gps", lat: c.latitude, lng: c.longitude, accuracy: typeof c.accuracy === "number" ? c.accuracy : null };
}
function considerShareFix(fix) {
  if (!shareRun || !me || document.hidden) return;
  const gps = fix && fix.fix === "gps" && Number.isFinite(fix.lat) && Number.isFinite(fix.lng);
  if (!gps) { sendShareOff(); return; }
  const next = { sharing: "gps", lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, at: Date.now() };
  if (!shouldSendPosition(shareRun.last, next, next.at)) return;
  const body = liveLocationBody({
    uid: me.uid, name: me.name, companyId: shareRun.companyId,
    weekStart: shareRun.weekStart, entryId: shareRun.entryId, fix,
  });
  setDoc(liveDocRef(shareRun.companyId), { ...body, updatedAt: serverTimestamp() }).then(() => {
    if (!shareRun || shareRun.entryId !== body.entryId) return;
    shareRun.last = next;
    shareRun.offSent = false;
    ui.liveShare = { clockedOn: true, sharing: "gps" };
    paintShareStatus();
  }).catch(() => {});
}
function sendShareOff() {
  if (!shareRun || !me || shareRun.offSent || shareRun.offSending) return;
  shareRun.offSending = true;
  const body = liveLocationBody({
    uid: me.uid, name: me.name, companyId: shareRun.companyId,
    weekStart: shareRun.weekStart, entryId: shareRun.entryId, fix: { fix: "no location" },
  });
  setDoc(liveDocRef(shareRun.companyId), { ...body, updatedAt: serverTimestamp() }).then(() => {
    if (!shareRun) return;
    shareRun.offSent = true;
    shareRun.offSending = false;
    ui.liveShare = { clockedOn: true, sharing: "off" };
    paintShareStatus();
  }).catch(() => { if (shareRun) shareRun.offSending = false; });
}
function armShareWatch() {
  if (!shareRun || document.hidden) return;
  const geo = navigator.geolocation;
  if (!geo || typeof geo.watchPosition !== "function") { sendShareOff(); return; }
  if (shareRun.watch == null) {
    shareRun.watch = geo.watchPosition(
      pos => considerShareFix(positionFix(pos)),
      () => sendShareOff(),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
    );
  }
  if (!shareRun.timer) {
    shareRun.timer = setInterval(() => {
      if (!shareRun || document.hidden || !navigator.geolocation || typeof navigator.geolocation.getCurrentPosition !== "function") return;
      navigator.geolocation.getCurrentPosition(
        pos => considerShareFix(positionFix(pos)),
        () => { if (shareRun && !shareRun.last) sendShareOff(); },
        { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
      );
    }, SHARE_MIN_MS);
  }
  if (!shareRun.gaveUp) {
    shareRun.gaveUp = setTimeout(() => {
      if (!shareRun || shareRun.last || shareRun.offSent) return;
      sendShareOff();
    }, SHARE_FIX_WAIT_MS);
  }
}
function liveShareStart(entryId, weekStart, firstFix) {
  if (!companySharesLocation({ status: ui.companyStatus })) { liveShareStop(false); return; }
  if (!me || !entryId || !weekStart) return;
  if (shareRun && shareRun.entryId === entryId && shareRun.weekStart === weekStart) {
    if (firstFix && !document.hidden) considerShareFix(firstFix);
    return;
  }
  disarmShareWatch();
  liveCleared = false;
  shareRun = { entryId, weekStart, companyId: myCompanyId(), last: null, watch: null, timer: null, offSent: false };
  ui.liveShare = { clockedOn: true, sharing: "ask" };
  paintShareStatus();
  if (firstFix) considerShareFix(firstFix);
  armShareWatch();
}
function liveShareStop(clearDoc) {
  const run = shareRun;
  disarmShareWatch();
  shareRun = null;
  ui.liveShare = { clockedOn: false, sharing: "off" };
  paintShareStatus();
  if (clearDoc && run && me && !liveCleared) {
    liveCleared = true;
    deleteDoc(doc(db, ...liveCollectionPath(run.companyId), me.uid)).catch(() => {});
  }
}
function clearStaleLive() {
  if (!me || shareRun || liveCleared) return;
  liveCleared = true;
  deleteDoc(doc(db, ...liveCollectionPath(myCompanyId()), me.uid)).catch(() => {});
}
function noteShareHidden() {
  if (!shareRun || shareRun.last || shareRun.offSent) return;
  sendShareOff();
}
document.addEventListener("visibilitychange", () => {
  if (!shareRun) return;
  if (document.hidden) { noteShareHidden(); disarmShareWatch(); }
  else armShareWatch();
});
window.addEventListener("pagehide", () => {
  if (!shareRun) return;
  noteShareHidden();
  disarmShareWatch();
});
function clockWatchStop() {
  ui.clockUnsub?.(); ui.clockPrevUnsub?.();
  ui.clockUnsub = ui.clockPrevUnsub = null;
}
function watchOwnClock() {
  clockWatchStop();
  if (!me) return;
  const ws = weekStartOf(todayStr());
  const prevWs = addDays(ws, -7);
  let curKnown = false, prevKnown = false, curServer = false, prevServer = false;
  const sync = () => {
    if (!curKnown || !prevKnown || !me) return;
    const here = openClock(ui.clockSheet && ui.clockSheet.entries);
    const back = openClock(ui.clockPrev && ui.clockPrev.entries);
    if (here) liveShareStart(here.id, (ui.clockSheet && ui.clockSheet.weekStart) || ws);
    else if (back) liveShareStart(back.id, (ui.clockPrev && ui.clockPrev.weekStart) || prevWs);
    else if (curServer && prevServer) { liveShareStop(true); clearStaleLive(); }
  };
  ui.clockUnsub = onSnapshot(doc(db, "timesheets", `${me.uid}_${ws}`), s => {
    ui.clockSheet = s.exists() ? s.data() : null;
    curKnown = true; curServer = !(s.metadata && s.metadata.fromCache); sync();
  }, () => { curKnown = true; curServer = true; ui.clockSheet = null; sync(); });
  ui.clockPrevUnsub = onSnapshot(doc(db, "timesheets", `${me.uid}_${prevWs}`), s => {
    ui.clockPrev = s.exists() ? s.data() : null;
    prevKnown = true; prevServer = !(s.metadata && s.metadata.fromCache); sync();
  }, () => { prevKnown = true; prevServer = true; ui.clockPrev = null; sync(); });
}
function destroyCrewMap() {
  if (ui.crewMap) { ui.crewMap.remove(); ui.crewMap = null; }
  ui.crewLayer = null;
  ui.crewFitKey = "";
}
function leaveCrewScreen() {
  destroyCrewMap();
  ui.crewUnsub?.(); ui.crewJobUnsub?.();
  ui.crewUnsub = ui.crewJobUnsub = null;
  ui.crewSubsOn = false;
}
function crewMapScreen() {
  return `<div class="crew-map-wrap">
    <p class="crew-note">${esc(LIVE_LIMIT_NOTE)} Clocking off removes someone straight away.</p>
    <div class="crew-map-frame">
      <div id="crewmap" class="crew-map" role="region" aria-label="Live crew map"></div>
      <p id="crewmapempty" class="crew-map-note" hidden></p>
    </div>
    <p id="crewmapstatus" class="crew-note"></p>
    <button type="button" id="crewmapretry" class="sm-btn" hidden>Retry</button>
    <p class="crew-legend"><span class="crew-dot crew"></span> Clocked on <span class="crew-dot job"></span> Today's job</p>
    <div id="crewlist"><p class="crew-note">Loading crew…</p></div>
  </div>`;
}
function homeCrewCard() {
  if (homeCrewSlot(me) !== "crew") return "";
  return `<section class="hsec crew-home" aria-label="Crew on the clock"><div class="hsec-h">Crew <small>clocked on now</small></div>${crewMapScreen()}</section>`;
}
function openCrewScreen() {
  if (!canSeeCrewMap(me)) return;
  if (!companySharesLocation({ status: ui.companyStatus })) {
    leaveCrewScreen();
    ui.crewLive = [];
    ui.crewErr = "paused";
    paintCrew();
    return;
  }
  if (!ui.crewSubsOn) {
    ui.crewSubsOn = true;
    ui.crewErr = "";
    const companyId = myCompanyId();
    const path = liveCollectionPath(companyId);
    ui.crewUnsub = onSnapshot(query(collection(db, ...path), where("companyId", "==", companyId)), s => {
      ui.crewLive = s.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => x.clockedOn === true && (x.companyId || "heartwood") === companyId);
      ui.crewErr = "";
      paintCrew();
    }, e => { ui.crewErr = e.code || "permission-denied"; paintCrew(); });
    ui.crewJobUnsub = onSnapshot(query(collection(db, "jobs"), where("companyId", "==", companyId), where("date", "==", todayStr())), s => {
      ui.crewJobs = s.docs.map(d => ({ id: d.id, ...d.data() }));
      paintCrew();
    }, () => { paintCrew(); });
  }
  paintCrew();
}
function paintCrewMapStatus(model, failure) {
  const status = document.getElementById("crewmapstatus");
  const retry = document.getElementById("crewmapretry");
  const note = document.getElementById("crewmapempty");
  const notice = crewMapNotice(model);
  const gps = ((model && model.people) || []).some(p => p.sharing === "gps");
  if (note) {
    note.hidden = !notice || !!failure;
    note.textContent = notice;
  }
  if (retry) retry.hidden = !(failure && failure.retry);
  if (!status) return;
  if (failure) { status.textContent = failure.text; return; }
  if (ui.crewErr) { status.textContent = "The crew list isn't available on this sign-in."; return; }
  if (notice && !gps) { status.textContent = notice; return; }
  status.textContent = "Blue dots are people clocked on. Amber dots are today's jobs that already have a map pin.";
}
function bindCrewMapRetry() {
  const btn = document.getElementById("crewmapretry");
  if (!btn || btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", () => {
    btn.disabled = true;
    retryCrewMap().finally(() => { if (btn.isConnected) btn.disabled = false; });
  });
}
async function retryCrewMap() {
  if (!window.L) leafletPromise = null;
  ui.crewTilesFailed = false;
  if (ui.crewMap) {
    try { ui.crewMap.remove(); } catch { /* already gone */ }
    ui.crewMap = null;
    ui.crewLayer = null;
    ui.crewFitKey = "";
  }
  paintCrew();
}
function paintCrew() {
  const list = document.getElementById("crewlist");
  if (!list || !canSeeCrewMap(me)) return;
  const status = document.getElementById("crewmapstatus");
  if (!companySharesLocation({ status: ui.companyStatus }) || ui.crewErr === "paused") {
    list.innerHTML = `<p class="crew-note">Location sharing is off while this company is paused.</p>`;
    if (status) status.textContent = "A paused company cannot see or share locations.";
    const retry = document.getElementById("crewmapretry");
    if (retry) retry.hidden = true;
    const note = document.getElementById("crewmapempty");
    if (note) note.hidden = true;
    if (ui.crewLayer) ui.crewLayer.clearLayers();
    return;
  }
  const model = crewMapModel({ locations: ui.crewLive || [], jobs: ui.crewJobs || [], today: todayStr(), now: new Date() });
  list.innerHTML = crewListHtml(model, esc);
  bindCrewMapRetry();
  ensureCrewMap(model);
}
function crewIcon(L, color) {
  return L.divIcon({ className: "crew-pin", html: `<span style="background:${color}"></span>`, iconSize: [18, 18], iconAnchor: [9, 9] });
}
const LEAFLET_CSS = ["vendor/leaflet/leaflet.css", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"];
const LEAFLET_JS = ["vendor/leaflet/leaflet.js", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"];
let leafletPromise = null;
function loadAsset(tag, src, timeoutMs) {
  return new Promise((resolve, reject) => {
    const el = document.createElement(tag);
    const timer = setTimeout(() => {
      el.onload = el.onerror = null;
      reject(new Error("map-timeout"));
    }, timeoutMs);
    el.onload = () => { clearTimeout(timer); resolve(el); };
    el.onerror = () => { clearTimeout(timer); reject(new Error("map-unavailable")); };
    if (tag === "link") { el.rel = "stylesheet"; el.href = src; }
    else { el.src = src; el.async = true; }
    document.head.appendChild(el);
  });
}
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = (async () => {
    let styled = false;
    for (const href of LEAFLET_CSS) {
      try { await loadAsset("link", href, 12000); styled = true; break; } catch { /* try the next copy */ }
    }
    let last = new Error(styled ? "map-unavailable" : "map-style");
    for (const src of LEAFLET_JS) {
      try {
        await loadAsset("script", src, 12000);
        if (window.L) return window.L;
        last = new Error("map-unavailable");
      } catch (err) { last = err; }
    }
    leafletPromise = null;
    throw last;
  })();
  return leafletPromise;
}
async function ensureCrewMap(model) {
  const el = document.getElementById("crewmap");
  if (!el) return;
  const token = (ui.crewMapToken = (ui.crewMapToken || 0) + 1);
  let L;
  try { L = await loadLeaflet(); }
  catch (err) {
    if (token !== ui.crewMapToken) return;
    paintCrewMapStatus(model, mapFailureStatus({ online: deviceOnline(), reason: err && err.message }));
    return;
  }
  if (token !== ui.crewMapToken || !document.getElementById("crewmap") || !canSeeCrewMap(me)) return;
  if (!ui.crewMap) {
    ui.crewMap = L.map(el);
    const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(ui.crewMap);
    let tilesOk = false;
    const crewNow = () => crewMapModel({ locations: ui.crewLive || [], jobs: ui.crewJobs || [], today: todayStr(), now: new Date() });
    tiles.on("tileload", () => {
      const was = ui.crewTilesFailed;
      tilesOk = true;
      ui.crewTilesFailed = false;
      if (was) paintCrewMapStatus(crewNow(), null);
    });
    tiles.on("tileerror", () => {
      if (tilesOk) return;
      ui.crewTilesFailed = true;
      paintCrewMapStatus(crewNow(), mapFailureStatus({ online: deviceOnline(), reason: "tiles" }));
    });
    ui.crewLayer = L.layerGroup().addTo(ui.crewMap);
  }
  ui.crewLayer.clearLayers();
  const bounds = [];
  const seenJobs = new Set();
  for (const p of model.people) {
    if (p.sharing !== "gps" || p.lat == null) continue;
    const jobs = p.jobs.map(j => esc(j.label)).filter(Boolean).join(", ");
    L.marker([p.lat, p.lng], { icon: crewIcon(L, "#1d4ed8"), title: p.name })
      .bindPopup(`<b>${esc(p.name)}</b><br>${esc(p.lastSeen)}${p.accuracy != null ? `<br>±${p.accuracy} m` : ""}${jobs ? `<br>${jobs}` : ""}`)
      .addTo(ui.crewLayer);
    bounds.push([p.lat, p.lng]);
  }
  for (const p of model.people) {
    for (const j of p.jobs) {
      if (j.lat == null || seenJobs.has(j.id)) continue;
      seenJobs.add(j.id);
      L.marker([j.lat, j.lng], { icon: crewIcon(L, "#b45309"), title: j.label })
        .bindPopup(`<b>${esc(j.label)}</b>${j.jobNo ? `<br>#${esc(j.jobNo)}` : ""}${j.client ? `<br>${esc(j.client)}` : ""}${j.time ? `<br>${esc(j.time)}` : ""}${j.address ? `<br>${esc(j.address)}` : ""}`)
        .addTo(ui.crewLayer);
      bounds.push([j.lat, j.lng]);
    }
  }
  const key = bounds.map(b => b.map(n => Number(n).toFixed(5)).join(",")).sort().join("|");
  if (!bounds.length) ui.crewMap.setView([-27.47, 153.03], 10);
  else if (key !== ui.crewFitKey) ui.crewMap.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
  ui.crewFitKey = key;
  setTimeout(() => { if (ui.crewMap) ui.crewMap.invalidateSize(); }, 50);
  if (ui.crewTilesFailed) paintCrewMapStatus(model, mapFailureStatus({ online: deviceOnline(), reason: "tiles" }));
  else paintCrewMapStatus(model, null);
}
async function tsPunch(kind) {
  const active = tsSheets();
  if (kind === "on" && active.entry) return;
  if (kind !== "on" && !active.entry) return;
  if (!tsHasConsent(active.sheet)) { ui.tsAsk = kind; tsRerender(); return; }
  if ((ui.tsDirty || ui.tsEdit) && !confirm("Leave what you're typing and record the clock time?")) return;
  ui.tsDirty = false; ui.tsEdit = null;
  if (ui.tsBusy) return;
  ui.tsBusy = true;
  const btn = $("#tsclockon") || $("#tsclockoff") || $("#tsbrk") || $("#tsbrkend");
  if (btn) { btn.disabled = true; btn.textContent = "Checking location…"; }
  try {
    const fix = await captureFix();
    const ws = kind === "on" ? weekStartOf(todayStr()) : active.ws;
    const sheet = await tsLoad(ws, { offlineOk: true });
    const entries = { ...(sheet?.entries || {}) };
    const hm = brisbaneHM(new Date());
    if (kind === "on") {
      const prev = await tsLoad(addDays(weekStartOf(todayStr()), -7), { offlineOk: true });
      if (openClock(entries) || openClock(prev?.entries)) { toast("Clock off the open shift first"); ui.tsPrev = prev; return; }
      const id = newTsId();
      entries[id] = {
        id, source: "clock", status: "open", date: todayStr(), start: hm, finish: "", breakStart: "", breakEnd: "", note: "", job: "",
        clockOn: tsFixAt(fix), enteredBy: me.uid, enteredByName: String(me.name || "Staff").slice(0, 80), enteredAt: serverTimestamp(),
        edits: {}, lastEditId: "",
      };
      const r = await tsWrite(ws, sheet, entries, id, { consent: !(sheet && sheet.locationConsentAt) });
      liveShareStart(id, ws, fix);
      ui.tsMachineShift = id;
      ui.tsMachineWs = ws;
      toast((fix.fix === "gps" ? "Clocked on" : "Clocked on · no location") + tsQueuedNote(r));
    } else {
      const e = openClock(entries);
      if (!e) { toast("No open shift on this week"); return; }
      const next = { ...e };
      if (kind === "break-start") {
        if (e.status !== "open") return;
        next.status = "break"; next.breakStart = hm; next.breakOn = tsFixAt(fix);
      } else if (kind === "break-end") {
        if (e.status !== "break") return;
        next.status = "open"; next.breakEnd = hm; next.breakOff = tsFixAt(fix);
      } else {
        next.status = "closed"; next.finish = hm; next.clockOff = tsFixAt(fix);
        if (e.status === "break") { next.breakEnd = next.breakEnd || hm; next.breakOff = tsFixAt(fix); }
      }
      entries[e.id] = next;
      const fields = Object.keys(next).filter(k => next[k] !== e[k]);
      const r = await tsWrite(ws, sheet, entries, e.id, { consent: !(sheet && sheet.locationConsentAt), fields });
      if (kind === "off") liveShareStop(true);
      toast((kind === "off" ? (fix.fix === "gps" ? "Clocked off" : "Clocked off · no location") : "Break saved") + tsQueuedNote(r));
      ui.tsPrevFor = "";
    }
  } catch (err) {
    toast("Not saved: " + (err.code || err.message));
  } finally {
    ui.tsBusy = false;
    tsRerender();
  }
}
async function tsSaveManual(ev) {
  ev.preventDefault();
  const f = ev.target;
  const next = {
    date: f.date.value, start: f.start.value, finish: f.finish.value,
    breakStart: f.breakStart.value, breakEnd: f.breakEnd.value,
    job: f.job.value.trim().slice(0, 200), note: f.note.value.trim().slice(0, 200),
  };
  const msg = $("#tsmsg");
  if ((next.breakStart && !next.breakEnd) || (!next.breakStart && next.breakEnd)) { if (msg) msg.textContent = "Enter both break start and break end, or leave both empty"; return; }
  const ws = tsWeek();
  ui.tsBusy = true;
  let paint = true;
  try {
    const sheet = await tsLoad(ws);
    const entries = { ...(sheet?.entries || {}) };
    const legacy = String(ui.tsEdit || "").startsWith("legacy:");
    const existing = !legacy && ui.tsEdit && ui.tsEdit !== "new" ? entries[ui.tsEdit] : null;
    if (ui.tsEdit && ui.tsEdit !== "new" && !legacy && !existing) { paint = false; if (msg) msg.textContent = "That shift is not on this week"; return; }
    const needFinish = !existing || existing.source !== "clock" || existing.status === "closed";
    if (!next.start || (needFinish && !next.finish)) { paint = false; if (msg) msg.textContent = "Enter a start and a finish"; return; }
    if (existing) {
      const summary = tsDiffSummary(existing, { ...next, date: existing.source === "clock" ? existing.date : next.date });
      if (!summary) { ui.tsEdit = null; ui.tsDirty = false; toast("No change"); return; }
      const editId = newTsId();
      entries[existing.id] = {
        ...existing,
        ...next,
        date: existing.source === "clock" ? existing.date : next.date,
        edits: { ...(existing.edits || {}), [editId]: { at: serverTimestamp(), by: me.uid, byName: String(me.name || "Staff").slice(0, 80), summary } },
        lastEditId: editId,
      };
      const edited = await tsWrite(ws, sheet, entries, existing.id, {});
      ui.tsEdit = null; ui.tsDirty = false;
      toast(edited && edited.queued ? SAVED_ON_PHONE : "Shift saved");
      return;
    } else {
      const id = newTsId();
      entries[id] = {
        id, source: "manual", status: "closed", ...next,
        enteredBy: me.uid, enteredByName: String(me.name || "Staff").slice(0, 80), enteredAt: serverTimestamp(),
        edits: {}, lastEditId: "",
      };
      const created = await tsWrite(ws, sheet, entries, id, {});
      ui.tsEdit = null; ui.tsDirty = false;
      toast(created && created.queued ? SAVED_ON_PHONE : "Shift saved");
    }
  } catch (err) {
    toast("Not saved: " + (err.code || err.message));
  } finally {
    ui.tsBusy = false;
    if (paint) tsRerender();
  }
}
function bindTs(A, rerender) {
  ui.tsPaint = rerender;
  const ws = tsWeek();
  A.querySelectorAll("[data-tsw]").forEach(b => b.onclick = () => { const n = +b.dataset.tsw;
    if ((ui.tsDirty || ui.tsEdit) && !confirm("Leave this week without saving this shift?")) return;
    ui.tsDirty = false; ui.tsEdit = null; ui.tsAsk = null; ui.tsWs = n ? addDays(ws, n) : weekStartOf(todayStr()); rerender(); });
  if (tsIsAdminSheet()) {
    if (ui.tsSubWs !== ws) { ui.tsSub?.(); ui.tsSubWs = ws; ui.tsAll = null;
      const tq = query(collection(db, "timesheets"), where("companyId", "==", myCompanyId()), where("weekStart", "==", ws));
      ui.tsSub = onSnapshot(tq, s => {
        // Only this company's people. Heartwood's week list never includes other CallUp companies' staff.
        ui.tsAll = s.docs.map(x => ({ id: x.id, ...x.data() })).filter(t => docCompanyId(t) === myCompanyId() && !FOREIGN_UIDS.has(t.uid)); ui.tsAllWs = ws;
        if (myCompanyId() === "heartwood") tsFetchUnscoped(ws);
        if (!tsIsAdminSheet() || tsSnapshotBlocked()) return; rerender();
      }, e => { const w = A.querySelector(".ts-wrap"); if (w) w.innerHTML = tsNav() + `<p class="err pad">Timesheets not available: ${esc(e.code || e.message)}</p>`; }); }
  } else if (ui.tsWatchId !== `${me.uid}_${ws}`) {
    ui.tsWatch?.(); ui.tsWatchId = `${me.uid}_${ws}`; ui.tsMine = undefined;
    ui.tsWatch = onSnapshot(doc(db, "timesheets", `${me.uid}_${ws}`), s => {
      ui.tsMine = s.exists() ? { id: s.id, ...s.data() } : null;
      // The machine question belongs to an open shift. If the server says that shift is closed (clocked off on
      // another phone, or the cached screen was stale), drop the question so the real state paints.
      if (ui.tsMachineShift && !s.metadata.fromCache) {
        const e = ui.tsMine && ui.tsMine.entries && ui.tsMine.entries[ui.tsMachineShift];
        if (!e || e.status === "closed" || e.machineChoice) ui.tsMachineShift = null;
      }
      if (tsSnapshotBlocked()) return;
      if ((ui.opTab === "hours" && !ui.opSel) || (ui.view === "timesheet" && !tsIsAdminSheet())) rerender();
    }, e => { const w = A.querySelector(".ts-wrap") || A.querySelector(".pad"); if (w) w.innerHTML = tsNav() + `<p class="err pad">Timesheet not available: ${esc(e.code || e.message)}</p>`; });
  }
  const prevKey = `${me.uid}_${addDays(weekStartOf(todayStr()), -7)}`;
  if (tsWeek() === weekStartOf(todayStr())) {
    if (ui.tsPrevFor !== prevKey) { ui.tsPrevFor = prevKey;
      getDoc(doc(db, "timesheets", prevKey)).then(s => { if (ui.tsPrevFor !== prevKey) return; ui.tsPrev = s.exists() ? { id: s.id, ...s.data() } : null; if (!tsSnapshotBlocked()) rerender(); }).catch(() => {}); }
  } else { ui.tsPrev = null; ui.tsPrevFor = ""; }
  const staffSel = $("#tsstaff"); if (staffSel) staffSel.onchange = () => { ui.tsStaff = staffSel.value; rerender(); };
  const onBtn = $("#tsclockon"); if (onBtn) onBtn.onclick = () => tsPunch("on");
  const offBtn = $("#tsclockoff"); if (offBtn) offBtn.onclick = () => tsPunch("off");
  const brk = $("#tsbrk"); if (brk) brk.onclick = () => tsPunch("break-start");
  const brkEnd = $("#tsbrkend"); if (brkEnd) brkEnd.onclick = () => tsPunch("break-end");
  const agree = $("#tsagree"); if (agree) agree.onclick = () => { try { localStorage.setItem(TS_CONSENT_KEY, "1"); } catch { /* ignore */ } const kind = ui.tsAsk; ui.tsAsk = null; tsPunch(kind); };
  A.querySelectorAll(".tsmach").forEach(b => b.onclick = () => tsChooseMachine(b.dataset.asset ? "asset" : "none", b.dataset.asset ? { id: b.dataset.asset, name: b.dataset.name } : null));
  const skip = $("#tsmachskip"); if (skip) skip.onclick = () => tsChooseMachine("skip");
  A.querySelectorAll(".tsprestart").forEach(b => b.onclick = () => tsOpenPrestart(b.dataset.asset));
  const no = $("#tsno"); if (no) no.onclick = () => { ui.tsAsk = null; rerender(); };
  const add = $("#tsadd"); if (add) add.onclick = () => { if (ui.tsDirty && !confirm("Leave the week grid without saving?")) return; ui.tsEdit = "new"; ui.tsDirty = false; rerender(); };
  A.querySelectorAll(".tsedit").forEach(b => b.onclick = () => { ui.tsEdit = b.dataset.eid; ui.tsDirty = false; rerender(); });
  A.querySelectorAll(".tslegacy").forEach(b => b.onclick = () => { ui.tsEdit = "legacy:" + b.dataset.legacy; ui.tsDirty = false; rerender(); });
  const cancel = $("#tsmancancel"); if (cancel) cancel.onclick = () => { ui.tsEdit = null; ui.tsDirty = false; rerender(); };
  const man = $("#tsman"); if (man) { man.oninput = () => { ui.tsDirty = true; }; man.onsubmit = tsSaveManual; }
  if (tsIsAdminSheet()) {
    const hxg = $("#hxgo"); if (hxg) hxg.onclick = () => { hxRun(true).catch(e => { ui.hxBusy = false; ui.hxErr = "Hours spreadsheet failed: " + hxErrText(e); toast(ui.hxErr); hxPaint(); }); };
    const hxd = $("#hxdl"); if (hxd) hxd.onclick = () => { hxRun(false).catch(e => { ui.hxErr = "Download failed: " + hxErrText(e); toast(ui.hxErr); hxPaint(); }); };
    hxSubs();
    const hxc = $("#hxcsv"); if (hxc) hxc.onclick = () => downloadHoursCsv();
    A.querySelectorAll("[data-tsid]").forEach(c => { const t = (ui.tsAll || []).find(x => x.id === c.dataset.tsid); if (!t) return;
      const name = (staff.find(p => p.uid === t.uid) || {}).name || t.name || "?";
      const copy = c.querySelector(".tscopy"); if (copy) copy.onclick = async () => { const txt = tsText(t, name);
        try { await navigator.clipboard.writeText(txt); } catch { const ta = document.createElement("textarea"); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
        toast("Timesheet copied"); };
      const un = c.querySelector(".tsunsent"); if (un) un.onclick = () => updateDoc(doc(db, "timesheets", t.id), { sent: false, sentAt: null, sentBy: null }).catch(e => toast("Not saved: " + (e.code || e.message)));
    });
  }
  const f = A.querySelector("#tsf"); if (!f) return;
  const read = () => { const days = {}; f.querySelectorAll(".ts-day").forEach(r => { const g = n => r.querySelector(`[name=${n}]`).value.trim();
    const d = { start: g("start"), finish: g("finish"), note: g("note") };
    if (d.start || d.finish || d.note) days[r.dataset.ds] = d; }); return days; };
  f.oninput = () => { const days = read(); const tot = $("#tstot"); if (tot) tot.textContent = hrs(tsTotal(days));
    f.querySelectorAll(".ts-day").forEach(r => { const h = tsHours(days[r.dataset.ds]); r.querySelector(".ts-h").textContent = h ? hrs(h) : ""; }); const m = $("#tsmsg"); if (m) m.textContent = "Not saved"; ui.tsDirty = true; };
  f.onsubmit = async ev => { ev.preventDefault(); const days = read();
    for (const [ds, d] of Object.entries(days)) if ((d.start && !d.finish) || (!d.start && d.finish)) { const m = $("#tsmsg"); if (m) m.textContent = `${dmy(ds).slice(0, 5)}: enter both start and finish`; return; }
    const data = { uid: me.uid, name: String(me.name || "Staff").slice(0, 80), weekStart: ws, weekEnd: addDays(ws, 6), days, totalHrs: tsTotal(days), updatedAt: serverTimestamp(), updatedAtIso: new Date().toISOString() , ...tsCompanyField() };
    try {
      const saved = await queueWrite(setDoc(doc(db, "timesheets", `${me.uid}_${ws}`), data, { merge: true }), { id: "hours:" + ws, kind: "timesheet", label: "Hours" }, "", { announce: false });
      ui.tsMine = { ...(ui.tsMine || {}), ...data, weekStart: ws }; ui.tsDirty = false; const m = $("#tsmsg");
      if (m) m.textContent = saved && saved.queued ? SAVED_ON_PHONE : "Saved ✓";
      toast(saved && saved.queued ? SAVED_ON_PHONE : "Hours saved");
    }
    catch (e) { const m = $("#tsmsg"); if (m) m.textContent = "Not saved: " + (e.code || e.message); } };
}
// ---- Owner-only amber "to reimburse" pill (same look/behaviour as the done-today pill). Ledger + queued personally-paid
// receipts the box hasn't written to the ledger yet. Never rendered (or subscribed) for anyone but Alex's UID.
function reimbSubs() {
  if (!isOwner() || ui.rpSubs) return; ui.rpSubs = true;
  if (!ui.reimbSub) ui.reimbSub = onSnapshot(collection(db, "reimbursements"), s => { ui.reimb = s.docs.map(x => ({ id: x.id, ...x.data() })); reimbPill(); if (ui.view === "reimb") renderAdmin(); }, () => {});
  onSnapshot(query(collection(db, "receipts"), where("paidPersonally", "==", true)), s => { ui.rqueued = s.docs.map(x => ({ id: x.id, ...x.data() })).filter(r => docCompanyId(r) === "heartwood"); reimbPill(); }, () => {});
}
function owedList() {
  const led = (ui.reimb || []).filter(r => !isVeoliaSupplier(r.supplier)), ids = new Set(led.map(r => r.receiptId || r.id));
  const L = [...led.filter(r => !r.paid), ...(ui.rqueued || []).filter(r => r.status === "queued" && !ids.has(r.id) && !isVeoliaSupplier(r.supplier)).map(r => ({ ...r, date: r.createdAtIso, pending: true }))];
  return L.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}
// "Done" on a pill line: paid back to the worker. Ledger entry reimbursements/{receiptId} gets paid/reimbursed + who/when
// (created from the receipt if the box hasn't written it yet; the box keeps an existing entry and skips its "you owe" text).
// Nothing is deleted; Undo (5 s) puts paid back to false.
async function markReimbursed(r) {
  if (isVeoliaSupplier(r && r.supplier)) { toast(VEOLIA_PAID_NOTE); return; }
  if (receiptNeedsAmount(r)) { toast("Add the dollar amount before marking this paid back."); return; }
  const id = r.receiptId || r.id, ref = doc(db, "reimbursements", id), at = new Date().toISOString();
  // Pending rows are created here when the box has not written the ledger yet. Veolia never gets one.
  const ledger = r.pending ? reimbursementFromReceipt({ ...r, id, receiptId: id, paidPersonally: true }) : null;
  if (r.pending && !ledger) { toast(VEOLIA_PAID_NOTE); return; }
  const base = ledger ? { ...ledger, supplier: r.supplier || null, amountInc: receiptHasMoney(r) ? +r.amountInc : null, tonnes: r.tonnes || null, hubdocStatus: "queued", createdFrom: "pill" } : {};
  await setDoc(ref, { ...base, paid: true, reimbursed: true, paidAt: at, reimbursedAt: at, reimbursedBy: me.uid, reimbursedByName: me.name }, { merge: true });
  undoToast(`Reimbursed ${r.workerName || ""} ${$$(+r.amountInc || 0)} (${r.supplier || "receipt"})`, () =>
    setDoc(ref, { paid: false, reimbursed: false, paidAt: null, reimbursedAt: null, reimbursedBy: null, reimbursedByName: null, undoneAt: new Date().toISOString() }, { merge: true }), 5000);
}
// Read-only export of the currently owed receipts (does not touch paid status).
async function reimbCsv(L) {
  const all = [...jobs, ...(ui.undated || []), ...(ui.done || [])], q = v => `"${String(v ?? "").replace(/"/g, '""')}"`, r2 = v => (Math.round(v * 100) / 100).toFixed(2);
  const addr = r => r.address || ((r.jobId && all.find(x => x.id === r.jobId)) || (r.jobNo && all.find(x => String(jobNo(x)) === String(r.jobNo))) || {}).address || "";
  let ti = 0, tg = 0;
  const rows = [["Worker", "Date", "Supplier/Description", "Job #", "Job address", "Amount inc GST", "GST", "Amount ex GST", "Tonnes", "Status", "Receipt ID"]];
  for (const r of L) {
    const inc = receiptHasMoney(r) ? +r.amountInc : 0, g = inc / 11; ti += inc; tg += g;
    const st = receiptNeedsAmount(r) ? "needs amount" : (r.pending ? "queued" : "owed");
    rows.push([r.workerName || "", String(r.date || "").slice(0, 10), r.supplier || "", r.jobNo || "", addr(r), receiptHasMoney(r) ? r2(inc) : "", receiptHasMoney(r) ? r2(g) : "", receiptHasMoney(r) ? r2(inc - g) : "", r.tonnes || "", st, r.receiptId || r.id]);
  }
  rows.push(["TOTAL", "", `${L.length} receipt${L.length === 1 ? "" : "s"}`, "", "", r2(ti), r2(tg), r2(ti - tg), "", "", ""]);
  const csv = "\ufeff" + rows.map(x => x.map(q).join(",")).join("\r\n") + "\r\n";
  const name = `reimbursements_${new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Brisbane" })}.csv`;
  const iOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const file = new File([csv], name, { type: "text/csv" });
  if (iOS && navigator.canShare?.({ files: [file] })) return navigator.share({ files: [file], title: name });
  const url = URL.createObjectURL(file), a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function reimbPill() {
  if (ui.holdSideWork) return;
  const fw = $("#fabwrap"); let el = $("#rbpill");
  if (!fw || !isOwner()) { if (el) el.remove(); return; }
  reimbSubs();
  const L = owedList(); if (!L.length) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement("div"); el.id = "rbpill"; fw.insertBefore(el, fw.firstChild); }
  el.className = "donepill rbpill rblines";
  el.innerHTML = L.map(r => `<div role="button" tabindex="0" class="dp-head rb-line" data-rp="${esc(r.id)}" title="${esc(String(r.date || "").slice(0, 10))}${r.pending ? " · queued" : ""}${receiptNeedsAmount(r) ? " · needs amount" : ""}">
    <span class="dp-tick">🧾</span><span class="rb-t">${esc(r.workerName || "?")} · ${esc(r.supplier || "receipt")}${r.jobNo ? " · #" + esc(r.jobNo) : ""}</span><b class="rb-a">${esc(receiptNeedsAmount(r) ? ((formatReceiptMeasure(r, $$) ? formatReceiptMeasure(r, $$) + " · " : "") + "needs $") : (formatReceiptMeasure(r, $$) || $$(r.amountInc || 0)))}</b>
    ${receiptNeedsAmount(r) ? "" : `<button type="button" class="rb-done" data-rbdone="${esc(r.id)}" title="Done - paid back to ${esc(r.workerName || "worker")}" aria-label="Mark reimbursed">✓</button>`}</div>`).join("");
  const needN = L.filter(receiptNeedsAmount).length, owedN = L.filter(receiptHasMoney).length;
  el.insertAdjacentHTML("beforeend", `<button type="button" class="dp-head rb-csv" id="rbcsv"><span class="dp-tick">⬇</span><span class="rb-t">CSV · ${owedN} owed${needN ? ` · ${needN} need $` : ""}</span></button>`);
  $("#rbcsv").onclick = () => reimbCsv(L).catch(e => e?.name !== "AbortError" && toast("CSV failed: " + (e.message || e)));
  el.querySelectorAll("[data-rbdone]").forEach(b => b.onclick = ev => { ev.stopPropagation(); ev.preventDefault();
    const r = L.find(x => x.id === b.dataset.rbdone); if (r) markReimbursed(r).catch(e => toast("Not saved: " + (e.code || e.message))); });
  el.querySelectorAll("[data-rp]").forEach(b => b.onclick = () => { const r = L.find(x => x.id === b.dataset.rp) || {};
    const all = [...jobs, ...(ui.undated || []), ...(ui.done || [])];
    const j = (r.jobId && all.find(x => x.id === r.jobId)) || (r.jobNo && all.find(x => String(jobNo(x)) === String(r.jobNo)));
    if (j) editJob(j); else { ui.view = "reimb"; renderAdmin(); } });
}
// ---- Home: first screen after login. Today + tomorrow, quick counts, big buttons to the other screens.
const gmBase = () => { const box = companyMailbox(orgSettings()); return "https://mail.google.com/mail/u/" + (box ? "?authuser=" + encodeURIComponent(box) : ""); };
const jobPhotosUrl = j => gmBase() + "#search/" + encodeURIComponent(`subject:"[Job Photos]" "${jobNo(j)}"`);
const hasPhotos = j => !!(j.photosEmailedAt || j.photosEmailedCount);
const jobPhotosIcon = () => "";
const jobPhotosLink = () => "";
const emailedPhotosNote = () => "";
const greet = () => { const h = +new Intl.DateTimeFormat("en-AU", { hour: "numeric", hourCycle: "h23", timeZone: TZ }).format(new Date()); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };
function homeRow(j) {
  const q = queueOf(j), names = namesOf(j);
  const slot = ui.homePlan && ui.homePlan.get(j.id);
  const time = slot ? slot.time : (j.time || "--");
  const est = slot ? formatEstimate(slot.estHours) : "";
  return `<div class="hrow" data-id="${j.id}"><div class="htime"><b>${esc(time || "--")}</b>${est ? `<small class="est">${esc(est)}</small>` : ""}</div>
    <div class="hbody"><div class="hcl"><span class="qdot ${QCLS[q]}"></span>${esc(j.client || "")} <span class="jn">#${esc(jobNo(j))}</span>${jobPhotosIcon(j)}</div>
    <div class="sub">${esc(j.address || "-")}</div><div class="sub">${esc(firstLine(crewText(j.description)))}</div>
    <div class="sub">${names.length ? esc(names.map(label).join(", ")) : `<span class="unal">Unallocated</span>`}</div></div>
    <span class="pstack">${ipPill(j)}<span class="qpill ${QCLS[q]}">${j.status === "Done" ? "Work completed" : q}</span></span></div>`;
}
function homeLists(all, admin) {
  const t0 = todayStr(), t1 = addDays(t0, 1);
  const live = all.filter(j => j.status !== "Cancelled" && queueOf(j) !== "Unsuccessful" && (admin || (j.assigned || []).includes(me.uid)));
  const by = d => live.filter(j => j.date === d || (d === t0 && j.date && j.date < t0 && j.status === "In progress")).sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
  return { live, today: by(t0), tomorrow: by(t1), t0, t1 };
}
// ---- Monthly PROFIT chart. Not shown on Home (managers and admins see the live crew card there; supervisors and below see neither).
// Figures are Xero's Profit and Loss (cash basis, ex GST), copied by a box script
// (tools/xero_profit_sync.py) into meta/profitHistory, because the app can't call Xero itself. Nothing here is estimated.
function profHistLoad() { if (ui.profReq || !canXero()) return; ui.profReq = true;
  getDoc(doc(db, "meta", "profitHistory")).then(s => { ui.profHist = s && s.exists() ? s.data() : null; if (ui.view === "home") renderAdmin(); }).catch(() => { ui.profHist = null; }); }
function profitChartHtml() {
  if (!canXero()) return "";
  profHistLoad(); const sm = v => (v < 0 ? "−" : "") + $$(Math.abs(v));
  const t0 = todayStr().slice(0, 7), N = ui.revN || 12, mode = ui.profMode || "net", months = [];
  for (let i = N - 1; i >= 0; i--) { const d = new Date(t0 + "-01T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() - i); months.push(d.toISOString().slice(0, 7)); }
  const H = (ui.profHist && ui.profHist.months) || {}, rows = months.map(m => ({ m, d: H[m] || null }));
  setTimeout(() => { document.querySelectorAll("[data-revn]").forEach(b => b.onclick = () => { ui.revN = +b.dataset.revn; renderAdmin(); });
    document.querySelectorAll("[data-pmode]").forEach(b => b.onclick = () => { ui.profMode = b.dataset.pmode; renderAdmin(); }); });
  const seg = `<span class="seg rv-seg">${[["net", "Profit"], ["ie", "Income vs costs"]].map(([k, l]) => `<button type="button" data-pmode="${k}" class="${mode === k ? "on" : ""}">${l}</button>`).join("")}</span>
    <span class="seg rv-seg">${[6, 12].map(n => `<button type="button" data-revn="${n}" class="${N === n ? "on" : ""}">${n} mo</button>`).join("")}</span>`;
  const head = `<div class="hsec-h rv-h">Profit by month <small>net profit from Xero, ex GST</small><span class="rv-ctl">${seg}</span></div>`;
  if (!ui.profHist) return `<div class="hsec revsec">${head}<p class="sub rv-note">${ui.profReq && ui.profHist === undefined ? "Loading…" : "No Xero figures saved yet."}</p></div>`;
  const nice = v => (v < 0 ? "−" : "") + (Math.abs(v) >= 1000 ? "$" + (Math.abs(v) / 1000).toFixed(Math.abs(v) >= 100000 ? 0 : 1) + "k" : "$" + Math.round(Math.abs(v)));
  const ml = m => new Date(m + "-01T00:00:00Z").toLocaleDateString("en-AU", { month: "short", timeZone: "UTC" }) + (m.endsWith("-01") ? " " + m.slice(2, 4) : "");
  const W = 640, T = 22, B = 200, pad = 40, bw = (W - pad) / rows.length;
  const PY = m => { const d = new Date(m + "-01T00:00:00Z"); d.setUTCFullYear(d.getUTCFullYear() - 1); return H[d.toISOString().slice(0, 7)] || null; };
  const vals = rows.flatMap(r => [r.d, PY(r.m)].filter(Boolean).flatMap(d => mode === "net" ? [d.netProfit] : [d.income, d.expenses]));
  const hi = Math.max(1, ...vals), lo = Math.min(0, ...vals), y = v => T + (hi - v) / (hi - lo) * (B - 16 - T), y0 = y(0);
  const ticks = [hi, 0, ...(lo < 0 ? [lo] : [])];
  const grid = ticks.map(v => `<line x1="${pad}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="rv-g${v === 0 ? " zero" : ""}"/><text x="${pad - 4}" y="${y(v) + 4}" class="rv-y">${nice(v)}</text>`).join("");
  const py = m => { const d = new Date(m + "-01T00:00:00Z"); d.setUTCFullYear(d.getUTCFullYear() - 1); return H[d.toISOString().slice(0, 7)] || null; };
  const ghost = k => { let d = "", on = false; rows.forEach((r, i) => { const g = py(r.m); if (!g) { on = false; return; } d += `${on ? "L" : "M"}${X(i).toFixed(1)},${y(g[k]).toFixed(1)} `; on = true; }); return d; };
  const gdots = k => rows.map((r, i) => { const g = py(r.m); return g ? `<circle cx="${X(i)}" cy="${y(g[k])}" r="3" class="rv-gdot ${k}"><title>${esc(ml(r.m) + " last year: " + sm(g[k]))}</title></circle>` : ""; }).join("");
  const X = i => pad + i * bw + bw / 2, pts = rows.map((r, i) => ({ r, i, cx: X(i), cur: r.m === t0 }));
  const labs = pts.map(p => `<text x="${p.cx}" y="${B + 16}" class="rv-x">${ml(p.r.m)}${p.cur ? "*" : ""}</text>`).join("");
  const path = k => { let d = "", on = false; pts.forEach(p => { if (!p.r.d) { on = false; return; } d += `${on ? "L" : "M"}${p.cx.toFixed(1)},${y(p.r.d[k]).toFixed(1)} `; on = true; }); return d; };
  const tipOf = p => `${ml(p.r.m)}${p.cur ? " (part month)" : ""}: income ${sm(p.r.d.income)} · costs ${sm(p.r.d.expenses)} (cost of sales ${sm(p.r.d.costOfSales)}, operating ${sm(p.r.d.operatingExpenses)}) · net profit ${sm(p.r.d.netProfit)}`;
  const none = pts.filter(p => !p.r.d).map(p => `<g class="rv-b none"><title>${ml(p.r.m)}: no Xero figures</title><text x="${p.cx}" y="${y0 - 4}" class="rv-v muted">–</text></g>`).join("");
  let bars;
  const anyPy = rows.some(r => py(r.m));
  if (mode === "net") bars = `<path d="${ghost("netProfit")}" class="rv-ghost net"/>${gdots("netProfit")}<path d="${path("netProfit")}" class="rv-line net"/>` + pts.filter(p => p.r.d).map(p => { const v = p.r.d.netProfit, yy = y(v);
      return `<g class="rv-b ${v < 0 ? "neg" : "pos"} ${p.cur ? "cur" : ""}"><title>${esc(tipOf(p))}</title><circle cx="${p.cx}" cy="${yy}" r="${p.cur ? 4 : 5}" class="rv-dot"/>
        <text x="${p.cx}" y="${v < 0 ? yy + 16 : yy - 9}" class="rv-v${v < 0 ? " negt" : ""}">${nice(v)}</text></g>`; }).join("");
  else bars = `<path d="${ghost("income")}" class="rv-ghost inc"/><path d="${ghost("expenses")}" class="rv-ghost exp"/>${gdots("income")}${gdots("expenses")}<path d="${path("income")}" class="rv-line inc"/><path d="${path("expenses")}" class="rv-line exp"/>` + pts.filter(p => p.r.d).map(p =>
      `<g class="rv-b ${p.cur ? "cur" : ""}"><title>${esc(tipOf(p))}</title><circle cx="${p.cx}" cy="${y(p.r.d.income)}" r="4" class="rv-dot inc"/><circle cx="${p.cx}" cy="${y(p.r.d.expenses)}" r="4" class="rv-dot exp"/></g>`).join("");
  bars = labs + none + bars;
  const full = rows.filter(r => r.d && r.m !== t0), tot = full.reduce((a, r) => a + r.d.netProfit, 0), loss = full.filter(r => r.d.netProfit < 0).length;
  const upd = ui.profHist.updatedAt ? new Date(ui.profHist.updatedAt).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
  return `<div class="hsec revsec">${head}
    <div class="rv-wrap"><svg viewBox="0 0 ${W} ${B + 22}" class="rv-svg" role="img" aria-label="Profit by month">${grid}${bars}</svg></div>
    <p class="sub rv-key">${mode === "ie" ? `<i class="k inc"></i>Income <i class="k exp"></i>Costs (cost of sales + operating expenses) ` : ""}<i class="ln"></i>This year <i class="ln gh"></i>Last year${anyPy ? "" : " (no Xero figures for those months yet)"}${anyPy && rows.some(r => !py(r.m)) ? " · gaps = no Xero figures" : ""}</p>
    <p class="sub rv-note">From Xero Profit and Loss (cash basis, ex GST). Net profit over the ${full.length} full months shown: <b class="${tot < 0 ? "negt" : ""}">${sm(tot)}</b>${loss ? `, ${loss} month${loss === 1 ? "" : "s"} at a loss` : ""}.
      * ${ml(t0)} is part month so far.${upd ? ` Updated from Xero ${esc(upd)}.` : ""}</p></div>`;
}
// "Needs attention": each line is a count you can open to see (and tap) the jobs behind it. Admin only.
function attentionHtml(all) {
  const t0 = todayStr(), seen = new Set(), pool = [...all, ...(ui.done || [])].filter(j => !seen.has(j.id) && seen.add(j.id));
  const live = pool.filter(j => j.status !== "Cancelled" && queueOf(j) !== "Unsuccessful");
  const unal = live.filter(j => j.date && j.date >= t0 && j.status !== "Done" && !namesOf(j).length).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  const nopo = live.filter(j => !String(j.po || "").trim() && ((j.status === "Done" && !j.invoiceNo && !j.doNotInvoice && j.invoiceExcluded !== true) || (j.date && j.date >= t0 && j.date <= addDays(t0, 7)) || j.status === "In progress"));
  const incs = (ui.incidents || []).filter(r => r.status !== "Closed");
  const owed = isOwner() ? owedList() : [], dk = receiptDupKey;
  const dups = owed.filter(r => owed.filter(x => dk(x) === dk(r)).length > 1);
  const unread = canImport() && ui.inbox ? inboxUnread() : 0;
  const jl = j => `<div class="at-j" data-id="${j.id}"><b>${esc(j.date ? shortDate(j.date) : "—")}</b> ${esc(j.time || "")} · ${esc(j.address || j.client || "")} <span class="jn">#${esc(jobNo(j))}</span></div>`;
  const row = (n, txt, cls, body, go) => !n ? "" : body
    ? `<details class="at-row ${cls}"><summary><span class="at-n">${n}</span><span class="at-t">${txt}</span><span class="car">▸</span></summary><div class="at-list">${body}</div></details>`
    : `<button class="at-row at-btn ${cls}" data-go="${go}"><span class="at-n">${n}</span><span class="at-t">${txt}</span><span class="car">›</span></button>`;
  const rows = [
    row(unal.length, `job${unal.length === 1 ? "" : "s"} with no one allocated`, "red", unal.slice(0, 15).map(jl).join("")),
    row(nopo.length, `job${nopo.length === 1 ? "" : "s"} with no PO number`, "amber", nopo.slice(0, 15).map(jl).join("")),
    row(unread, `unread builder email${unread === 1 ? "" : "s"}`, "", "", "inbox"),
    row(incs.length, `open safety incident${incs.length === 1 ? "" : "s"}`, "red", incs.map(r => `<div class="at-j" data-incid="${esc(r.id)}"><b>${esc(r.reportNo || "")}</b> ${esc(r.type || "")} · ${esc(r.location || "")}</div>`).join("")),
    row(owed.length, `receipt${owed.length === 1 ? "" : "s"} to check / reimburse${dups.length ? ` · <span class="dupw">${dups.length} possible duplicate${dups.length === 1 ? "" : "s"}</span>` : ""}`, dups.length ? "amber" : "", "", "reimb")].join("");
  return `<div class="hsec attn"><div class="hsec-h">Needs attention</div>${rows || `<p class="muted pad">All clear. Nothing needs you right now.</p>`}</div>`;
}
function homePlanFor(list) {
  const map = new Map(), groups = new Map();
  for (const j of list || []) {
    if (!j || !j.date) continue;
    const key = primaryKey(j) + "|" + j.date;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(j);
  }
  const history = dispatchHistory(list);
  const settings = dispatchSettingsNow();
  for (const [key, rows] of groups) {
    const bar = key.lastIndexOf("|");
    const sheet = approvedSheet(ui.runSheets || {}, key.slice(0, bar), key.slice(bar + 1));
    for (const slot of spaceDay(rows, { settings, history, sheet })) map.set(slot.id, slot);
  }
  return map;
}
function homeBody(all, admin, btns) {
  const { live, today, tomorrow, t0, t1 } = homeLists(all, admin);
  const plan = homePlanFor([...today, ...tomorrow]);
  ui.homePlan = plan;
  const byPlan = js => js.slice().sort((a, b) => {
    const ta = (plan.get(a.id) || {}).time || a.time || "";
    const tb = (plan.get(b.id) || {}).time || b.time || "";
    return ta.localeCompare(tb) || String(a.id).localeCompare(String(b.id));
  });
  const ip = live.filter(j => j.status === "In progress").length;
  const unal = live.filter(j => j.date >= t0 && j.status !== "Done" && !namesOf(j).length).length;
  const ready = (ui.done || []).filter(j => !j.invoiceNo && j.invoiceExcluded !== true && !j.doNotInvoice).length;
  const stat = (n, l, cls, go) => `<button class="hstat ${cls}" ${go ? `data-go="${go}"` : ""}><b>${n}</b><span>${l}</span></button>`;
  const sec = (title, d, js) => `<div class="hsec"><div class="hsec-h">${title} <small>${esc(dayLabel(d))}</small> <span class="cnt">${js.length}</span></div>
    ${js.map(homeRow).join("") || `<p class="muted pad">Nothing booked for ${esc(orgSettings().name)}.</p>`}</div>`;
  return `<div class="home"><div class="hhead"><h1>${greet()}, ${esc(String(me.name || "").split(" ")[0])}</h1><div class="muted">${esc(dayLabel(t0))} · ${esc(orgSettings().name)}</div></div>
    ${admin ? COMP.adminBannerHtml() : ""}${admin ? cloudExpiryNotice(all) : ""}
    ${swmsReminderHtml()}${locationNoticeHtml()}${admin ? attentionHtml(all) + homeCrewCard() : `<div class="hbtns opbtns"><button class="hbtn inc" data-inc=""><span class="ic">⚠</span>Report incident</button><button class="hbtn" data-go="swms"><span class="ic">📋</span>SWMS</button></div>`}
    <div class="hstats hidden">${stat(today.length, "Today", "q-wo")}${stat(ip, "In progress", "ip", admin ? "q-ip" : "")}${admin ? stat(ready, "Ready to invoice", "q-comp", "invoices") + stat(unal, "Unallocated", "q-uns", "dispatch") + (canImport() && ui.inbox ? stat(inboxUnread(), "Unread builder emails", "q-inbox", "inbox") : "") : stat(tomorrow.length, "Tomorrow", "q-quote")}</div>
    <div class="hbtns hidden"><button class="hbtn inc" data-inc=""><span class="ic">⚠</span>Report incident</button>${btns.map(([go, ic, n]) => `<button class="hbtn" data-go="${go}"><span class="ic">${ic}</span>${n}</button>`).join("")}</div>
    ${sec("Today", t0, byPlan(today))}${sec("Tomorrow", t1, byPlan(tomorrow))}${admin ? "" : myIncidentsHtml()}</div>`;
}
function homeView(all) {
  return homeBody(all, true, NAV.filter(x => x[0] !== "home" && !x[3] && (x[0] === "inbox" ? canImport() : (!x[4] || isOwner()))).map(([k, ic, n]) => [k, ic, n]));
}
// Invite email status (inviteStatus/{inviteId}, written by inviteEmailWorker; office of that company may get it).
// Heartwood invites are never emailed from the app, so only other companies show the line.
const inviteMailShown = () => myCompanyId() !== "heartwood";
function staffRerender() {
  if (me && me.role === "admin" && !ui.myJobs) { if (ui.view === "staff") renderAdmin(); }
  else if ((ui.opTab || "today") === "staff") renderOperator();
}
async function readInviteMail() {
  if (!inviteMailShown()) return;
  ui.inviteMail = ui.inviteMail || {};
  const pending = (ui.invites || []).filter(r => r && r.status === "pending" && r.id);
  let changed = false;
  await Promise.all(pending.map(async r => {
    try {
      const snap = await getDoc(doc(db, "inviteStatus", r.id));
      if (!snap.exists()) return;
      const d = snap.data() || {};
      const next = { delivery: String(d.delivery || ""), reason: String(d.reason || ""), token: String(r.token || "").slice(0, 6) };
      const prev = ui.inviteMail[r.id];
      if (!prev || prev.delivery !== next.delivery || prev.reason !== next.reason || prev.token !== next.token) { ui.inviteMail[r.id] = next; changed = true; }
    } catch { /* not written yet (the rule can't read a missing doc), or offline: keep "checking" */ }
  }));
  if (changed) staffRerender();
}
// The worker writes the status a second or two after the invite is saved or resent, so look again shortly after.
function watchInviteMail() {
  if (!inviteMailShown()) return;
  ui.inviteMail = ui.inviteMail || {};
  // A resend changes the token: forget the old result so the line goes back to "checking".
  for (const r of ui.invites || []) {
    const prev = ui.inviteMail[r.id];
    if (prev && prev.token !== String(r.token || "").slice(0, 6)) { delete ui.inviteMail[r.id]; }
  }
  readInviteMail();
  clearTimeout(ui.inviteMailT1); clearTimeout(ui.inviteMailT2);
  ui.inviteMailT1 = setTimeout(readInviteMail, 3000);
  ui.inviteMailT2 = setTimeout(readInviteMail, 10000);
}
function inviteMailMap() {
  return inviteMailShown() ? (ui.inviteMail || {}) : null;
}
// Alex has no users/{uid} document. He still has a login, so the Heartwood Staff tab includes him.
function withHeartwoodOwner(rows, companyId) {
  if (companyId !== "heartwood" || (rows || []).some(u => u && u.uid === ALEX_UID)) return rows || [];
  return [{ uid: ALEX_UID, name: "Alex", role: "admin", email: "alex@heartwoodew.com", companyId: "heartwood" }, ...rows];
}
function watchStaffRoster() {
  if (!canInvite()) return () => {};
  const companyId = myCompanyId();
  const stopLive = onSnapshot(query(collection(db, ...liveCollectionPath(companyId)), where("companyId", "==", companyId)), s => {
    const map = {};
    s.docs.forEach(d => {
      const data = d.data() || {};
      map[d.id] = { clockedOn: data.clockedOn === true, sharing: data.sharing || "" };
    });
    ui.staffLive = map;
    staffRerender();
  }, () => { ui.staffLive = {}; staffRerender(); });
  const stopLogins = onSnapshot(query(collection(db, "users"), where("companyId", "==", companyId)), s => {
    const rows = s.docs.map(d => ({ ...d.data(), uid: d.id })).filter(u => docCompanyId(u) === companyId);
    ui.staffLogins = withHeartwoodOwner(rows, companyId);
    ui.staffLoginsErr = "";
    // Dispatch keeps the same bookable people as before (crew, supervisors, managers, plus Alex at Heartwood).
    if (me && me.role === "admin") {
      const bookable = rows.filter(u => CREW_ROLES.includes(u.role) || u.role === "supervisor" || u.role === "manager");
      staff = companyId === "heartwood"
        ? [{ uid: ALEX_UID, name: "Alex" }, ...bookable.filter(u => u.uid !== ALEX_UID)]
        : bookable;
    }
    staffRerender();
  }, () => {
    ui.staffLogins = withHeartwoodOwner([], companyId);
    ui.staffLoginsErr = "Some people with a login are not listed.";
    staffRerender();
  });
  return () => { stopLogins(); stopLive(); };
}
function docData(snap) {
  if (!snap || typeof snap.exists !== "function" || !snap.exists() || typeof snap.data !== "function") return null;
  return snap.data() || null;
}
function perfStop() {
  ui.perfSetUnsub?.(); ui.perfSetUnsub = null;
  ui.perfSheetUnsub?.(); ui.perfSheetUnsub = null; ui.perfSheetKey = "";
  ui.prestartPerfUnsub?.(); ui.prestartPerfUnsub = null;
  ui.take5Unsub?.(); ui.take5Unsub = null;
  ui.take5FlagUnsub?.(); ui.take5FlagUnsub = null;
  ui.perfDoneUnsub?.(); ui.perfDoneUnsub = null;
  ui.perfIncUnsub?.(); ui.perfIncUnsub = null;
}
function perfRefresh() {
  if (ui.perfTimer) return;
  ui.perfTimer = setTimeout(() => {
    ui.perfTimer = 0;
    if (document.activeElement?.closest?.("#take5form, #perfweights, #take5set, #perffrom, #perfto")) return;
    if (me && me.role === "admin" && !ui.myJobs) {
      if (ui.view === "staff" || ui.view === "safety" || ui.view === "settings") renderAdmin();
    } else if (!ui.opSel && (ui.opTab === "staff" || ui.opTab === "take5")) renderOperator();
    else if (ui.opSel) renderOperator();
  }, 30);
}
function watchTake5Flag() {
  if (!me || ui.take5FlagUnsub) return;
  ui.take5FlagUnsub = onSnapshot(doc(db, "take5Settings", myCompanyId()), s => {
    ui.take5On = take5Enabled(docData(s));
    watchTake5List();
    perfRefresh();
  }, () => { ui.take5On = true; });
  watchTake5List();
}
function perfExcludeOn() {
  if (typeof ui.perfExclude === "boolean") return ui.perfExclude;
  if (ui.perfSettings && ui.perfSettings.excludeLeaders === false) return false;
  return true;
}
function perfPeople() {
  const rows = (ui.staffLogins && ui.staffLogins.length ? ui.staffLogins : staff) || [];
  const seen = new Set();
  const out = [];
  for (const person of rows) {
    if (!person || !person.uid || seen.has(person.uid)) continue;
    seen.add(person.uid);
    out.push({ uid: person.uid, name: person.name || "Staff", role: person.role || person.staffRole || "" });
  }
  return out;
}
function perfJobs() {
  const map = new Map();
  for (const list of [jobs, ui.done, ui.undated, ui.officeJobs, ui.perfDone]) {
    for (const job of list || []) if (job && job.id && !map.has(job.id)) map.set(job.id, withMoney(job));
  }
  return [...map.values()];
}
function perfModel() {
  const period = periodBounds(ui.perfKind || "month", todayStr(), { start: ui.perfFrom || "", end: ui.perfTo || "" });
  const incidents = me && me.role === "admin" ? (ui.incidents || []) : (ui.perfIncidents || ui.incidents || []);
  const incidentState = (me && me.role === "admin" && ui.perfIncState === "ok") || ui.perfIncState === "ok" ? "ok" : "absent";
  return rankPerformance({
    people: perfPeople(),
    timesheets: ui.perfSheets || [],
    jobs: perfJobs(),
    incidents,
    leaves: ui.leave || [],
    prestarts: ui.perfPrestarts || [],
    take5s: ui.take5s || [],
    period,
    excludeLeaders: perfExcludeOn(),
    weights: (ui.perfSettings && ui.perfSettings.weights) || DEFAULT_WEIGHTS,
    take5On: ui.take5On !== false,
    sources: {
      leave: ui.leaveState === "ok" ? "ok" : "absent",
      incidents: incidentState,
      prestarts: ui.perfPreState === "ok" ? "ok" : "absent",
      timesheets: ui.perfSheetState === "ok" ? "ok" : "absent",
      take5: ui.take5On === false || ui.take5State === "ok" ? "ok" : "absent",
    },
  });
}
function ensurePerfWatch() {
  if (!canSeeStaffPerformance(me)) return;
  if (!ui.perfSetUnsub) {
    ui.perfSetUnsub = onSnapshot(doc(db, "performanceSettings", myCompanyId()), s => {
      ui.perfSettings = docData(s);
      perfRefresh();
    }, () => { ui.perfSettings = null; });
  }
  const period = periodBounds(ui.perfKind || "month", todayStr(), { start: ui.perfFrom || "", end: ui.perfTo || "" });
  const key = `${myCompanyId()}:${period.start}:${period.end}`;
  if (ui.perfSheetKey !== key) {
    ui.perfSheetUnsub?.();
    ui.perfSheetKey = key;
    ui.perfSheetState = "";
    const q = query(collection(db, "timesheets"), where("companyId", "==", myCompanyId()), where("weekStart", ">=", weekStartOf(period.start)), where("weekStart", "<=", weekStartOf(period.end)));
    ui.perfSheetUnsub = onSnapshot(q, s => {
      ui.perfSheets = s.docs.map(d => ({ id: d.id, ...d.data() }));
      ui.perfSheetState = "ok";
      if (myCompanyId() === "heartwood") fillHeartwoodSheets(period.start, period.end);
      else perfRefresh();
    }, () => { ui.perfSheets = []; ui.perfSheetState = "absent"; perfRefresh(); });
  }
  if (!ui.prestartPerfUnsub) {
    ui.prestartPerfUnsub = onSnapshot(collection(db, "tenants", myCompanyId(), "prestarts"), s => {
      ui.perfPrestarts = s.docs.map(d => ({ id: d.id, ...d.data() }));
      ui.perfPreState = "ok";
      perfRefresh();
    }, () => { ui.perfPrestarts = []; ui.perfPreState = "absent"; perfRefresh(); });
  }
  if (me.role !== "admin" && !ui.perfIncUnsub) {
    ui.perfIncUnsub = onSnapshot(query(collection(db, "incidents"), where("companyId", "==", myCompanyId())), s => {
      ui.perfIncidents = s.docs.map(d => ({ id: d.id, ...d.data() }));
      ui.perfIncState = "ok";
      perfRefresh();
    }, () => { ui.perfIncidents = []; ui.perfIncState = "absent"; perfRefresh(); });
  }
  if (me.role !== "admin" && !ui.perfDoneUnsub) {
    ui.perfDoneUnsub = onSnapshot(companyJobs([where("status", "==", "Done")]), s => {
      ui.perfDone = s.docs.map(d => withMoney({ id: d.id, ...d.data() }));
      perfRefresh();
    }, () => { ui.perfDone = []; });
  }
  watchTake5List();
}
function fillHeartwoodSheets(start, end) {
  const weeks = [];
  let week = weekStartOf(start);
  const last = weekStartOf(end);
  while (week && week <= last && weeks.length < 30) { weeks.push(week); week = addDays(week, 7); }
  const have = new Set((ui.perfSheets || []).map(sheet => sheet.id));
  const ids = [];
  for (const person of perfPeople().slice(0, 40)) {
    for (const item of weeks) {
      const id = `${person.uid}_${item}`;
      if (!have.has(id)) ids.push(id);
    }
  }
  if (!ids.length) { perfRefresh(); return; }
  Promise.all(ids.map(id => getDoc(doc(db, "timesheets", id)).catch(() => null))).then(rows => {
    const add = rows.filter(row => row && row.exists()).map(row => ({ id: row.id, ...row.data() }));
    if (add.length) ui.perfSheets = [...(ui.perfSheets || []), ...add];
    ui.perfSheetState = "ok";
    perfRefresh();
  });
}
function watchTake5List() {
  if (!me || ui.take5Unsub || !canViewTake5(me)) return;
  ui.take5Unsub = onSnapshot(query(collection(db, "take5s"), where("companyId", "==", myCompanyId())), s => {
    ui.take5s = s.docs.map(d => ({ id: d.id, ...d.data() }));
    ui.take5State = "ok";
    perfRefresh();
  }, () => { ui.take5s = []; ui.take5State = "absent"; });
}
async function savePerfDoc(patch) {
  const ref = doc(db, "performanceSettings", myCompanyId());
  const excludeLeaders = patch && typeof patch.excludeLeaders === "boolean" ? patch.excludeLeaders : perfExcludeOn();
  if (ui.perfSettings && !(patch && patch.weights)) {
    await updateDoc(ref, { excludeLeaders, updatedBy: me.uid, updatedAt: serverTimestamp() });
    return;
  }
  const weights = sanitizeWeights((patch && patch.weights) || (ui.perfSettings && ui.perfSettings.weights) || DEFAULT_WEIGHTS);
  const body = { companyId: myCompanyId(), excludeLeaders, weights, updatedBy: me.uid, updatedAt: serverTimestamp() };
  if (ui.perfSettings) await updateDoc(ref, body);
  else await setDoc(ref, body);
}
async function fileToJpeg(file) {
  if (!file) return null;
  if (file.type === "image/jpeg" && file.size <= 1200000) return file;
  const bmp = await createImageBitmap(file);
  const max = 1600;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height, 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.7));
  if (bmp.close) bmp.close();
  return blob;
}
function openTake5(job, after) {
  const v = incOverlay(take5FormHtml(job, { name: me.name || "", day: todayStr() }));
  v.querySelector("[data-x]").onclick = () => v.remove();
  v.querySelector("#take5form").onsubmit = async ev => {
    ev.preventDefault();
    const form = ev.target;
    const btn = form.querySelector(".complete");
    if (btn) btn.disabled = true;
    const id = take5IdFor(me.uid, job.id);
    let photoPath = "";
    const file = form.photo && form.photo.files && form.photo.files[0];
    if (file) {
      try {
        const blob = await fileToJpeg(file);
        photoPath = take5PhotoPath(myCompanyId(), me.uid, id);
        const metadata = { purpose: "take5", uploaderUid: me.uid, companyId: myCompanyId() };
        if (blob && !deviceOnline()) {
          const ok = await enqueueUpload({ id, kind: "take5", uid: me.uid, companyId: myCompanyId(), path: photoPath, contentType: "image/jpeg", metadata, label: "Take 5 photo", file: blob });
          if (!ok) photoPath = "";
          else rememberQueuedThumb(job.id, blob);
        } else if (blob) {
          try {
            await uploadBytes(storageRef(storage, photoPath), blob, { contentType: "image/jpeg", customMetadata: metadata });
          } catch (e) {
            if (classifyUploadError(e) !== "retry") photoPath = "";
            else {
              const ok = await enqueueUpload({ id, kind: "take5", uid: me.uid, companyId: myCompanyId(), path: photoPath, contentType: "image/jpeg", metadata, label: "Take 5 photo", file: blob });
              if (!ok) photoPath = "";
              else rememberQueuedThumb(job.id, blob);
            }
          }
        }
      } catch { photoPath = ""; }
    }
    const built = take5Payload({
      id, uid: me.uid, name: me.name, companyId: myCompanyId(), job: { id: job.id, jobNo: jobNo(job), sm8JobNo: job.sm8JobNo },
      note: form.note.value, day: todayStr(), photoPath,
      steps: { stop: form.stop.checked, look: form.look.checked, assess: form.assess.checked, control: form.control.checked, proceed: form.proceed.checked },
    });
    if (!built.ok) { if (btn) btn.disabled = false; return toast(built.reason); }
    try {
      const result = await queueWrite(setDoc(doc(db, "take5s", id), { ...built.data, createdAt: serverTimestamp() }), { id: "take5:" + id, kind: "take5", label: "Take 5" }, "", { announce: false });
      ui.take5s = [...(ui.take5s || []).filter(row => row.id !== id), { id, ...built.data }];
      v.remove();
      toast(result.queued ? SAVED_ON_PHONE : "Take 5 saved");
      if (after) await after();
    } catch (e) {
      const existing = await getDoc(doc(db, "take5s", id)).catch(() => null);
      if (existing && existing.exists() && existing.data().uid === me.uid) {
        v.remove();
        if (after) await after();
        return;
      }
      if (btn) btn.disabled = false;
      toast("Not saved: " + (e.code || e.message));
    }
  };
}
function rememberOwnTake5(job) {
  if (!job || !me) return;
  getDoc(doc(db, "take5s", take5IdFor(me.uid, job.id))).then(snap => {
    const data = docData(snap);
    if (!data) return;
    const row = { id: snap.id, ...data };
    if (hasTake5(ui.take5s, me.uid, job.id)) return;
    ui.take5s = [...(ui.take5s || []), row];
    if (ui.opSel === job.id) renderOperator();
  }).catch(() => {});
}
async function startJobDoc(job) {
  await queueWrite(updateDoc(doc(db, "jobs", job.id), { updatedAt: serverTimestamp(), updatedBy: me.uid, status: "In progress", startedAt: serverTimestamp() }), { id: "job-start:" + job.id, kind: "status", label: "Start job " + jobNo(job) }, "Started");
}
function staffPageHtml() {
  const setup = ui.tradeSetup || resolveCompanySetup({ companyId: myCompanyId() }, null);
  const perf = canSeeStaffPerformance(me) ? performancePanelHtml(perfModel(), { periodKind: ui.perfKind || "month", custom: { start: ui.perfFrom || "", end: ui.perfTo || "" }, selected: ui.perfWho || "" }) : "";
  return perf + staffViewHtml(ui.invites || [], {
    now: inviteDisplayNow(), error: ui.invitesErr || "", origin: appOriginFor(myCompanyId(), location.origin),
    emailStatus: inviteMailMap(), roles: myInviteRoles(), titles: setup.titles,
    logins: ui.staffLogins || [], companyId: myCompanyId(), loginsNote: ui.staffLoginsErr || "",
    resetPasswords: canSendPasswordReset(me), viewerUid: (me && me.uid) || "",
    remindGps: canRemindLocation(me), locations: ui.staffLive || {},
  }) + titlesEditorHtml(setup.titles, { canEdit: canEditTitles() })
    + skillsEditorHtml((me && me.cloudProfile && me.cloudProfile.skills) || [], { canEdit: true });
}
async function saveInvite(fields) {
  if (!deviceOnline()) return "offline";
  const draft = buildInviteDraft({ ...fields, createdBy: me.uid, now: new Date(), token: newInviteToken(), tenantId: myTenant() });
  if (!draft.ok) return draft.reason;
  if (!myInviteRoles().includes(draft.invite.role)) return "role";
  if (pendingInviteForEmail(ui.invites || [], draft.invite.email)) return "already-pending";
  const inviteRef = doc(collection(db, "invites"));
  const expiresAt = Timestamp.fromDate(draft.invite.expiresAt);
  const payload = { ...draft.invite, createdAt: serverTimestamp(), expiresAt };
  try {
    await runTransaction(db, async tx => {
      const lockRef = doc(db, "inviteEmails", payload.email);
      const existing = await tx.get(lockRef);
      if (existing.exists() && existing.data().status === "pending") {
        const err = new Error("already-pending");
        err.code = "already-pending";
        throw err;
      }
      tx.set(inviteRef, payload);
      tx.set(lockRef, {
        email: payload.email, status: "pending", inviteId: inviteRef.id,
        expiresAt, role: payload.role, tenantId: payload.tenantId,
      });
    });
  } catch (e) {
    if (e.code === "already-pending") return "already-pending";
    return "permission-denied";
  }
  return "";
}
// Roles this login may invite: admins all four (CallUp companies), supervisors labourer/operator/supervisor.
function myInviteRoles() {
  // me.role "admin" = rules-admin in the app (profile admin, or a Heartwood admin from the fixed list); Heartwood never gets "admin".
  const role = me && (me.role === "admin" ? "admin" : ((me.cloudProfile && me.cloudProfile.role) || me.role));
  // Heartwood: the app only treats someone as admin when the rules let them list staff (fixed list or a grant).
  return invitableRoles({ uid: me && me.uid, profile: { role }, tenantId: myTenant(), heartwoodAdmin: role === "admin" });
}
async function resendInvite(id) {
  const row = (ui.invites || []).find(item => item.id === id);
  if (!row || row.status !== "pending") return;
  if (!myInviteRoles().includes(row.role)) throw Object.assign(new Error("role"), { code: "admin-only" });
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  const token = newInviteToken();
  await runTransaction(db, async tx => {
    tx.update(doc(db, "invites", id), { token, expiresAt, resentAt: serverTimestamp(), resentBy: me.uid });
    tx.update(doc(db, "inviteEmails", row.email), { expiresAt, status: "pending" });
  });
}
async function cancelInvite(id) {
  const row = (ui.invites || []).find(item => item.id === id);
  if (!row || row.status !== "pending") return;
  await runTransaction(db, async tx => {
    tx.update(doc(db, "invites", id), { status: "cancelled", cancelledAt: serverTimestamp(), cancelledBy: me.uid });
    tx.update(doc(db, "inviteEmails", row.email), { status: "cancelled" });
  });
}
// A form that stays focused blocks the live redraw (so typing isn't wiped). After a successful save, let go of
// focus and redraw so the new invite / leave decision shows straight away instead of after a reload.
function redrawAfterSave() {
  try { document.activeElement?.blur?.(); } catch { /* ignore */ }
  if (me && me.role === "admin" && !ui.myJobs) renderAdmin(); else renderOperator();
}
function bindStaff(A) {
  if (canSeeStaffPerformance(me)) ensurePerfWatch();
  const period = A.querySelector("#perfperiod");
  if (period) period.onchange = () => { ui.perfKind = period.value; ui.perfWho = ""; ensurePerfWatch(); perfRefresh(); };
  const from = A.querySelector("#perffrom");
  const to = A.querySelector("#perfto");
  const applyCustom = () => { ui.perfFrom = from && from.value; ui.perfTo = to && to.value; ui.perfKind = "custom"; ensurePerfWatch(); perfRefresh(); };
  if (from) from.onchange = applyCustom;
  if (to) to.onchange = applyCustom;
  const exclude = A.querySelector("#perfexclude");
  if (exclude) exclude.onchange = async () => {
    ui.perfExclude = exclude.checked;
    try { await savePerfDoc({ excludeLeaders: exclude.checked }); }
    catch (e) { toast(String(e && e.code || "").includes("permission-denied") ? "Saved on this phone. The ranking choice reaches other phones once performance rules are deployed." : "Couldn't save that ranking choice."); }
    perfRefresh();
  };
  A.querySelectorAll("[data-perf]").forEach(row => row.onclick = () => { ui.perfWho = ui.perfWho === row.dataset.perf ? "" : row.dataset.perf; perfRefresh(); });
  const form = A.querySelector("#invitef");
  if (form) form.onsubmit = async ev => {
    ev.preventDefault();
    const err = A.querySelector("#inviteerr");
    const picked = form.jobTitle && form.jobTitle.selectedOptions && form.jobTitle.selectedOptions[0];
    const role = picked && picked.dataset.level ? picked.dataset.level : form.role.value;
    const reason = await saveInvite({
      name: form.name.value, email: form.email.value, role,
      jobTitle: picked && picked.dataset.name || "", jobTitleId: picked && picked.value || "",
    });
    if (reason) { if (err) err.textContent = reason === "offline" ? needsSignal("invite", false).message : inviteFailureText(reason); return; }
    form.reset();
    toast(inviteMailShown() ? "Invite saved. The list shows whether it was emailed." : "Invite saved. Copy the link. Mail was not sent.");
    redrawAfterSave();
  };
  A.querySelectorAll("[data-invite-copy]").forEach(b => b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.inviteCopy); toast(inviteMailShown() ? "Link copied." : "Link copied. Mail was not sent."); }
    catch { toast(inviteMailShown() ? "Select the link to copy it." : "Select the link to copy it. Mail was not sent."); }
  });
  A.querySelectorAll("[data-invite-resend]").forEach(b => b.onclick = async () => {
    if (!deviceOnline()) { toast(needsSignal("invite", false).message); return; }
    try { await resendInvite(b.dataset.inviteResend); toast(inviteMailShown() ? "Invite resent with a new link. The list shows whether it was emailed." : "Invite resent. Copy the new link. Mail was not sent."); }
    catch (e) { toast("Couldn't resend (" + txFail(e) + ")."); }
  });
  A.querySelectorAll("[data-invite-cancel]").forEach(b => b.onclick = async () => {
    if (!deviceOnline()) { toast(needsSignal("invite", false).message); return; }
    if (!confirm("Cancel this invite? The link will stop working.")) return;
    try { await cancelInvite(b.dataset.inviteCancel); toast("Invite cancelled."); }
    catch (e) { toast("Couldn't cancel (" + txFail(e) + ")."); }
  });
  A.querySelectorAll("[data-password-reset]").forEach(b => b.onclick = async () => {
    if (!canSendPasswordReset(me)) return;
    const name = b.dataset.passwordResetName || "them";
    if (!confirm("Email a password reset link to " + name + "? The link goes to their email. You won't see or choose the password.")) return;
    b.disabled = true;
    try {
      const result = await callAuthed("adminSendPasswordReset", { uid: b.dataset.passwordReset });
      if (result && result.reason === "google-only") toast(GOOGLE_ONLY_RESET);
      else if (result && result.ok) toast("Reset link emailed to " + name);
      else toast("Couldn't email that reset link. Try again in a minute.");
    } catch (e) {
      const msg = String((e && e.message) || "");
      toast(msg && msg.length < 180 && !/https?:/i.test(msg) ? msg : "Couldn't email that reset link. Try again in a minute.");
    } finally {
      b.disabled = false;
    }
  });
  A.querySelectorAll("[data-gps-remind]").forEach(b => b.onclick = async () => {
    if (!canRemindLocation(me)) return;
    b.disabled = true;
    try {
      const result = await callAuthed("remindLocationSharing", { uid: b.dataset.gpsRemind });
      toast((result && result.message) || "Reminder sent");
    } catch (e) {
      const msg = String((e && e.message) || "");
      toast(msg && msg.length < 180 && !/https?:/i.test(msg) ? msg : "Couldn't send that reminder. Try again in a minute.");
    } finally {
      b.disabled = false;
    }
  });
  bindProfileExtras(A);
}
function bindProfileExtras(A) {
  const root = A || document;
  const skillForm = root.querySelector("#skilladd");
  if (skillForm) skillForm.onsubmit = async ev => {
    ev.preventDefault();
    const skills = sanitizeSkills([...(me.cloudProfile && me.cloudProfile.skills || []), skillForm.skill.value]);
    try {
      await updateDoc(doc(db, "users", me.uid), { skills });
      me.cloudProfile = { ...(me.cloudProfile || {}), skills };
      toast("Saved.");
      redrawAfterSave();
    } catch (e) { toast("Couldn't save that (" + ((e && e.code) || "error") + ")."); }
  };
  root.querySelectorAll("[data-skill-remove]").forEach(b => b.onclick = async () => {
    const skills = sanitizeSkills(me.cloudProfile && me.cloudProfile.skills).filter(s => s !== b.dataset.skillRemove);
    try {
      await updateDoc(doc(db, "users", me.uid), { skills });
      me.cloudProfile = { ...(me.cloudProfile || {}), skills };
      redrawAfterSave();
    } catch (e) { toast("Couldn't save that (" + ((e && e.code) || "error") + ")."); }
  });
  const titleForm = root.querySelector("#titleadd");
  if (titleForm && canEditTitles()) titleForm.onsubmit = async ev => {
    ev.preventDefault();
    const added = addTitle((ui.tradeSetup && ui.tradeSetup.titles) || [], { name: titleForm.name.value, level: titleForm.level.value, trade: ui.tradeSetup && ui.tradeSetup.trade });
    const err = root.querySelector("#titleerr");
    if (!added.ok) { if (err) err.textContent = added.reason === "duplicate" ? "That title is already in the list." : "Enter a name and a permission level."; return; }
    try { await saveTradeSetup({ ...ui.tradeSetup, titles: added.titles }); toast("Title added."); redrawAfterSave(); }
    catch { if (err) err.textContent = "Couldn't save titles."; }
  };
  root.querySelectorAll("[data-title-rename]").forEach(b => b.onclick = async () => {
    const row = b.closest("[data-title]");
    const name = row && row.querySelector("[data-title-name]") && row.querySelector("[data-title-name]").value;
    const level = row && row.querySelector("[data-title-level]") && row.querySelector("[data-title-level]").value;
    const renamed = renameTitle(ui.tradeSetup && ui.tradeSetup.titles, b.dataset.titleRename, name);
    if (!renamed.ok) { toast(renamed.reason === "duplicate" ? "That title is already in the list." : "Enter a name."); return; }
    const leveled = setTitleLevel(renamed.titles, b.dataset.titleRename, level);
    try { await saveTradeSetup({ ...ui.tradeSetup, titles: leveled.ok ? leveled.titles : renamed.titles }); toast("Title saved."); redrawAfterSave(); }
    catch { toast("Couldn't save titles."); }
  });
  root.querySelectorAll("[data-title-remove]").forEach(b => b.onclick = async () => {
    if (!confirm("Remove this job title? People who already have it keep their permission level.")) return;
    const next = removeTitle(ui.tradeSetup && ui.tradeSetup.titles, b.dataset.titleRemove);
    if (!next.ok) return;
    try { await saveTradeSetup({ ...ui.tradeSetup, titles: next.titles }); toast("Title removed."); redrawAfterSave(); }
    catch { toast("Couldn't save titles."); }
  });
  const titlePick = root.querySelector("#invitef select[name=jobTitle]");
  const rolePick = root.querySelector("#invitef select[name=role]");
  if (titlePick && rolePick) {
    const sync = () => {
      const opt = titlePick.selectedOptions && titlePick.selectedOptions[0];
      if (opt && opt.dataset.level && [...rolePick.options].some(o => o.value === opt.dataset.level)) rolePick.value = opt.dataset.level;
    };
    titlePick.onchange = sync;
    sync();
  }
}
function take5Page() {
  if (ui.take5On === false && !(ui.take5s || []).length) {
    return `<div class="sm-head"><h1>Take 5s</h1></div><p class="pad">Take 5s are off. An admin can turn them on under Company.</p>`;
  }
  return `<div class="sm-head"><h1>Take 5s</h1></div><p class="pad sub">A Take 5 is the five-step check before work starts. Open a job and tap Start Take 5. It is also in this menu.</p>${take5ListHtml(ui.take5s || [], { empty: "No Take 5s yet. Open a job and tap Start Take 5." })}`;
}
function renderAdmin() {
  noteFirstScreen();
  if (me && !ADMIN_SAFE.has(ui.view) && !featuresOn) {
    loadFeaturePack().then(() => { if (me && me.role === "admin") renderAdmin(); });
    return;
  }
  donePill(); reimbPill(); inboxSub();
  if (!me || me.role !== "admin") return;
  if (ui.view === "invoices" && me.role !== "admin") ui.view = "home";
  PUSH.settle();
  if (ui.view === "capacity" && !canSeeCapacity()) ui.view = "home";
  if (ui.myJobs) return renderOperator();
  if ($("#dlg").open) return;          // don't redraw under an open job card
  const force = ui.forceRender; ui.forceRender = false;
  if (ui.view === "crew" && !canSeeCrewMap(me)) ui.view = "home";
  if (ui.view === "crew" && !force && document.getElementById("crewmap")) { paintCrew(); return; }
  const crewHere = canSeeCrewMap(me) && (ui.view === "crew" || ui.view === "home");
  if (!crewHere) leaveCrewScreen();
  else destroyCrewMap();
  if (!force && (ui.view === "compliance" || ui.view === "prestart") && document.querySelector("#compform, #prestartform")) return;
  if (!ui.tsForce && ui.view === "timesheet" && (ui.tsBusy || ui.tsAsk || (ui.tsMachineShift && document.getElementById("tsmachine")))) return;
  if (!ui.tsForce && ui.view === "timesheet" && (ui.tsDirty || ui.tsEdit) && ($("#tsman") || $("#tsf"))) return;
  if (ui.view === "leave" && document.activeElement?.closest?.("#leaveform, .lv-decide")) return;
  if (ui.view === "claims" && document.activeElement?.closest?.("#claimform, .rc-decide")) return;
  if (ui.view === "chat" && document.activeElement?.closest?.(".chat-compose")) return;
  if (ui.view === "staff" && document.activeElement?.closest?.("#invitef")) return;
  document.body.className = "admin";
  const fj = filtered(), und = (ui.undated || []).filter(j => jobHasType(j, ui.typeF));
  const all = [...fj, ...und.filter(u => !fj.some(j => j.id === u.id))];
  const quotesHtml = ui.view === "quotes" ? adminViewRouter(ui.view, ui, { esc, $$, staff, jobs: all, todayStr, rerender: () => renderAdmin(), canEditQuoteRates, isAdmin: () => !!(me && me.role === "admin") }) : null;
  const staffHtml = ui.view === "staff" ? staffPageHtml() : null;
  paintBrand();
  refreshAutofillLists();
  paintApp(shell(staffHtml != null ? staffHtml : ui.view === "master" ? masterView() : ui.view === "settings" ? settingsView() : ui.view === "dispatch" ? dispatchView(all) : ui.view === "capacity" ? capacityScreen() : ui.view === "invoices" ? invoicesView() : ui.view === "reimb" ? reimbView() : ui.view === "leave" ? leaveView() : ui.view === "claims" ? claimsView() : ui.view === "timesheet" ? tsView() : ui.view === "completed" ? completedView(all) : ui.view === "unscheduled" ? unscheduledView(all) : ui.view === "home" ? homeView(all) : ui.view === "compliance" || ui.view === "prestart" ? COMP.adminHtml() : ui.view === "take5" ? take5Page() : ui.view === "safety" ? safetyView() : ui.view === "swms" ? swmsView() : ui.view === "clients" ? clientsView() : ui.view === "inbox" ? inboxView(all) : ui.view === "forward" ? forwardView() : ui.view === "chat" ? CHAT.teamHtml() : ui.view === "crew" ? crewMapScreen() : quotesHtml != null ? quotesHtml : jobsView(all)));
  const A = $("#app"); inboxBadge(); bindTrialBanner(A); bindMasterReturn(A);
  CHAT.watch([...(jobs || []), ...(ui.undated || [])]);
  if (ui.view === "chat") CHAT.mount(A);
  if (ui.view === "invoices") bindInvoices(A);
  if (ui.view === "clients") bindClients(A);
  if (ui.view === "inbox") bindInbox(A);
  if (ui.view === "forward") bindForward(A);
  if (ui.view === "reimb") bindReimb(A);
  if (ui.view === "timesheet") bindTs(A, renderAdmin);
  if (ui.view === "leave") bindLeave(A);
  if (ui.view === "claims") bindClaims(A, renderAdmin);
  if (ui.view === "quotes") QG.bindAdmin({ ui, A });
  if (ui.view === "staff") bindStaff(A);
  if (ui.view === "compliance" || ui.view === "prestart") COMP.bind(A);
  if (ui.view === "settings") bindSettings(A);
  PUSH.mount(A);
  refreshDesktopBanner();
  if (ui.view === "master") bindMaster(A);
  if (!ui.holdSideWork && (ui.view === "crew" || (ui.view === "home" && homeCrewSlot(me) === "crew"))) openCrewScreen();
  A.querySelectorAll("[data-view]").forEach(b => b.onclick = () => { ui.navOpen = false;
    if (b.dataset.view === "myjobs") { ui.myJobs = true; ui.opSel = null; window.scrollTo(0, 0); return renderAdmin(); }
    if (b.dataset.view !== "compliance") COMP.abandon();
    ui.view = b.dataset.view; if ((ui.view === "invoices" && me.role !== "admin") || (ui.view === "forward" && !canForward())) ui.view = "home"; ui.forceRender = true; renderAdmin(); });
  // The menu is a deliberate tap: force the redraw, or an open Prestart/Compliance form swallows it and the admin is stuck there.
  if ($("#burger")) $("#burger").onclick = () => { ui.navOpen = !ui.navOpen; ui.forceRender = true; renderAdmin(); };
  A.querySelectorAll("[data-grp]").forEach(b => b.onclick = () => { const g = b.dataset.grp; if (NAV_GROUPS.find(x => x[0] === g)[3].includes(ui.view)) return;
    ui.navCol[g] = !ui.navCol[g]; try { localStorage.setItem("hwNavCol", JSON.stringify(ui.navCol)); } catch {} ui.forceRender = true; renderAdmin(); });
  if (ui.view === "dispatch" && PHONE.matches) bindMobileDispatch(A, [...jobs, ...(ui.undated || [])]);
  if ($("#optorder")) $("#optorder").onclick = () => ROUTE.open({ date: (PHONE.matches && ui.mday) || todayStr() });
  A.querySelectorAll("[data-cq]").forEach(b => b.onclick = () => { ui.cq = b.dataset.cq; renderAdmin(); });
  if (ui.view === "completed" && canXero()) { bindXc(A, ui.xcList); if ($("#xcall")) $("#xcall").onclick = () => { const l = ui.xcList.filter(j => !j.xeroCheckPending);
    if (l.length && confirm(`Check ${l.length} completed job${l.length === 1 ? "" : "s"} in Xero?\n\nRead-only: nothing is created or changed in Xero.`)) checkXero(l); }; }
  A.querySelectorAll("[data-q]").forEach(b => b.onclick = () => { ui.queue = b.dataset.q; renderAdmin(); });
  A.querySelectorAll("[data-dv]").forEach(b => b.onclick = () => { ui.dview = b.dataset.dv; ui.wk = 0; renderAdmin(); });
  A.querySelectorAll("[data-wk]").forEach(b => b.onclick = () => { ui.wk = +b.dataset.wk === 0 ? 0 : ui.wk + +b.dataset.wk; renderAdmin(); });
  A.querySelectorAll("[data-cap]").forEach(b => b.onclick = () => { ui.capWk = +b.dataset.cap === 0 ? 0 : (ui.capWk || 0) + +b.dataset.cap; renderAdmin(); });
  if ($("#fs")) $("#fs").onchange = e => { ui.staffF = e.target.value; renderAdmin(); };
  if ($("#ft")) $("#ft").onchange = e => { ui.typeF = e.target.value; renderAdmin(); };
  if ($("#new")) $("#new").onclick = () => editJob(null);
  if ($("#jobscsv")) $("#jobscsv").onclick = () => downloadJobsCsv(all);
  if ($("#findall")) $("#findall").onclick = async () => {
    try { await setDoc(doc(db, "meta", "findAllPos"), { status: "pending", requestedBy: me.name, requestedAt: new Date().toISOString() });
      toast("Find all POs queued - the box runs it within 2 min (6am-8pm); each job shows its result"); }
    catch (e) { toast("Not queued: " + (e.code || e.message)); } };
  const jq = $("#jq");
  if (jq) {
    jq.oninput = () => { const pos = jq.selectionStart; ui.q = jq.value; renderAdmin(); const n = $("#jq"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } };
    jq.onkeydown = e => { if (e.key === "Escape" && ui.q) { ui.q = ""; renderAdmin(); $("#jq")?.focus(); } };
  }
  if ($("#jqx")) $("#jqx").onclick = () => { ui.q = ""; renderAdmin(); $("#jq")?.focus(); };
  A.querySelectorAll("[data-sched]").forEach(b => b.onclick = ev => { ev.stopPropagation();
    const j = [...jobs, ...(ui.undated || [])].find(x => x.id === b.dataset.sched); if (!j) return;
    editJob(j); const f = $("#jf"); if (f) { f.date.value = todayStr(); f.date.focus(); f.date.showPicker?.(); } });
  A.querySelectorAll("[data-go]").forEach(b => b.onclick = () => { const v = b.dataset.go;
    if (v === "myjobs") { ui.myJobs = true; ui.opSel = null; window.scrollTo(0, 0); return renderAdmin(); }
    if (v === "q-ip") { ui.view = "jobs"; ui.queue = "All"; } else ui.view = v;
    if (ui.view !== "compliance") COMP.abandon();
    if (ui.view === "invoices" && me.role !== "admin") ui.view = "home";
    ui.navOpen = false; window.scrollTo(0, 0); ui.forceRender = true; renderAdmin(); });
  const pool = [...jobs, ...(ui.undated || [])];
  A.querySelectorAll("[data-id]").forEach(el => {
    el.onclick = ev => { if (ev.target.closest("input,button,label,textarea")) return; editJob(pool.find(j => j.id === el.dataset.id) || (ui.done || []).find(j => j.id === el.dataset.id)); };
    el.ondragstart = ev => { ev.dataTransfer.setData("text/plain", el.dataset.id + "|" + (el.closest("[data-staff]")?.dataset.staff || "")); el.classList.add("dragging"); };
    el.ondragend = () => el.classList.remove("dragging");
  });
  // iPad / touch: HTML5 drag is unreliable, so press-and-hold a board chip or unscheduled card to open the Move sheet; tap still opens the job.
  if (TOUCH.matches && !PHONE.matches) A.querySelectorAll(".dchip[data-id],.uj[data-id]").forEach(el => {
    el.draggable = false; el.ondragstart = null; let t = null, held = false;
    const clear = () => { clearTimeout(t); t = null; };
    el.addEventListener("touchstart", () => { held = false; clear(); t = setTimeout(() => { held = true; const j = pool.find(x => x.id === el.dataset.id); if (j) moveSheet(j); }, 500); }, { passive: true });
    el.addEventListener("touchmove", clear, { passive: true }); el.addEventListener("touchend", clear); el.addEventListener("touchcancel", clear);
    el.addEventListener("contextmenu", e => e.preventDefault());
    el.addEventListener("click", e => { if (held) { e.stopImmediatePropagation(); e.preventDefault(); held = false; } }, true);
  });
  A.querySelectorAll(".drop").forEach(z => {
    z.ondragover = ev => { ev.preventDefault(); z.classList.add("over"); };
    z.ondragleave = () => z.classList.remove("over");
    z.ondrop = ev => { ev.preventDefault(); z.classList.remove("over");
      const [id, from] = ev.dataTransfer.getData("text/plain").split("|"); const j = pool.find(x => x.id === id);
      if (j) dispatchMove(j, z.dataset.date, from, z.dataset.staff, z.dataset.hour); };
  });
}
// Dispatch drag: date (and optionally hour / staff row). Writes Firestore only (admin), marks editedInApp so the
// 30-min ServiceM8 import keeps the change. Nothing is written to ServiceM8.
async function dispatchMove(j, date, fromKey, toKey, hour) {
  const u = { date, editedInApp: true, updatedAt: serverTimestamp(), updatedBy: me.uid };
  if (toKey && fromKey !== toKey) {
    const find = k => staff.find(s => skey(s) === k);
    let names = namesOf(j).slice(); const from = find(fromKey), to = find(toKey);
    if (from) names = names.filter(n => n.toLowerCase() !== from.name.toLowerCase());
    if (toKey === "_none") names = []; else if (to && !names.some(n => n.toLowerCase() === to.name.toLowerCase())) names.push(to.name);
    u.assignedNames = names;
    u.assigned = names.map(n => (staff.find(s => s.name.toLowerCase() === n.toLowerCase()) || {}).uid).filter(Boolean);
  }
  // A pinned start dropped on an hour stays at that hour. An auto job uses the hour only to choose its place in the day.
  if (hour && keepsStart(j)) {
    const mm = (normaliseTime(j.time) || "00:00").slice(3);
    u.time = String(hour).padStart(2, "0") + ":" + mm;
    u.timeSource = "manual";
  }
  if (j.date === date && !u.assignedNames && !u.time && !hour) return;
  const names = u.assignedNames || namesOf(j);
  if (!confirmIfOnLeave(date, names)) return;
  const draft = {
    ...j, date,
    assigned: u.assigned || j.assigned, assignedNames: u.assignedNames || j.assignedNames,
    time: u.time || j.time, timeSource: u.timeSource || j.timeSource,
  };
  let pool = [...jobs, ...(ui.undated || [])].map(x => x.id === j.id ? draft : x);
  if (hour && !u.timeSource) pool = withSortHint(pool, j.id, hour);
  const dates = [...new Set([j.date, date].filter(Boolean))];
  const writes = planAutoTimes(pool, {
    settings: dispatchSettingsNow(), history: dispatchHistory(pool), sheets: ui.runSheets || {},
    dates,
  });
  const mine = writes.find(w => w.id === j.id);
  if (mine && !u.timeSource) Object.assign(u, { time: mine.time, timeSource: "auto", estHours: mine.estHours, estSource: mine.estSource });
  try { await updateDoc(doc(db, "jobs", j.id), u); } catch (e) { return toast("Not saved: " + (e.code || e.message)); }
  if (ui.undated) ui.undated = ui.undated.filter(x => x.id !== j.id);
  Object.assign(j, { date, ...(u.time ? { time: u.time } : {}), ...(u.timeSource ? { timeSource: u.timeSource } : {}), ...(u.estHours != null ? { estHours: u.estHours, estSource: u.estSource } : {}), ...(u.assigned ? { assigned: u.assigned, assignedNames: u.assignedNames } : {}) });
  const rest = writes.filter(w => w.id !== j.id);
  if (rest.length) queueDispatchPersist(pool.map(x => x.id === j.id ? { ...x, ...u } : x), dates);
  toast(`Rescheduled to ${shortDate(date)}${u.time ? " " + u.time : ""}${u.assignedNames ? " · " + (u.assignedNames.join(", ") || "Unallocated") : ""}`);
}
// "Remove from dispatch board": clears date/time (job goes back to Unscheduled; nothing is deleted). The next sync deletes
// this visit's staff bookings in ServiceM8 (sm8_push), not the job. Undo puts the date/time back.
async function unscheduleJob(j) {
  const prev = { date: j.date || "", time: j.time || "", timeSource: j.timeSource || "auto" };
  const u = { date: "", time: "", timeSource: "auto", editedInApp: true, unscheduledFrom: prev, unscheduledAt: new Date().toISOString(), unscheduledByName: me.name, updatedAt: serverTimestamp(), updatedBy: me.uid };
  await updateDoc(doc(db, "jobs", j.id), u);
  Object.assign(j, { date: "", time: "" }); if (ui.undated && !ui.undated.some(x => x.id === j.id)) ui.undated.push(j);
  undoToast(`#${jobNo(j)} removed from the dispatch board (now Unscheduled)`, async () => {
    await updateDoc(doc(db, "jobs", j.id), { ...prev, editedInApp: true, unscheduledFrom: null, updatedAt: serverTimestamp(), updatedBy: me.uid });
    Object.assign(j, prev); if (ui.undated) ui.undated = ui.undated.filter(x => x.id !== j.id); toast("Back on " + shortDate(prev.date)); renderAdmin(); });
  renderAdmin();
}
const armBtn = (b, label, armed, ms = 4000) => { if (b.classList.contains("arm")) return true;
  b.classList.add("arm"); const o = b.textContent; b.textContent = armed; clearTimeout(b._t);
  b._t = setTimeout(() => { b.classList.remove("arm"); b.textContent = label || o; }, ms); return false; };
async function moveJob(j, date) {
  if (!confirmIfOnLeave(date, namesOf(j))) return;
  await updateDoc(doc(db, "jobs", j.id), { date, editedInApp: true, updatedAt: serverTimestamp(), updatedBy: me.uid });
  if (ui.undated) ui.undated = ui.undated.filter(x => x.id !== j.id);
  toast(`Moved to ${dayLabel(date)}`);
}
// Split: new app job (same client/site/booking) gets the ticked lines; the original keeps the rest. The existing PO stays on
// the job whose type matches the original type. Both get a Find PO request. splitHoldUntil (10 min) keeps sm8_push off
// both so the split can be undone before it reaches ServiceM8; the push then creates the new job (source app, no sm8Uuid).
const SPLIT_COPY = ["client", "address", "contactName", "contactPhone", "date", "time", "durationHrs", "assigned", "assignedNames", "status", "notes", "clientUuid", "companyUuid"];
async function splitJob(j, pick) {
  const lines = taskLines(j.description), mv = lines.filter((_, i) => pick.includes(i)), keep = lines.filter((_, i) => !pick.includes(i));
  const kindOf = ls => { const ks = [...new Set(ls.map(x => x.k).filter(Boolean))]; return ks.length === 1 ? ks[0] : (ks[0] || "other"); };
  const newType = kindOf(mv), keepType = kindOf(keep), origType = j.type || keepType;
  const poToNew = newType === origType && keepType !== origType;
  const hold = new Date(Date.now() + 10 * 60000).toISOString(), at = new Date().toISOString(), lk = canFindPo() ? { poLookupStatus: "pending", poLookupAt: at, poLookupRequestedBy: me.name + " (split)" } : {};
  const base = Object.fromEntries(SPLIT_COPY.filter(k => j[k] !== undefined).map(k => [k, j[k]]));
  const nj = scopeRecord({ ...base, type: newType, description: mv.map(x => x.t).join("\n"), po: poToNew ? (j.po || "") : "", source: "app", log: [],
    splitFrom: j.id, splitAt: at, splitBy: me.name, splitHoldUntil: hold, editedInApp: false, ...lk, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: me.uid }, myCompanyId());
  const ref = await addDoc(collection(db, "jobs"), nj);
  // The undo copy on the job holds no money; the PO value to restore is kept on jobMoney (office only).
  const undo = { description: j.description || "", type: j.type || null, po: j.po || "", editedInApp: !!j.editedInApp };
  await writeJob(j.id, { description: keep.map(x => x.t).join("\n"), type: keepType, ...(poToNew ? { po: "", poAmount: null } : {}),
    splitTo: ref.id, splitAt: at, splitUndo: undo, splitHoldUntil: hold, editedInApp: true, ...lk,
    // Old Find PO suggestions (they carry amounts) are cleared on jobMoney, never written onto the job.
    ...(canFindPo() && canSeeMoney() ? { poLookupCandidates: [] } : {}), updatedAt: serverTimestamp(), updatedBy: me.uid });
  if (canSeeMoney()) await jobMoneyWrite(j.id, {}, { splitUndoPoAmount: j.poAmount ?? null }).catch(() => {});
  $("#dlg").close();
  undoToast(`Split #${jobNo(j)}: new ${TYPES[newType] || newType} job created${usesSm8Sync() ? " (syncs in ~10 min)" : ""}`, () => undoSplit({ ...j, splitTo: ref.id, splitUndo: undo }));
}
async function undoSplit(j) {
  const nd = await getDoc(doc(db, "jobs", j.splitTo));
  if (!nd.exists()) throw new Error(usesSm8Sync() ? "the new job has already synced, so it can't be undone here" : "the new job no longer exists");
  if (nd.data().sm8Uuid) throw new Error(usesSm8Sync() ? "the new job has already synced, so it can't be undone here" : "the new job has already been changed");
  const o = (await getDoc(doc(db, "jobs", j.id))).data() || {}, u = o.splitUndo || j.splitUndo;
  if (!u) throw new Error("no undo data");
  if (nd.exists()) await deleteDoc(doc(db, "jobs", j.splitTo));
  const m = MONEY.get(j.id) || {};
  // Older split undo copies held poAmount on the job; newer ones keep it on jobMoney.
  const pa = "poAmount" in u ? u.poAmount : ("splitUndoPoAmount" in m ? m.splitUndoPoAmount : undefined);
  await writeJob(j.id, { description: u.description, type: u.type, po: u.po, ...(pa !== undefined ? { poAmount: pa } : {}), editedInApp: u.editedInApp,
    splitTo: null, splitUndo: null, splitHoldUntil: null, updatedAt: serverTimestamp(), updatedBy: me.uid });
  if ($("#dlg").open) $("#dlg").close();
  toast("Split undone");
}
function documentActorRole() {
  if (!me) return "";
  if (me.role === "admin" || me.role === "manager" || me.role === "supervisor") return me.role;
  return (me.cloudProfile && me.cloudProfile.role) || me.role || "";
}
function wireJobDocuments(el, job) {
  if (!el || !job || !job.id || !me) return;
  mountDocuments(el, {
    job,
    role: documentActorRole(),
    companyId: myCompanyId(),
    uid: me.uid,
    uploaderName: me.name || "Staff",
    online: () => typeof navigator === "undefined" || navigator.onLine !== false,
    listen(crewOnly, onData, onError) {
      const col = collection(db, "jobs", job.id, "documents");
      const q = crewOnly ? query(col, where("visibility", "==", "crew")) : col;
      return onSnapshot(q, snap => onData(snap.docs.map(d => ({ id: d.id, ...d.data() }))), onError);
    },
    upload(planned, file, onProgress) {
      return new Promise((resolve, reject) => {
        const task = uploadBytesResumable(storageRef(storage, planned.path), file, {
          contentType: planned.contentType,
          customMetadata: planned.metadata,
        });
        task.on("state_changed", snap => {
          const pct = snap.totalBytes ? Math.round(100 * snap.bytesTransferred / snap.totalBytes) : 0;
          if (onProgress) onProgress(pct);
        }, reject, () => resolve());
      });
    },
    writeDoc(planned) {
      return setDoc(doc(db, "jobs", planned.firestore.jobId, "documents", planned.id), {
        ...planned.firestore,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    },
    rename(id, name) {
      return updateDoc(doc(db, "jobs", job.id, "documents", id), { name, updatedAt: serverTimestamp() });
    },
    async remove(row) {
      try { await deleteObject(storageRef(storage, row.storagePath)); }
      catch (e) { if (!e || e.code !== "storage/object-not-found") throw e; }
      await deleteDoc(doc(db, "jobs", row.jobId || job.id, "documents", row.id));
    },
    async open(row) {
      const blob = await getBlob(storageRef(storage, row.storagePath));
      openDocumentBlob(blob, row.name || row.fileName);
    },
    toast,
  });
}
function autofillStorage() {
  try { return localStorage; } catch { return null; }
}
function suggestionReceipts() {
  const cid = myCompanyId();
  const rows = [];
  for (const row of ui.ownReceipts || []) if (docCompanyId(row) === cid) rows.push(row);
  for (const row of ui.jobReceiptRows || []) if (docCompanyId(row) === cid) rows.push(row);
  if (isOwner() && cid === "heartwood") {
    for (const row of [...(ui.rqueued || []), ...(ui.reimb || [])]) if (docCompanyId(row) === cid) rows.push(row);
  }
  return rows.map(row => ({ companyId: cid, supplier: row.supplier, createdAt: row.createdAtIso || row.createdAt || row.date }));
}
function currentSuggestions() {
  const cid = myCompanyId();
  const uid = me && me.uid || "";
  const book = uid ? loadBook(autofillStorage(), cid, uid) : null;
  const remote = ui.emailRecipientsFor === cid ? (ui.emailRecipients || []) : [];
  return collectSuggestions({
    companyId: cid,
    uid,
    jobs: typeof loadedJobs === "function" ? loadedJobs() : (jobs || []),
    clients: CLI || [],
    receipts: suggestionReceipts(),
    claims: (ui.claims || []).filter(row => row && (!row.companyId && !row.tenantId || docCompanyId(row) === cid)).map(row => ({ companyId: cid, supplier: row.supplier, date: row.date })),
    directoryNames: CLIENTS,
    remembered: book,
    remoteEmails: remote,
    redactMoney: !canSeeMoney(),
  });
}
function refreshAutofillLists() {
  if (typeof document === "undefined" || !document.body || !me) return;
  let host = document.getElementById("autofill-lists");
  if (!host) {
    host = document.createElement("div");
    host.id = "autofill-lists";
    host.hidden = true;
    document.body.appendChild(host);
  }
  host.innerHTML = listsHtml(currentSuggestions());
}
function rememberEntries(entries) {
  if (!me || !entries) return;
  const cid = myCompanyId();
  const book = rememberBook(loadBook(autofillStorage(), cid, me.uid), {
    companyId: cid, uid: me.uid, entries, now: Date.now(),
  });
  saveBook(autofillStorage(), book);
  refreshAutofillLists();
}
function loadEmailRecipients() {
  if (!me || !canSeeMoney()) {
    ui.emailRecipients = [];
    ui.emailRecipientsFor = myCompanyId();
    return Promise.resolve([]);
  }
  const cid = myCompanyId();
  const uid = me.uid;
  return getDoc(doc(db, "companies", cid, "autofill", "recipients")).then(snap => {
    if (!me || myCompanyId() !== cid) return [];
    const remote = emailsFromRecipientDoc(snap.exists() ? snap.data() : null, cid);
    const book = loadBook(autofillStorage(), cid, uid);
    const local = (book.fields && book.fields.email || []).slice().sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0)).map(row => row.value);
    const merged = unionEmails(remote, local);
    ui.emailRecipients = merged;
    ui.emailRecipientsFor = cid;
    refreshAutofillLists();
    if (merged.length !== remote.length || merged.some((email, i) => email !== remote[i])) {
      setDoc(doc(db, "companies", cid, "autofill", "recipients"), {
        companyId: cid, emails: merged, updatedAt: serverTimestamp(), updatedBy: uid,
      }, { merge: true }).catch(() => {});
    }
    return merged;
  }).catch(() => {
    if (ui.emailRecipientsFor !== cid) ui.emailRecipients = [];
    return ui.emailRecipientsFor === cid ? (ui.emailRecipients || []) : [];
  });
}
function rememberSentEmails(addresses) {
  rememberEntries({ email: addresses });
  if (!me || !canSeeMoney()) return Promise.resolve();
  const cid = myCompanyId();
  let next = ui.emailRecipientsFor === cid ? (ui.emailRecipients || []).slice() : [];
  for (const raw of addresses || []) next = pushRecentEmail(next, raw);
  ui.emailRecipients = next;
  ui.emailRecipientsFor = cid;
  refreshAutofillLists();
  return setDoc(doc(db, "companies", cid, "autofill", "recipients"), {
    companyId: cid, emails: next, updatedAt: serverTimestamp(), updatedBy: me.uid,
  }, { merge: true }).catch(() => {});
}
function wireClientPrefill(root) {
  const form = root && root.tagName === "FORM" ? root : root && root.querySelector ? root.querySelector("form") : null;
  if (!form || !form.elements) return;
  const clientEl = form.elements.client || form.querySelector('[name="name"]');
  if (!clientEl || clientEl.dataset.afPrefill) return;
  clientEl.dataset.afPrefill = "1";
  const apply = () => {
    const client = matchClient(clientEl.value, (CLI || []).filter(row => docCompanyId(row) === myCompanyId()));
    if (!client) return;
    const read = (...names) => {
      for (const name of names) {
        const el = form.elements[name];
        if (el) return el.value;
      }
      return "";
    };
    const patch = prefillPatch({
      address: read("address"),
      suburb: read("isuburb", "suburb"),
      contactName: read("contactName", "isup"),
      phone: read("contactPhone", "phone", "iphone"),
      email: read("contactEmail", "email", "iemail"),
    }, detailsFromClient(client));
    const write = (key, names) => {
      if (!patch[key]) return;
      for (const name of names) {
        const el = form.elements[name];
        if (el && !String(el.value || "").trim()) el.value = patch[key];
      }
    };
    write("address", ["address"]);
    write("suburb", ["isuburb", "suburb"]);
    write("contactName", ["contactName", "isup"]);
    write("phone", ["contactPhone", "phone", "iphone"]);
    write("email", ["contactEmail", "email", "iemail"]);
  };
  clientEl.addEventListener("change", apply);
  clientEl.addEventListener("blur", apply);
}
function wireReviewPrefill(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('[data-field="client"]').forEach(clientEl => {
    if (clientEl.dataset.afPrefill) return;
    clientEl.dataset.afPrefill = "1";
    const id = clientEl.dataset.iid || "";
    const apply = () => {
      const client = matchClient(clientEl.value, (CLI || []).filter(row => docCompanyId(row) === myCompanyId()));
      if (!client) return;
      const field = name => root.querySelector(`[data-iid="${CSS.escape(id)}"][data-field="${name}"]`);
      const valueOf = name => { const el = field(name); return el ? el.value : ""; };
      const patch = prefillPatch({
        address: valueOf("address"),
        suburb: valueOf("suburb"),
        contactName: valueOf("supervisorName"),
        phone: valueOf("supervisorPhone"),
        email: valueOf("supervisorEmail"),
      }, detailsFromClient(client));
      const set = (name, key) => {
        if (!patch[key]) return;
        const el = field(name);
        if (el && !String(el.value || "").trim()) el.value = patch[key];
      };
      set("address", "address");
      set("suburb", "suburb");
      set("supervisorName", "contactName");
      set("supervisorPhone", "phone");
      set("supervisorEmail", "email");
    };
    clientEl.addEventListener("change", apply);
    clientEl.addEventListener("blur", apply);
  });
}
function staffSkills(job) {
  const names = new Set((job && job.assignedNames || []).map(name => String(name).toLowerCase()));
  const ids = new Set(job && job.assigned || []);
  const skills = [];
  for (const row of staff || []) {
    if (!ids.has(row.uid) && !names.has(String(row.name || "").toLowerCase())) continue;
    if (Array.isArray(row.skills)) skills.push(...row.skills);
  }
  if (me && me.cloudProfile && Array.isArray(me.cloudProfile.skills)) skills.push(...me.cloudProfile.skills);
  return skills;
}
function repeatWrite(job, form) {
  if (!me || me.role !== "admin" || !form || (!form.repeatOn && !(job && job.seriesRole === "occurrence"))) return {};
  const parsed = recurrenceFromForm(form, job);
  if (!parsed.ok) return { error: "Check how often this job repeats." };
  if (parsed.skip) return { patch: skipPatch() };
  if (job && job.seriesRole === "occurrence" && parsed.scope !== "series") return { patch: { seriesException: true } };
  if (!parsed.recurrence) {
    if (job && job.recurrence) return { patch: { recurrence: null, seriesRole: null } };
    return { patch: {} };
  }
  const seriesId = (job && job.seriesId) || newSeriesId();
  if (job && job.seriesRole === "occurrence") {
    return { patch: { recurrence: parsed.recurrence, seriesException: false }, templateId: job.templateId || "", series: parsed.recurrence };
  }
  return { patch: { recurrence: parsed.recurrence, seriesId, seriesRole: "template", seriesException: false, skipped: false } };
}
async function materialiseSeries(template) {
  if (!template || template.seriesRole !== "template" || !template.seriesId || !template.recurrence) return;
  const pool = typeof loadedJobs === "function" ? loadedJobs() : (jobs || []);
  const existing = (pool || []).filter(row => row && row.seriesId === template.seriesId);
  const plan = planSeries({ template, existing, today: todayStr() });
  for (const row of plan.creates) {
    const ref = doc(db, "jobs", row.id);
    const snap = await getDoc(ref).catch(() => null);
    if (snap && snapExists(snap)) continue;
    await setDoc(ref, scopeRecord({ ...row.data, log: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: me.uid }, myCompanyId()));
  }
  for (const row of plan.updates) {
    await updateDoc(doc(db, "jobs", row.id), { ...row.data, updatedAt: serverTimestamp(), updatedBy: me.uid });
  }
}
async function rememberSeries(jobId, data, repeat) {
  if (repeat && repeat.templateId && repeat.series) {
    await updateDoc(doc(db, "jobs", repeat.templateId), {
      recurrence: repeat.series, seriesRole: "template", updatedAt: serverTimestamp(), updatedBy: me.uid,
    }).catch(() => {});
    const snap = await getDoc(doc(db, "jobs", repeat.templateId)).catch(() => null);
    if (snap && snapExists(snap)) await materialiseSeries({ id: repeat.templateId, ...snap.data(), recurrence: repeat.series, seriesRole: "template" });
    return;
  }
  if (data.seriesRole === "template") await materialiseSeries({ ...data, id: jobId });
}
async function callCompanyFunction(name, payload) {
  const { getFunctions, httpsCallable, connectFunctionsEmulator } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js");
  const functions = getFunctions(fb, "australia-southeast1");
  if (useEmulator) connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return (await httpsCallable(functions, name)(payload)).data;
}
function certificateTrades() {
  return (ui.tradeSetup && ui.tradeSetup.enabled) || [];
}
function wireCertificate(form, job) {
  if (!form || !form.querySelector) return;
  if (!certificatesEnabled(certificateTrades())) return;
  const show = () => {
    const id = form.certTemplate && form.certTemplate.value;
    form.querySelectorAll("[data-cert-for]").forEach(el => { el.hidden = el.getAttribute("data-cert-for") !== id; });
  };
  if (form.certTemplate) { form.certTemplate.addEventListener("change", show); show(); }
  const collect = () => {
    const raw = {};
    form.querySelectorAll("[data-cert-field]").forEach(el => {
      if (el.hidden) return;
      const input = el.querySelector("input");
      raw[el.getAttribute("data-cert-field")] = input ? input.value : "";
    });
    return raw;
  };
  const save = form.querySelector("#certsave");
  if (save) save.onclick = async () => {
    const err = form.querySelector("#certerr");
    if (!certificatesEnabled(certificateTrades())) { if (err) err.textContent = "Certificates are only for pest control."; return; }
    const built = buildCertificate({ company: orgSettings(), templateId: form.certTemplate.value, raw: collect(), skills: staffSkills(job), job });
    if (!built.ok) { if (err) err.textContent = "Fill in " + built.missing.join(", ") + "."; return; }
    if (!job || !job.id) { if (err) err.textContent = "Save the job first."; return; }
    try {
      const docs = await import("./features/job-documents.js");
      const file = new File([built.pdf.bytes], built.fileName, { type: "application/pdf" });
      const planned = docs.planDocumentUpload({
        companyId: myCompanyId(), jobId: job.id, uid: me.uid, uploaderName: me.name || "Staff",
        file, visibility: built.visibility, displayName: built.template.label,
      });
      if (!planned.ok) { if (err) err.textContent = "That file was not accepted."; return; }
      await uploadBytes(storageRef(storage, planned.path), file, { contentType: "application/pdf", customMetadata: planned.metadata });
      await setDoc(doc(db, "jobs", job.id, "documents", planned.id), { ...planned.firestore, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      if (err) err.textContent = "";
      toast("Certificate saved on the job.");
    } catch (e) { if (err) err.textContent = (e && (e.message || e.code)) || "Not saved."; }
  };
  const email = form.querySelector("#certemail");
  if (email) email.onclick = async () => {
    const err = form.querySelector("#certerr");
    if (!me || me.role !== "admin") { if (err) err.textContent = "Only an admin can email a certificate."; return; }
    if (!certificatesEnabled(certificateTrades())) { if (err) err.textContent = "Certificates are only for pest control."; return; }
    const built = buildCertificate({ company: orgSettings(), templateId: form.certTemplate.value, raw: collect(), skills: staffSkills(job), job });
    if (!built.ok) { if (err) err.textContent = "Fill in " + built.missing.join(", ") + "."; return; }
    try {
      const result = await callCompanyFunction("sendCertificateEmail", {
        jobId: job.id, to: form.certEmail.value, fileName: built.fileName, pdfBase64: bytesToBase64(built.pdf.bytes),
      });
      toast(result && result.held ? "Email held. Use a callup932+ test address when sending is on." : "Certificate emailed.");
    } catch (e) { if (err) err.textContent = (e && e.message) || "Not emailed."; }
  };
}
function editJob(j) {
  if (!featuresOn) { loadFeaturePack().then(() => editJob(j)); return; }
  const importing = !!(j && j._import);
  refreshAutofillLists();
  const suggest = currentSuggestions();
  const n = !j || !j.id;
  j = j || { date: todayStr(), time: "07:00", durationHrs: 4, status: "Scheduled", type: defaultJobCategory(ui.tradeSetup), assigned: [], client: CLIENTS[0] };
  const d = $("#dlg");
  // One id per New Job form, so a second tap (or a retry after no signal) cannot make a second job.
  const newRef = n ? doc(collection(db, "jobs")) : null, guard = saveGuard();
  const qq = n ? "Work Order" : queueOf(j), hist = [];
  if (j.source === "sm8" && usesSm8Sync()) hist.push(["Import", `Imported job #${j.sm8JobNo || "?"} (${j.sm8Status || "?"})`]);
  if (j.editedInApp && usesSm8Sync()) hist.push(["App", "Edited in the app – the sync will no longer overwrite this job"]);
  if (j.inboxId) hist.push(["Inbox", "Linked to a builder email"]);
  if (j.completedByName) hist.push([j.completedByName, `Completed${j.loads ? ` · ${j.loads} loads` : ""}`]);
  const SL = { "Scheduled": "Work Order – scheduled", "In progress": "Work Order – in progress", "Done": "Completed", "Cancelled": "Unsuccessful" };
  d.className = "jobcard"; d.onclose = () => { unmountDocuments(); refreshAfterImport(); };
  d.innerHTML = `<form method="dialog" id="jf" class="jc">
    <div class="jc-top ${QCLS[qq]}"><div><div class="jc-no">${n ? "New Job" : "Job #" + esc(jobNo(j))}</div>${n ? "" : ipTop(j, "onbar")}<div class="jc-q">${qq}${j.sm8Status === "Quote" && usesSm8Sync() ? " (quote)" : ""}</div></div>
      <label class="jc-st">Job Status<select name="status">${STATUSES.map(s => `<option value="${s}" ${j.status === s ? "selected" : ""}>${SL[s]}</option>`).join("")}</select></label>
      <button value="cancel" formnovalidate class="jc-x" title="Close">✕</button></div>
    <div class="jc-body"><div class="jc-col">
      ${importing ? importBanner(j) : ""}
      <h4>Client &amp; Site</h4>
      <label>Client<input name="client" ${inputAttrs("client")} value="${esc(j.client)}" required></label>
      ${n ? "" : `<div class="supcard" data-sup="${esc(j.id)}"></div>`}
      <label>Job (site) address<input name="address" ${inputAttrs("address")} value="${esc(j.address)}" required></label>
      ${importing ? "" : `<div class="row"><label>Contact name<input name="contactName" maxlength="80" ${inputAttrs("contactName")} value="${esc(j.contactName || j.supervisorName || "")}"></label>
        <label>Phone<input name="contactPhone" maxlength="40" ${inputAttrs("phone")} value="${esc(j.contactPhone || j.supervisorPhone || "")}"></label>
        <label>Email<input name="contactEmail" maxlength="120" ${inputAttrs("email")} value="${esc(j.contactEmail || j.clientEmail || j.supervisorEmail || "")}"></label></div>`}
      ${j.address ? `<a class="sub" href="${mapsUrl(j.address)}" target="_blank" rel="noopener">📍 Open in Maps</a>` : ""}
      <h4>Job Description</h4>
      ${descriptionPickerHtml(suggest.description)}
      <textarea name="description" rows="4">${esc(j.description)}</textarea>
      ${Array.isArray(j.workAmounts) && j.workAmounts.length ? `<div class="hint"><b>Amounts from the quote</b>${workAmountsHtml(j, "det-amt")}</div>` : ""}
      ${!n && isMixed(j) ? `<div class="splitbox"><b>⚠ Mixed work:</b> ${esc(mixedKinds(j).map(k => TYPES[k] || k).join(" + "))}. Tick the lines to move to a new job:
        ${taskLines(j.description).map((x, i) => `<label class="ck"><input type="checkbox" class="spl" data-i="${i}" ${x.k && x.k !== (j.type || taskLines(j.description)[0].k) ? "checked" : ""}> ${esc(x.t)} <span class="sub">${esc(TYPES[x.k] || "?")}</span></label>`).join("")}
        <button type="button" id="splitbtn" class="btn">✂ Split into new job</button></div>` : ""}
      ${!n && j.splitTo && !j.splitSynced ? `<div class="splitbox">Split into a new job (${esc(j.splitTo)}). <button type="button" id="splitundo" class="btn">↩ Undo split</button></div>` : ""}
      <p class="hint">Spoil removal is always its own job — never add spoil to a backslab job.</p>
      <div class="row"><label>Category<select name="type">${jobCategorySelectHtml(ui.tradeSetup, j.type || "", { blank: "Choose category" })}</select></label>
        ${Array.isArray(j.types) && j.types.length > 1 ? `<p class="hint">Categories on this job: ${esc(jobTypeText(j))}.</p>` : ""}
        <label>Purchase Order #<input name="po" value="${esc(j.po)}"></label>
        <label>Loads<input type="number" min="0" name="loads" value="${esc(j.loads ?? "")}"></label></div>
      ${canSeeMoney() ? `<div class="row"><label>PO value $ (ex GST)<input type="number" step="0.01" min="0" name="poAmount" value="${esc(j.poAmount ?? "")}" placeholder="from the PO"></label></div>
      ${j.poAmount != null ? `<p class="hint">PO value $${esc(Number(j.poAmount).toFixed(2))} ex GST${j.poAmountBasis ? " · " + esc(j.poAmountBasis) : ""}${j.poAmountSource ? " · " + esc(j.poAmountSource) : ""}</p>` : ""}
      ${!n && overBy(j, invAmountDefault(j)) ? `<p class="hint"><span class="overpo">Over PO by ${$$(overBy(j, invAmountDefault(j)))}</span> (charged ${$$(invAmountDefault(j))} ex GST)</p>` : ""}
      ${n ? "" : `<div class="row"><button type="button" id="emailsupj" class="btn" title="Opens your email app (nothing is sent automatically)">✉ Email supervisor (PO exceeded)</button></div>`}` : `<input type="hidden" name="poAmount" value="${esc(j.poAmount ?? "")}">`}
      ${n || !canFindPo() ? "" : `<div class="row"><button type="button" id="findpo" class="btn">🔎 Find PO</button><span id="polk" class="sub">${poLookupHtml(j)}</span></div>`}
    </div><div class="jc-col">
      <h4>Staff Allocation &amp; Schedule</h4>
      <div class="row"><label>Date<input type="date" name="date" value="${esc(j.date)}"></label>
        <label>Start<input type="time" name="time" value="${esc(j.time)}"></label>
        <label>Hours<input type="number" step="any" min="0" max="999" inputmode="decimal" name="durationHrs" value="${esc(j.durationHrs)}"></label></div>
      <p class="sub">Change the start time to pin it. Leave it and the board spaces this job. Hours on the job do not change timesheets.</p>
      ${repeatFieldHtml(j, { admin: !!(me && me.role === "admin"), suggestion: (recurrenceHint(j.type) || {}).label || "" })}
      ${jobStepsHtml(j, ui.tradeSetup)}
      ${!n && certificatesEnabled(certificateTrades()) && me && ["admin", "supervisor", "manager"].includes(me.role) ? certificatePanelHtml(j, { trades: certificateTrades(), skills: staffSkills(j), canEmail: me.role === "admin" }) : ""}
      ${!n && j.date && !["Done", "Cancelled"].includes(j.status) ? `<div class="row"><button type="button" id="unschbtn" class="btn">✕ Remove from dispatch board</button><span class="sub">Back to Unscheduled${usesSm8Sync() ? "; the booking is removed at the next sync" : ""} (the job stays).</span></div>` : ""}
      <fieldset class="staffs">${staff.map(s => `<label class="ck"><input type="checkbox" name="assigned" value="${esc(skey(s))}" ${namesOf(j).map(x => x.toLowerCase()).includes(s.name.toLowerCase()) ? "checked" : ""}> <span class="av">${esc(s.name[0])}</span>${esc(label(s.name))}</label>`).join("")}</fieldset>
      <p id="leavewarn" class="leave-warn" hidden></p>
      <h4>Notes</h4>
      <textarea name="notes" rows="2" placeholder="Office notes">${esc(j.notes)}</textarea>
      ${!n ? `<div class="job-docs" data-job-docs="${esc(j.id)}"></div>` : ""}
      <h4>Diary</h4>
      <div class="diary">${(j.log || []).map(l => `<div class="de"><span class="av">${esc((l.byName || "?")[0])}</span><div><small>${esc(l.byName)} · ${esc(l.at)}</small><div>${esc(l.text)}</div></div></div>`).join("")}
        ${hist.map(([w, t]) => `<div class="de sys"><span class="av">i</span><div><small>${esc(w)}</small><div>${esc(t)}</div></div></div>`).join("")}
        ${!(j.log || []).length && !hist.length ? `<p class="muted sub">No diary entries yet. Site notes from staff appear here.</p>` : ""}</div>
      ${!n ? `<h4>Photos</h4><button type="button" class="sm-btn" id="emailph">Add photos</button> <span data-photoslot="${esc(j.id)}" data-photorole="cloud" data-photovariant="sm"></span> ${emailedPhotosNote(j)} <button type="button" class="sm-btn incbtn" data-inc="${j.id}">⚠ Report incident</button>${companyHasSwms() ? ` <button type="button" class="sm-btn" data-swms="${j.id}">📋 View SWMS</button>` : ""}${jobReceiptsHtml(j)}${cloudRetentionHtml(j)}` : ""}
    </div></div>
    <p id="ferr" class="err"></p>
    <div class="btns jc-foot">${n ? "" : `<button type="button" class="sm-btn" id="emailjob">Email job</button>`}${!n && take5EntryVisible({ enabled: ui.take5On !== false }) ? take5StartButtonHtml({ enabled: true, done: hasTake5(ui.take5s, me && me.uid, j.id) }) : ""}${canQuote() ? `<button type="button" class="sm-btn" id="quotethis">Quote this job</button>` : ""}<button value="cancel" formnovalidate class="sm-btn">Close</button><button value="save" class="sm-btn primary">Save Job</button></div></form>`;
  d.showModal();
  bindDescriptionPicker(d);
  wireClientPrefill(d);
  loadClients().then(() => { if (document.getElementById("jf")) refreshAutofillLists(); }).catch(() => {});
  if (!n) jobTabs(d, j);
  if (!n) { rememberJob(j); $("#emailph").onclick = () => emailPhotos(j); const emailJobBtn = $("#emailjob"); if (emailJobBtn) emailJobBtn.onclick = () => { openJobEmail(j).catch(e => toast(e.message || "Couldn't open the email")); }; watchJobPhotos(j); paintPhotoSlots(); wireJobDocuments(d.querySelector("[data-job-docs]"), j); }
  if (!n && $("#cloudexport")) $("#cloudexport").onclick = () => downloadGalleryCopy(j).catch(e => toast(e.message || "Download failed"));
  if (!n) { wireFindPo(j); supervisors(); wireJobReceipts(j); fillSupCard(j); }
  if (!n && $("#unschbtn")) $("#unschbtn").onclick = ev => { if (!armBtn(ev.currentTarget, "✕ Remove from dispatch board", "Tap again to remove from the board")) return;
    d.close(); unscheduleJob(j).catch(e => toast("Not removed: " + (e.code || e.message))); };
  if (!n) $("#emailsupj").onclick = () => emailSupervisor({ ...j, po: $("#jf").po.value.trim() || j.po, poAmount: $("#jf").poAmount.value === "" ? j.poAmount : +$("#jf").poAmount.value }, invAmountDefault(j)).catch(e => toast(e.message));
  if (!n && $("#splitbtn")) $("#splitbtn").onclick = ev => { const b = ev.currentTarget;
    const lines = taskLines(j.description), pick = [...d.querySelectorAll(".spl")].filter(c => c.checked).map(c => +c.dataset.i);
    if (!pick.length || pick.length === lines.length) return toast("Tick some (not all) lines to move");
    if (!b.classList.contains("arm")) { b.classList.add("arm"); b.textContent = `Tap again: move ${pick.length} line(s) to a new job`; clearTimeout(b._t);
      b._t = setTimeout(() => { b.classList.remove("arm"); b.textContent = "✂ Split into new job"; }, 5000); return; }
    splitJob(j, pick).catch(e => toast("Not split: " + (e.code || e.message))); };
  if (!n && $("#splitundo")) $("#splitundo").onclick = () => undoSplit(j).catch(e => toast("Undo failed: " + (e.code || e.message)));
  const f = $("#jf");
  wireRepeatBox(f);
  if (f.time) f.time.addEventListener("input", () => { f.time.dataset.touched = "1"; });
  f.description.oninput = () => {
    if (!(n && !importing)) return;
    const guessed = guessType(f.description.value);
    const primary = (ui.tradeSetup && ui.tradeSetup.enabled && ui.tradeSetup.enabled[0]) || "earthworks";
    if (guessed === "other" && primary !== "earthworks") return;
    if (TYPES[guessed]) f.type.value = guessed;
  };
  const startTake = $("#starttake5");
  if (startTake) startTake.onclick = () => openTake5(j);
  const quoteThis = $("#quotethis");
  if (quoteThis) quoteThis.onclick = () => {
    const drafted = { ...j, client: f.client.value.trim(), address: f.address.value.trim(), type: f.type.value, description: f.description.value.trim() };
    d.onclose = null;
    d.close();
    queueMicrotask(() => QG.openQuoteWizard && QG.openQuoteWizard(null, { job: drafted }));
  };
  if (importing) wireImportForm(j, f);
  wireCertificate(f, j);
  f.addEventListener("change", () => refreshJobLeaveWarn(f));
  refreshJobLeaveWarn(f);
  f.onsubmit = async ev => {
    if (ev.submitter?.value !== "save") return;
    ev.preventDefault();
    const typ = f.type.value, ds = f.description.value.toLowerCase();
    if (!typ) { $("#ferr").textContent = "Choose a category."; f.type.focus(); return; }
    if (typ === "backslab" && ds.includes("spoil")) { $("#ferr").textContent = "Spoil removal must be a separate job. Remove it from this backslab and create a Spoil removal job."; return; }
    if (typ === "spoil" && /back ?slab|slab clean|back blade/.test(ds)) { $("#ferr").textContent = "Backslab work must be a separate job from spoil removal."; return; }
    const picked = [...f.querySelectorAll("[name=assigned]:checked")].map(x => staff.find(s => skey(s) === x.value)).filter(Boolean);
    const assigned = picked.filter(s => s.uid).map(s => s.uid);
    const timeTouched = f.time.dataset.touched === "1";
    const data = { client: f.client.value.trim(), address: f.address.value.trim(), type: typ, po: f.po.value.trim().toUpperCase().replace(/\s+/g, ""),
      description: f.description.value.trim(), date: f.date.value, time: f.time.value, durationHrs: parseHoursInput(f.durationHrs.value),
      timeSource: timeTouched || isManualStart(j) ? "manual" : "auto",
      assigned, assignedNames: picked.map(s => s.name), status: f.status.value, notes: f.notes.value.trim(),
      loads: f.loads.value === "" ? null : +f.loads.value, editedInApp: true,
      ...(String(j.poAmount ?? "") !== f.poAmount.value ? { poAmount: f.poAmount.value === "" ? null : Math.round(+f.poAmount.value * 100) / 100, poAmountBasis: f.poAmount.value === "" ? null : "entered in app (ex GST)", poAmountSource: "app" } : {}), updatedAt: serverTimestamp(), updatedBy: me.uid };
    if (f.contactName) Object.assign(data, {
      contactName: f.contactName.value.trim(),
      contactPhone: f.contactPhone.value.trim(),
      contactEmail: f.contactEmail.value.trim(),
      supervisorName: f.contactName.value.trim(),
      supervisorEmail: f.contactEmail.value.trim(),
    });
    if (data.status === "Done" && j.status !== "Done") Object.assign(data, { completedAt: serverTimestamp(), completedBy: me.uid });
    const repeat = repeatWrite(j, f);
    if (repeat.error) { $("#ferr").textContent = repeat.error; return; }
    Object.assign(data, repeat.patch || {});
    if (!confirmIfOnLeave(data.date, data.assignedNames)) return;
    if (!guard.start()) return;
    const saveBtn = f.querySelector("button[value=save]");
    if (saveBtn) saveBtn.disabled = true;
    try {
      if (importing && !canImport()) { $("#ferr").textContent = "Supervisors and admins only."; return; }
      if (importing) {
        const cur = (ui.inbox || []).find(m => m.id === j._import.emailId);
        if (!cur) { $("#ferr").textContent = "That email is no longer in the inbox."; return; }
        if (isImported(cur)) { $("#ferr").textContent = "That email is already imported."; return; }
      }
      let write;
      if (n) {
        const extra = importing ? importFieldExtras(j, f) : {};
        const sp = splitJobMoney(data);
        write = setDoc(newRef, scopeRecord({ ...sp.job, ...extra, source: importing ? "inbox" : "app", log: [], createdAt: serverTimestamp() }, myCompanyId()));
        if (sp.hasMoney) write = Promise.all([write, jobMoneyWrite(newRef.id, sp.money)]);
        if (importing) write = write.then(() => markInboxImported(j._import.emailId, newRef.id));
      } else write = writeJob(j.id, data);
      const r = await settleOrQueue(write);
      if (r.queued) write.catch(e => toast("Job not saved: " + (e.code || e.message)));
      rememberEntries({
        client: data.client,
        address: data.address,
        description: data.description,
        contactName: f.contactName ? f.contactName.value : (f.isup && f.isup.value),
        phone: f.contactPhone ? f.contactPhone.value : (f.iphone && f.iphone.value),
        email: f.contactEmail ? f.contactEmail.value : (f.iemail && f.iemail.value),
        supervisor: (f.isup && f.isup.value) || (f.contactName && f.contactName.value),
        suburb: f.isuburb && f.isuburb.value,
      });
      d.close(); toast(r.queued ? "Saved on this phone. It uploads when you have signal." : "Saved"); refreshAfterImport();
      const savedId = (j && j.id) || (newRef && newRef.id);
      if (!r.queued) rememberSeries(savedId, data, repeat).catch(() => {});
      queueDispatchPersist([...(jobs || []).filter(x => x.id !== savedId), { ...j, ...data, id: savedId }], [data.date, j && j.date].filter(Boolean));
      if (!data.date && !r.queued) location.reload();
    } catch (e) { $("#ferr").textContent = e.message; }
    finally { guard.end(); if (saveBtn) saveBtn.disabled = false; }
  };
}

function jobTabs(d, j) {
  const f = d.querySelector("#jf"), top = f.querySelector(".jc-top"), body = f.querySelector(".jc-body");
  const names = namesOf(j), q = queueOf(j);
  const st = j.status === "Done" ? `<span class="qpill q-comp">Work completed</span>` : j.status === "In progress" ? ipPill(j) || `<span class="qpill ip">In progress</span>` : `<span class="qpill ${QCLS[q]}">${esc(q)}</span>`;
  top.insertAdjacentHTML("afterend", `<div class="jc-facts">
    <div class="kf kf-addr"><small>Address</small><b>${j.address ? `<a href="${mapsUrl(j.address)}" target="_blank" rel="noopener">📍 ${esc(j.address)}</a>` : "—"}</b><span class="sub">${esc(j.client || "")}</span></div>
    <div class="kf"><small>When</small><b>${j.date ? esc(shortDate(j.date)) : "Unscheduled"}</b><span class="sub">${esc(j.time || "")}${j.durationHrs ? " · " + esc(j.durationHrs) + "h" : ""}</span></div>
    <div class="kf"><small>Staff</small><b>${names.length ? esc(names.map(label).join(", ")) : `<span class="unal">Unallocated</span>`}</b></div>
    <div class="kf"><small>PO</small><b>${j.po ? esc(j.po) : `<span class="nopo">No PO</span>`}</b></div>
    <div class="kf"><small>Status</small><b class="pstack">${st}</b></div>${canXero() && q === "Completed" ? `<div class="kf kf-xero"><small>Xero</small><b>${xcCell(j)}</b></div>` : ""}</div>
    <div class="jc-tabs" role="tablist">${[["details", "Details"], ["chat", "Chat"], ["photos", "Photos"], ["sup", "Supervisor"], ["safety", "Safety"], ["hist", "History"]].map(([k, l]) => `<button type="button" role="tab" data-jt="${k}">${l}${k === "chat" ? CHAT.badge("job_" + j.id) : ""}</button>`).join("")}</div>`);
  const pane = k => { const x = document.createElement("div"); x.className = "jc-pane"; x.dataset.pane = k; return x; };
  const P = { details: pane("details"), chat: pane("chat"), photos: pane("photos"), sup: pane("sup"), safety: pane("safety"), hist: pane("hist") };
  const cols = [...body.querySelectorAll(".jc-col")];
  const detL = document.createElement("div"), detR = document.createElement("div"); detL.className = detR.className = "jc-col";
  cols.forEach((c, ci) => { let sec = "details";
    [...c.children].forEach(el => { if (el.tagName === "H4") { const t = el.textContent.toLowerCase(); sec = t.startsWith("diary") ? "hist" : (t.startsWith("photos") || t.startsWith("receipts")) ? "photos" : "details"; }
      (sec === "details" ? (ci ? detR : detL) : P[sec]).appendChild(el); }); });
  const det = document.createElement("div"); det.className = "jc-body2"; det.append(detL, detR); P.details.appendChild(det);
  const sup = detL.querySelector(".supcard"); if (sup) P.sup.appendChild(sup);
  const es = det.querySelector("#emailsupj"); if (es) P.sup.appendChild(es.closest(".row"));
  P.sup.insertAdjacentHTML("afterbegin", `<h4>Supervisor</h4>`);
  P.photos.querySelectorAll(".incbtn,[data-swms]").forEach(x => x.remove());
  const incs = (ui.incidents || []).filter(r => r.jobId === j.id || (r.jobNo && String(r.jobNo) === String(jobNo(j))));
  P.safety.innerHTML = `<h4>Safety</h4><div class="safebtns">${companyHasSwms() ? `<button type="button" class="sm-btn" data-swms="${j.id}">📋 View SWMS</button>` : ""}<button type="button" class="sm-btn incbtn" data-inc="${j.id}">⚠ Report incident on this job</button></div>
    <h4>Incidents on this job</h4>${incs.map(r => `<div class="at-j" data-incid="${esc(r.id)}"><b>${esc(r.reportNo || "")}</b> ${esc(r.type || "")} · <span class="qpill ${incCls(r)}">${esc(r.status)}</span></div>`).join("") || `<p class="muted sub">None reported.</p>`}`;
  if (!P.hist.children.length) P.hist.innerHTML = `<p class="muted sub">No history yet.</p>`;
  P.chat.innerHTML = CHAT.jobHtml(j);
  body.innerHTML = ""; body.classList.add("tabbed"); Object.values(P).forEach(x => body.appendChild(x));
  const show = k => { ui.jtab = k; f.querySelectorAll("[data-jt]").forEach(b => b.classList.toggle("on", b.dataset.jt === k)); Object.entries(P).forEach(([kk, x]) => x.hidden = kk !== k); if (k === "photos") queuePhotoThumbs(f); if (k === "chat") CHAT.openJob(P.chat, j); };
  // v47: facts + tabs + panes share ONE scroll area (phones); display:contents elsewhere so iPad/desktop are unchanged
  if (!f.querySelector(".jc-scroll")) { const sc = document.createElement("div"); sc.className = "jc-scroll";
    f.insertBefore(sc, f.querySelector(".jc-facts")); sc.append(f.querySelector(".jc-facts"), f.querySelector(".jc-tabs"), body); }
  f.querySelectorAll("[data-jt]").forEach(b => b.onclick = () => show(b.dataset.jt));
  if (canXero()) bindXc(f, [j]);
  const openChat = ui.openJobChat && !n;
  ui.openJobChat = false;
  show(openChat ? "chat" : "details");
}
// ------------------------------------------------------------------ invoicing (admin only)
// Invoice fields live on the job doc: invoiceNo (text), invoiceDescription, invoiceContact,
// invoiceDate (YYYY-MM-DD = job date, like hwdata.py), numberedAt/By, invoiced (bool), invoicedAt/By.
// The price (invoiceAmount, ex GST) is office only: it lives on jobMoney/{jobId} (crew can read the job doc) and office
// lists see it merged in by withMoney; a legacy copy still on the job is the fallback until the migration moves it.
// Numbers: max(meta/invoicing.lastNo, meta/boxInvoiceMax.max (written by tools/export_completed.py from
// completed.json), every job invoiceNo, 5402) + 1, assigned inside a Firestore transaction.
const INV_FLOOR = 5402;                  // last number used on the planner's Completed sheet / completed.json (10/10/2026)
const XERO_COLS = ["*ContactName", "EmailAddress", "POAddressLine1", "*InvoiceNumber", "Reference", "*InvoiceDate", "*DueDate",
  "InventoryItemCode", "*Description", "*Quantity", "*UnitAmount", "Discount", "*AccountCode", "*TaxType", "Currency"];
const STD_CLIENTS = ["Orbit Homes (Qld) Pty Ltd", "Torsion Built Pty Ltd", "Silkwood Homes", "OJ Pippin Homes", "Envision Homes"];
function refreshClientLists() {
  const org = orgSettings();
  CLIENTS.splice(0, CLIENTS.length, ...companyClientNames(org, CLI || []));
  STD_CLIENTS.splice(0, STD_CLIENTS.length, ...companyStdClients(org, CLI || []));
}
const INV_TASK = { spoil: "Spoil removal", backslab: "Backslab", clean: "Site clean" };
const ABBR = { street: "St", court: "Crt", circuit: "Cct", crescent: "Cres", avenue: "Ave", road: "Rd", drive: "Dr", place: "Pl", lane: "Lane", parade: "Pde", terrace: "Tce" };
function tidyAddress(a) {          // port of hwdata.tidy_address
  if (!a) return "";
  let s = a.replace(/[\t\r\n"]+/g, " ").replace(/^[ ,]+|[ ,]+$/g, "");
  s = s.replace(/\b(?:QLD|Qld|qld)\s*\d{4}\s*$/, "").replace(/^[ ,]+|[ ,]+$/g, "");
  s = s.replace(/\blot\s*no\.?\s*(\d+\w?)\s*,?\s*st\s*no\.?\s*(\d+\w?)\s*,?/gi, "Lot $1 ($2) ");
  s = s.replace(/\blot\s*(\d)/gi, "Lot $1").replace(/\s+/g, " ").replace(/^[ ,]+|[ ,]+$/g, "");
  s = s.split(" ").map(w => { const core = w.replace(/[^A-Za-z]/g, "");
    if (!core || core === "QLD" || core === "NSW" || !(core === core.toUpperCase() || core === core.toLowerCase())) return w;
    return w.replace(/[A-Za-z]+/, m => m[0].toUpperCase() + m.slice(1).toLowerCase()); }).join(" ");
  s = s.replace(/\b(Street|Court|Circuit|Crescent|Avenue|Road|Drive|Place|Parade|Terrace)\b(?!,)\s+([A-Z][a-z]+)/g, (m, t, sub) => `${ABBR[t.toLowerCase()] || t}, ${sub}`);
  s = s.replace(/\b(Street|STREET)\b,/g, "St,");
  return s.replace(/^[ ,]+|[ ,]+$/g, "");
}
const isRealPo = p => !!p && /\d{4,}/.test(p) && !/REMOVED|M3/i.test(p);
const invContact = j => j.invoiceContact || (/^private( job)?$/i.test(j.client || "") ? tidyAddress(j.address).replace(/,/g, "") + " (private)" : (j.client || ""));
function invDescDefault(j) {        // hwdata.xero_description: "<Task> - <tidy address> (N hrs)"; hours only on spoil (export_completed)
  let t = INV_TASK[j.type] || (j.description || "Job").trim(); t = t[0].toUpperCase() + t.slice(1);
  let s = j.address ? `${t} - ${tidyAddress(j.address)}` : t;
  if (j.type === "spoil" && j.durationHrs) s += ` (${+j.durationHrs} hrs)`;
  return s;
}
// hwdata.py has no per-m³ / per-load rule (spoil has been priced by hours, e.g. 4 hrs = $2000), so no price is guessed.
// PO value (poAmount, ex GST, from the builder's PO) pre-fills the price until one is typed (invoiceAmount wins).
// ---- Find PO: the button flags the job (poLookupStatus 'pending'); the box worker tools/po_lookup.py (cron, 2 min,
// 6am-8pm) searches saved PO PDFs / Gmail hits and writes the status onto the job doc. The suggestions list
// (poLookupCandidates, with PO amounts) lives on the office-only jobMoney/{jobId}; a legacy list on the job is a fallback.
const PO_ST = { "orbit login needed": "🔒 Orbit login needed", pending: "⏳ queued", searching: "🔍 searching", found: "✅ found", choose: "☝️ pick one", "not found": "❌ not found", "needs portal": "🌐 needs Orbit portal" };
function poLookupHtml(j) {
  if (!j.poLookupStatus) return "";
  const cands = (j.poLookupCandidates || []).map((c, i) => `<div class="pocand">${esc(c.po)}${c.kind ? " · " + esc(c.kind) : ""}${canSeeMoney() && c.amount != null ? ` · $${esc(Number(c.amount).toFixed(2))} ex GST` : (c.amount != null ? "" : " · no amount")}${c.confidence ? ` <span class="conf conf-${esc(c.confidence)}">${esc(c.confidence)}</span>` : ""}<div class="sub">Source: ${esc(c.source || "?")}</div>
      ${j.po === c.po && j.poAmount === c.amount ? "" : `<button type="button" class="btn usepo" data-i="${i}">Use this</button>`}</div>`).join("");
  return `<b>${PO_ST[j.poLookupStatus] || esc(j.poLookupStatus)}</b> ${esc(j.poLookupMsg || "")}${j.poLookupAt ? ` <span class="sub">(${esc(String(j.poLookupAt).slice(0, 16).replace("T", " "))})</span>` : ""}${cands}`;
}
function wireFindPo(j) {
  const box = $("#polk");
  if (!box || !canFindPo()) return;
  const wireUse = (cur) => box.querySelectorAll(".usepo").forEach(b => b.onclick = async () => {
    const c = cur.poLookupCandidates[+b.dataset.i];
    try { await writeJob(j.id, { po: c.po, poAmount: c.amount ?? null, poAmountBasis: c.amount != null ? (c.basis || "ex GST") : null,
      poAmountSource: c.amount != null ? "Find PO: " + (c.source || "") : null, poLookupStatus: "found", poLookupMsg: `picked ${c.po} by ${me.name}`,
      editedInApp: true, updatedAt: serverTimestamp(), updatedBy: me.uid }); toast("PO set to " + c.po); $("#dlg").close(); }
    catch (e) { toast("Not saved: " + (e.code || e.message)); } });
  wireUse(j);
  let raw = j;
  const render = () => { const cur = withMoney(raw); box.innerHTML = poLookupHtml(cur); wireUse(cur); };
  const unsub = onSnapshot(doc(db, "jobs", j.id), s => { if (!s.exists()) return; raw = { id: s.id, ...s.data() }; render(); });
  // Suggestions arrive on jobMoney (office only); keep the dialog live when the box writes them.
  const unsubMoney = canSeeMoney() ? onSnapshot(doc(db, JOB_MONEY_COLLECTION, j.id), s => { if (s.exists()) MONEY.set(j.id, s.data()); render(); },
    e => console.warn("job money", e.code || e.message)) : () => {};
  $("#dlg").addEventListener("close", () => { unsub(); unsubMoney(); }, { once: true });
  $("#findpo").onclick = async () => {
    const at = new Date().toISOString();
    let rid = null;
    try { rid = (await addDoc(collection(db, "poLookups"), { jobId: j.id, address: j.address || "", lot: (String(j.address || "").match(/lot\s*(?:no\.?\s*)?(\w+)/i) || [])[1] || "",
      client: j.client || "", type: j.type || "", requestedBy: me.name, requestedByUid: me.uid, status: "pending", createdAt: serverTimestamp() })).id; } catch (e) { /* rules not pasted yet: job flag alone still works */ }
    try { await updateDoc(doc(db, "jobs", j.id), { poLookupStatus: "pending", poLookupMsg: "waiting for the box (checks every 2 min, 6am-8pm)", poLookupAt: at,
      poLookupRequestedBy: me.name, poLookupCandidates: deleteField(), ...(rid ? { poLookupId: rid } : {}), updatedAt: serverTimestamp(), updatedBy: me.uid });
      if (canSeeMoney()) await jobMoneyWrite(j.id, { poLookupCandidates: [] }).catch(e => console.warn("job money", e.code || e.message));
      toast("Find PO requested"); }
    catch (e) { toast("Not requested: " + (e.code || e.message)); }
  };
}
const invAmountDefault = j => (j.invoiceAmount ?? j.poAmount ?? null);
// Over PO: the price is always free to edit; the PO value is only the pre-fill. This is a note, never a block or a correction.
const overBy = (j, amt = j.invoiceAmount) => (amt == null || amt === "" || j.poAmount == null || !(+amt > +j.poAmount + 0.005)) ? 0 : Math.round((+amt - +j.poAmount) * 100) / 100;
const $$ = v => canSeeMoney() ? ("$" + Number(v).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })) : "";
const overPoHtml = (j, amt) => { if (!canSeeMoney()) return ""; const o = overBy(j, amt); return o ? `<span class="overpo">Over PO by ${$$(o)}</span> <button type="button" class="sm-btn emailsup" title="Opens your email app with a message to the supervisor (nothing is sent automatically)">✉ Email supervisor</button>` : ""; };
// Supervisor email: job field, then meta/supervisors (Orbit Call Forward / Torsion PO sender, by PO), then Torsion default, then remembered per client.
let SUPS = null, SUPS_FOR = "";
async function supervisors() {
  const cid = myCompanyId();
  if (!SUPS || SUPS_FOR !== cid) { SUPS_FOR = cid; try { SUPS = (await getDoc(doc(db, ...supervisorsPath(cid)))).data() || {}; } catch { SUPS = {}; } }
  return SUPS;
}
async function supervisorFor(j) {
  if (j.supervisorEmail) return { email: j.supervisorEmail, name: j.supervisorName || "" };
  const m = await supervisors(), base = String(j.po || "").split("/")[0].replace(/\D/g, "");
  return (base && m.byPo?.[base]) || m.byClient?.[j.client] || m.remembered?.[(j.client || "").replace(/[.\/]/g, "_")] || null;
}
// ---- Inbox: inbox/{gmailMessageId} written by tools/sync_inbox.py. Admins and supervisors import.
// Staff (operators) do not see this screen. Import opens the new-job form; nothing is created until Save.
function refreshAfterImport() {
  if (me && me.role === "admin" && !ui.myJobs) renderAdmin();
  else renderOperator();
}
function inboxSub() {
  if (ui.holdSideWork || !canImport() || ui.inboxSub) return;
  ui.inboxSub = onSnapshot(collection(db, "inbox"), s => { ui.inbox = s.docs.map(d => ({ id: d.id, ...d.data() })); ui.inboxErr = "";
    if (me && me.role === "admin" && !ui.myJobs) { if (ui.view === "inbox" || ui.view === "home") renderAdmin(); else inboxBadge(); }
    else if (ui.opTab === "inbox") renderOperator(); },
    e => { ui.inbox = []; ui.inboxErr = e.code || e.message;
      if (me && me.role === "admin" && !ui.myJobs && ui.view === "inbox") renderAdmin();
      else if (ui.opTab === "inbox") renderOperator(); });
}
const inboxUnread = () => (ui.inbox || []).filter(m => !m.read).length;
function inboxBadge() { document.querySelectorAll('.sm-nav[data-view="inbox"]').forEach(b => { let x = b.querySelector(".nbadge"); const n = inboxUnread();
  if (!n) return x && x.remove(); if (!x) { x = document.createElement("span"); x.className = "nbadge"; b.appendChild(x); } x.textContent = n; }); }
const BLD = ["All", "Orbit", "Torsion", "Silkwood"];
const mailDate = s => { const d = new Date(s); return isNaN(d) ? "" : d.toLocaleString("en-AU", { timeZone: TZ, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); };
const loadedJobs = () => [...jobs, ...(ui.undated || []), ...(ui.done || [])];
function importJobLabel(j) {
  if (!j) return "an existing job";
  return `#${jobNo(j)}${j.date ? " · " + shortDate(j.date) : ""}${j.po ? " · PO " + j.po : ""}`;
}
function importBanner(j) {
  const p = j._import || {};
  const existing = p.existing;
  const warn = [...(p.warnings || [])];
  if (existing) warn.unshift(duplicateWarning(existing, importJobLabel(existing.job)));
  if (p.jobLike === false) warn.push("This email does not look like a job. Check every field before you save.");
  return `<div class="import-banner">
    <b>Import from ${esc(p.builder || "builder")} email.</b>
    <span class="sub">Review and edit, then save. Nothing is created until you save.</span>
    ${p.subject ? `<div class="sub">${esc(p.subject)}</div>` : ""}
    <div class="row">
      <label>Lot<input name="ilot" value="${esc(p.lot || "")}" autocomplete="off"></label>
      <label>Street<input name="istreet" value="${esc(p.street || "")}" autocomplete="address-line1"></label>
      <label>Suburb<input name="isuburb" ${inputAttrs("suburb")} value="${esc(p.suburb || "")}"></label>
    </div>
    <div class="row">
      <label>Supervisor<input name="isup" maxlength="80" ${inputAttrs("supervisor")} value="${esc(p.supervisorName || "")}"></label>
      <label>Phone<input name="iphone" maxlength="40" ${inputAttrs("phone")} value="${esc(p.supervisorPhone || "")}"></label>
      <label>Email<input name="iemail" maxlength="120" ${inputAttrs("email")} value="${esc(p.supervisorEmail || "")}"></label>
    </div>
    <p class="sub">${p.costCode ? `Cost code ${esc(p.costCode)}${p.typeLabel ? " · " + esc(p.typeLabel) : ""}` : esc(p.typeLabel || "No cost code found")}</p>
    ${warn.map(w => `<p class="iwarn">${esc(w)}</p>`).join("")}
    ${existing ? `<button type="button" class="sm-btn" id="importdate">Update ${esc(importJobLabel(existing.job))}'s date</button>` : ""}
  </div>`;
}
function importFieldExtras(j, f) {
  const p = j._import || {};
  const name = (f.isup && f.isup.value || p.supervisorName || "").trim();
  const email = (f.iemail && f.iemail.value || p.supervisorEmail || "").trim();
  const phone = (f.iphone && f.iphone.value || p.supervisorPhone || "").trim();
  return {
    inboxId: p.emailId || "",
    ...(p.costCode ? { costCode: p.costCode } : {}),
    ...(name ? { supervisorName: name, contactName: name } : {}),
    ...(email ? { supervisorEmail: email } : {}),
    ...(phone ? { contactPhone: phone } : {}),
  };
}
function wireImportForm(j, f) {
  const syncAddr = () => { f.address.value = composeAddress({ lot: f.ilot.value.trim(), street: f.istreet.value.trim(), suburb: f.isuburb.value.trim() }); };
  ["ilot", "istreet", "isuburb"].forEach(name => { if (f[name]) f[name].oninput = syncAddr; });
  const dateBtn = $("#importdate");
  if (dateBtn) dateBtn.onclick = () => importUpdateDate(j, f).catch(e => { const err = $("#ferr"); if (err) err.textContent = e.message || "Not saved"; });
}
async function lookupImportDuplicate(draft) {
  const pool = loadedJobs();
  let hit = findExistingJob(pool, draft);
  const po = String(draft.po || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!hit && po) {
    try {
      const snap = await getDocs(query(collection(db, "jobs"), where("companyId", "==", myCompanyId()), where("po", "==", po)));
      hit = findExistingJob([...pool, ...snap.docs.map(d => ({ id: d.id, ...d.data() }))], { ...draft, po });
    } catch { /* loaded jobs still apply */ }
  }
  return hit;
}
async function markInboxImported(emailId, jobId) {
  const cur = (ui.inbox || []).find(m => m.id === emailId);
  if (cur && isImported(cur) && cur.importedJobId && cur.importedJobId !== jobId) throw new Error("That email is already imported.");
  await updateDoc(doc(db, "inbox", emailId), {
    imported: true, importedJobId: jobId, importedAt: serverTimestamp(), importedBy: me.uid,
    jobIds: arrayUnion(jobId), read: true, readAt: serverTimestamp(),
  });
}
async function importUpdateDate(j, f) {
  if (!canImport()) throw new Error("Supervisors and admins only.");
  const date = f.date.value;
  if (!date) throw new Error("Enter the date to put on the existing job.");
  const hit = await lookupImportDuplicate({ po: f.po.value, address: f.address.value });
  if (!hit) throw new Error("No job with this address or PO is loaded.");
  const emailId = j._import.emailId;
  const cur = (ui.inbox || []).find(m => m.id === emailId);
  if (cur && isImported(cur)) throw new Error("That email is already imported.");
  if (!confirmIfOnLeave(date, namesOf(hit.job))) return;
  await updateDoc(doc(db, "jobs", hit.job.id), { date, editedInApp: true, inboxId: emailId, updatedAt: serverTimestamp(), updatedBy: me.uid });
  await markInboxImported(emailId, hit.job.id);
  $("#dlg").close();
  toast(`Updated the date on ${importJobLabel(hit.job)}`);
  refreshAfterImport();
}
function openImport(email) {
  if (!canImport()) return toast("Supervisors and admins only.");
  if (!email) return;
  if (isImported(email)) return toast("That email is already imported.");
  const parsed = parseInboxEmail(email, { today: todayStr() });
  const existing = findExistingJob(loadedJobs(), parsed);
  editJob({
    date: parsed.date || "", time: "07:00", durationHrs: 4, status: "Scheduled", type: parsed.type || "other",
    assigned: [], client: parsed.client || "", address: parsed.address || "", po: parsed.po || "",
    description: parsed.description || "", notes: parsed.notes || "",
    _import: { ...parsed, emailId: email.id, existing },
  });
}
function inboxView(all) {
  if (!canImport()) return `<div class="sm-head"><h1>Inbox</h1></div><p class="muted pad">Supervisors and admins only.</p>`;
  if (ui.ibMode === "review") return inboxReview(all);
  if (ui.ibMode === "bulk") return inboxBulk(all);
  const b = ui.ib || "All", w = (ui.iq || "").toLowerCase().split(/\s+/).filter(Boolean), unreadOnly = ui.ibUnread;
  const L = (ui.inbox || []).filter(m => (b === "All" || m.builder === b) && (!unreadOnly || !m.read)
      && w.every(x => [m.subject, m.fromName, m.fromEmail, m.snippet, m.matchKey, m.jobLabel, (m.attachments || []).join(" ")].join(" ").toLowerCase().includes(x)))
    .sort((x, y) => String(y.date).localeCompare(String(x.date)));
  const cnt = k => (ui.inbox || []).filter(m => (k === "All" || m.builder === k) && !m.read).length;
  const jobsById = new Map(all.map(j => [j.id, j]));
  const side = m => {
    const js = (m.jobIds || []).map(i => jobsById.get(i)).filter(Boolean);
    const imported = isImported(m);
    const jobBtns = js.map(j => `<button class="sm-btn ijob" data-ijob="${esc(j.id)}">Job #${esc(jobNo(j))}</button>`).join("");
    const importBtn = imported
      ? `<span class="sub iimported">Imported</span>`
      : `<button type="button" class="sm-btn primary" data-iimport="${esc(m.id)}">Import as job</button>`;
    return `${jobBtns}${importBtn}<button class="sm-btn iread" data-iread="${esc(m.id)}" title="${m.read ? "Mark unread" : "Mark read"}">${m.read ? "●" : "✓"}</button>`;
  };
  return `<div class="sm-head"><h1>Inbox</h1><span class="sub">Builder emails · last 30 days · ${ui.inbox ? ui.inbox.length : "…"} emails</span>
      <span class="headbtns"><button type="button" class="sm-btn" id="ibulk">Bulk import</button></span></div>
    ${ui.inboxErr ? `<p class="err pad">Inbox not available: ${esc(ui.inboxErr)}</p>` : ""}
    <div class="ibar">${BLD.map(k => `<button class="qtab ${b === k ? "on" : ""}" data-ib="${k}">${k}${cnt(k) ? ` <span class="nbadge">${cnt(k)}</span>` : ""}</button>`).join("")}
      <label class="ck ibun"><input type="checkbox" id="ibun" ${unreadOnly ? "checked" : ""}> Unread only</label></div>
    <div class="sbar"><span class="sbar-ic">🔍</span><input id="iq" type="search" placeholder="Search subject, sender, job, lot, attachment…" value="${esc(ui.iq || "")}"></div>
    <div class="ilist">${L.map(m => `<div class="irow ${m.read ? "" : "unread"} ${isImported(m) ? "iimported" : ""}"><a class="imain" href="${esc(m.link || "")}" target="_blank" rel="noopener" data-imsg="${esc(m.id)}">
        <div class="itop"><span class="ibld b-${esc((m.builder || "").toLowerCase())}">${esc(m.builder)}</span><b class="ifrom">${esc(m.fromName || m.fromEmail)}</b><span class="idate">${esc(mailDate(m.date))}</span></div>
        <div class="isubj">${esc(m.subject)}</div><div class="isnip sub">${esc(m.snippet)}</div>
        ${(m.attachments || []).length ? `<div class="sub iatt">📎 ${esc(m.attachments.join(", "))}</div>` : ""}</a>
        <div class="iside">${side(m)}${!((m.jobIds || []).length) && m.matchKey && !isImported(m) ? `<span class="sub muted">${esc(m.matchKey)} · no job</span>` : ""}</div></div>`).join("")
      || `<p class="pad muted">${ui.inbox ? "No emails" : "Loading…"}</p>`}</div>`;
}
function inboxBulk(all) {
  const rows = bulkCandidates(ui.inbox || [], { today: todayStr() });
  const sel = new Set(ui.ibSel || []);
  return `<div class="sm-head"><h1>Bulk import</h1><span class="sub">Unimported emails that look like jobs. Nothing is saved on this step.</span>
      <span class="headbtns"><button type="button" class="sm-btn" id="iback">Back</button></span></div>
    <div class="ibar"><button type="button" class="sm-btn primary" id="ireview">Review selected</button>
      <button type="button" class="sm-btn" id="iall">Select all</button></div>
    <div class="ilist">${rows.map(m => { const d = parseInboxEmail(m, { today: todayStr() }); const hit = findExistingJob(all, d);
      return `<label class="irow ibulk"><input type="checkbox" data-isel="${esc(m.id)}" ${sel.has(m.id) ? "checked" : ""}>
        <span class="imain"><span class="itop"><span class="ibld b-${esc((m.builder || "").toLowerCase())}">${esc(m.builder)}</span><b>${esc(d.address || m.subject || "Email")}</b></span>
        <span class="sub">${esc([d.typeLabel || d.type, d.date, d.po].filter(Boolean).join(" · "))}</span>
        ${hit ? `<span class="iwarn">${esc(duplicateWarning(hit, importJobLabel(hit.job)))}</span>` : ""}</span></label>`; }).join("")
      || `<p class="pad muted">No unimported job emails.</p>`}</div>`;
}
function inboxReview(all) {
  const ids = ui.ibReview || [];
  ui.ibDraft = ui.ibDraft || {};
  ids.forEach(id => {
    if (ui.ibDraft[id]) return;
    const email = (ui.inbox || []).find(m => m.id === id);
    const parsed = email ? parseInboxEmail(email, { today: todayStr() }) : null;
    if (!parsed) return;
    const existing = findExistingJob(all, parsed);
    ui.ibDraft[id] = { ...parsed, mode: defaultImportMode(existing), existingBy: existing ? existing.by : "", existingLabel: existing ? importJobLabel(existing.job) : "" };
  });
  const card = id => {
    const row = ui.ibDraft[id];
    if (!row) return "";
    const kind = [row.costCode ? "Cost code " + row.costCode : "", row.typeLabel].filter(Boolean).join(" · ");
    return `<div class="irow ireview"><div class="imain">
      <div class="itop"><b>${esc(row.subject || row.address || "Email")}</b></div>
      ${kind ? `<div class="sub">${esc(kind)}</div>` : ""}
      ${row.warnings && row.warnings.length ? row.warnings.map(w => `<p class="iwarn">${esc(w)}</p>`).join("") : ""}
      ${row.existingLabel ? `<p class="iwarn">${esc(duplicateWarning({ by: row.existingBy || "address" }, row.existingLabel))}</p>
        <label class="ck"><input type="radio" name="mode-${esc(id)}" data-iid="${esc(id)}" data-field="mode" value="create" ${row.mode !== "date" ? "checked" : ""}> Save as a new job</label>
        <label class="ck"><input type="radio" name="mode-${esc(id)}" data-iid="${esc(id)}" data-field="mode" value="date" ${row.mode === "date" ? "checked" : ""}> Update ${esc(row.existingLabel)}'s date</label>` : ""}
      <div class="row">
        <label>Client<input data-iid="${esc(id)}" data-field="client" ${inputAttrs("client")} value="${esc(row.client)}"></label>
        <label>Address<input data-iid="${esc(id)}" data-field="address" ${inputAttrs("address")} value="${esc(row.address)}"></label>
        <label>Suburb<input data-iid="${esc(id)}" data-field="suburb" ${inputAttrs("suburb")} value="${esc(row.suburb)}"></label>
      </div>
      <div class="row">
        <label>Category<select data-iid="${esc(id)}" data-field="type">${jobCategorySelectHtml(ui.tradeSetup, row.type || "", { blank: "Choose category" })}</select></label>
        <label>Required date<input type="date" data-iid="${esc(id)}" data-field="date" value="${esc(row.date)}"></label>
        <label>PO<input data-iid="${esc(id)}" data-field="po" value="${esc(row.po)}"></label>
      </div>
      <div class="row">
        <label>Supervisor<input data-iid="${esc(id)}" data-field="supervisorName" maxlength="80" ${inputAttrs("supervisor")} value="${esc(row.supervisorName)}"></label>
        <label>Phone<input data-iid="${esc(id)}" data-field="supervisorPhone" maxlength="40" ${inputAttrs("phone")} value="${esc(row.supervisorPhone)}"></label>
        <label>Email<input data-iid="${esc(id)}" data-field="supervisorEmail" maxlength="120" ${inputAttrs("email")} value="${esc(row.supervisorEmail)}"></label>
      </div>
      <label>Notes<textarea data-iid="${esc(id)}" data-field="notes" rows="2">${esc(row.notes)}</textarea></label>
    </div></div>`;
  };
  return `<div class="sm-head"><h1>Review import</h1><span class="sub">Check these, then save. Nothing is written until you save.</span>
      <span class="headbtns"><button type="button" class="sm-btn" id="iback">Back</button>
      <button type="button" class="sm-btn primary" id="isave">Save imports</button></span></div>
    <div class="ilist">${ids.map(card).join("") || `<p class="pad muted">Nothing selected.</p>`}</div>`;
}
function readImportReview(A) {
  A.querySelectorAll("[data-iid]").forEach(el => {
    const row = (ui.ibDraft || {})[el.dataset.iid];
    if (!row || !el.dataset.field) return;
    if (el.type === "radio") { if (el.checked) row[el.dataset.field] = el.value; return; }
    row[el.dataset.field] = el.value;
  });
}
async function saveBulkImport(A) {
  if (!canImport()) return toast("Supervisors and admins only.");
  readImportReview(A);
  const ids = ui.ibReview || [];
  let saved = 0, failed = 0;
  for (const id of ids) {
    const row = (ui.ibDraft || {})[id];
    const email = (ui.inbox || []).find(m => m.id === id);
    if (!row || !email || isImported(email)) continue;
    const address = addressWithSuburb(row.address, row.suburb);
    try {
      if (row.mode === "date") {
        const existing = await lookupImportDuplicate({ po: row.po, address });
        if (!existing) throw new Error("No matching job");
        if (!row.date) throw new Error("Date required");
        if (!confirmIfOnLeave(row.date, namesOf(existing.job))) continue;
        await updateDoc(doc(db, "jobs", existing.job.id), { date: row.date, editedInApp: true, inboxId: id, updatedAt: serverTimestamp(), updatedBy: me.uid });
        await markInboxImported(id, existing.job.id);
      } else {
        const typ = row.type || "other";
        const desc = String(row.description || "");
        if (typ === "backslab" && desc.toLowerCase().includes("spoil")) throw new Error("Spoil must be its own job");
        if (typ === "spoil" && /back ?slab|slab clean|back blade/.test(desc.toLowerCase())) throw new Error("Backslab must be its own job");
        if (!String(row.client || "").trim() || !address) throw new Error("Client and address are required");
        const ref = await addDoc(collection(db, "jobs"), {
          client: String(row.client).trim(), address, type: typ,
          po: String(row.po || "").trim().toUpperCase().replace(/\s+/g, ""),
          description: desc.trim(), date: row.date || "", time: "07:00", durationHrs: 4,
          assigned: [], assignedNames: [], status: "Scheduled", notes: String(row.notes || "").trim(),
          loads: null, editedInApp: true, source: "inbox", inboxId: id, log: [], companyId: myCompanyId(),
          ...(row.costCode ? { costCode: String(row.costCode) } : {}),
          ...(row.supervisorName ? { supervisorName: String(row.supervisorName).trim(), contactName: String(row.supervisorName).trim() } : {}),
          ...(row.supervisorEmail ? { supervisorEmail: String(row.supervisorEmail).trim() } : {}),
          ...(row.supervisorPhone ? { contactPhone: String(row.supervisorPhone).trim() } : {}),
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: me.uid,
        });
        await markInboxImported(id, ref.id);
      }
      rememberEntries({
        client: row.client, address, suburb: row.suburb, description: row.description,
        supervisor: row.supervisorName, contactName: row.supervisorName, phone: row.supervisorPhone, email: row.supervisorEmail,
      });
      saved += 1;
    } catch (e) { failed += 1; console.warn("import", id, e); }
  }
  ui.ibMode = ""; ui.ibReview = []; ui.ibDraft = {};
  toast(failed ? `Saved ${saved}. ${failed} not saved.` : `Saved ${saved} job${saved === 1 ? "" : "s"}.`);
  refreshAfterImport();
}
function forwardView() {
  if (!canForward()) return `<p class="pad">Supervisors and admins only.</p>`;
  if (!ui.forwardState) {
    ui.forwardState = { loading: true, emails: [], drafts: [], verifications: [], ignored: [] };
    loadForward();
  }
  return forwardScreenHtml({ ...ui.forwardState, canMint: canMintForward(), canEditSupervisors: canEditForwardSupervisors(), canApprove: canApproveForward() });
}
async function loadForward() {
  if (!canForward()) return;
  const id = myCompanyId();
  const supRef = doc(db, ...supervisorsPath(id));
  try {
    const [cfg, sup, drafts, mail] = await Promise.all([
      getDoc(doc(db, "companies", id, "inbound", "config")),
      getDoc(supRef),
      getDocs(collection(db, "companies", id, "jobDrafts")),
      getDocs(collection(db, "companies", id, "inboundMail")),
    ]);
    const rows = mail.docs.map(d => ({ id: d.id, ...d.data() }));
    ui.forwardState = {
      loading: false,
      address: cfg.exists() ? (cfg.data().address || "") : "",
      emails: collectSupervisorEmails(sup.exists() ? sup.data() : {}),
      drafts: drafts.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => d.status === "pending"),
      verifications: rows.filter(r => r.kind === "verification"),
      ignored: rows.filter(r => r.kind === "ignored"),
      error: "",
    };
  } catch (e) {
    ui.forwardState = { loading: false, emails: [], drafts: [], verifications: [], ignored: [], error: e.code || e.message || "Couldn't load forwarding." };
  }
  if ((me && me.role === "admin" && ui.view === "forward") || ui.opTab === "forward") {
    if (me && me.role === "admin" && !ui.myJobs) renderAdmin();
    else renderOperator();
  }
}
async function mintForwardAddress() {
  if (!canMintForward()) return toast("An admin creates the forwarding address.");
  const id = myCompanyId();
  const bytes = new Uint8Array(8);
  if (!globalThis.crypto || !crypto.getRandomValues) return toast("This browser can't create an address.");
  crypto.getRandomValues(bytes);
  const token = inboundToken(bytes);
  const local = `${id}-${token}`;
  const address = `${local}@${INBOUND_DOMAIN}`;
  if (!token || !address.includes("@")) return toast("Couldn't create an address.");
  try {
    await runTransaction(db, async tx => {
      const cfgRef = doc(db, "companies", id, "inbound", "config");
      const existing = await tx.get(cfgRef);
      if (existing.exists()) return;
      tx.set(doc(db, "inboundRoutes", local), { companyId: id, address, createdBy: me.uid, createdAt: serverTimestamp() });
      tx.set(cfgRef, { companyId: id, address, localPart: local, domain: INBOUND_DOMAIN, createdBy: me.uid, createdAt: serverTimestamp() });
    });
    ui.forwardState = null;
    toast("Forwarding address created");
    if (me.role === "admin" && !ui.myJobs) renderAdmin();
    else renderOperator();
  } catch (e) { toast("Not created: " + (e.code || e.message)); }
}
async function saveSupervisorEmails(next) {
  const id = myCompanyId();
  const payload = { emails: next };
  if (id !== "heartwood") payload.companyId = id;
  await setDoc(doc(db, ...supervisorsPath(id)), payload, { merge: true });
  if (ui.forwardState) ui.forwardState = { ...ui.forwardState, emails: next };
}
function redrawForward() {
  ui.forwardState = null;
  if (me && me.role === "admin" && !ui.myJobs && ui.view === "forward") renderAdmin();
  else renderOperator();
}
async function approveForwardDraft(root, id) {
  if (!canApproveForward()) return toast("An admin approves this before it becomes a job.");
  const draft = (ui.forwardState && ui.forwardState.drafts || []).find(d => d.id === id);
  if (!draft || draft.status === "approved") return;
  const edited = readDraftEdits(root, draft);
  const built = jobFromDraft({ ...edited, id: draft.id, messageId: draft.messageId }, { companyId: myCompanyId(), uid: me.uid });
  if (!built.ok) return toast(built.reason === "client-address" ? "Add a client and an address before approving." : "That draft can't be approved.");
  try {
    const ref = doc(db, "jobs", built.id);
    const existing = await getDoc(ref);
    if (!existing.exists()) await setDoc(ref, { ...built.job, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: me.uid });
    await updateDoc(doc(db, "companies", myCompanyId(), "jobDrafts", draft.id), {
      client: built.job.client, address: built.job.address, type: built.job.type, po: built.job.po,
      description: built.job.description, date: built.job.date, notes: built.job.notes,
      ...(built.job.supervisorName ? { supervisorName: built.job.supervisorName } : {}),
      ...(built.job.supervisorEmail ? { supervisorEmail: built.job.supervisorEmail } : {}),
      ...(built.job.contactPhone ? { supervisorPhone: built.job.contactPhone } : {}),
      status: "approved", jobId: built.id, approvedBy: me.uid, approvedAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    toast("Job approved");
    redrawForward();
  } catch (e) { toast("Not approved: " + (e.code || e.message)); }
}
async function discardForwardDraft(id) {
  try {
    await updateDoc(doc(db, "companies", myCompanyId(), "jobDrafts", id), {
      status: "discarded", discardedBy: me.uid, discardedAt: serverTimestamp(),
    });
    toast("Draft discarded");
    redrawForward();
  } catch (e) { toast("Not discarded: " + (e.code || e.message)); }
}
function bindForward(A) {
  const copy = A.querySelector("#fwdcopy");
  if (copy) copy.onclick = async () => {
    const address = copy.dataset.address || "";
    try { await navigator.clipboard.writeText(address); toast("Copied"); }
    catch { toast(address); }
  };
  const mint = A.querySelector("#fwdmint");
  if (mint) mint.onclick = () => mintForwardAddress();
  const refresh = A.querySelector("#fwdrefresh");
  if (refresh) refresh.onclick = () => redrawForward();
  const form = A.querySelector("#fwdsup");
  if (form) form.onsubmit = async ev => {
    ev.preventDefault();
    const email = normalizeSupervisorEmail(form.email.value);
    if (!email) return toast("Enter a valid email.");
    const next = [...new Set([...(ui.forwardState && ui.forwardState.emails || []), email])];
    try { await saveSupervisorEmails(next); form.reset(); toast("Supervisor saved"); redrawForward(); }
    catch (e) { toast("Not saved: " + (e.code || e.message)); }
  };
  A.querySelectorAll("[data-fwd-remove]").forEach(b => b.onclick = async () => {
    const next = (ui.forwardState && ui.forwardState.emails || []).filter(e => e !== b.dataset.fwdRemove);
    try { await saveSupervisorEmails(next); redrawForward(); }
    catch (e) { toast("Not saved: " + (e.code || e.message)); }
  });
  A.querySelectorAll("[data-fwd-approve]").forEach(b => b.onclick = () => approveForwardDraft(A, b.dataset.fwdApprove));
  A.querySelectorAll("[data-fwd-discard]").forEach(b => b.onclick = () => discardForwardDraft(b.dataset.fwdDiscard));
  A.querySelectorAll("[data-fwd-dismiss]").forEach(b => b.onclick = async () => {
    try {
      await updateDoc(doc(db, "companies", myCompanyId(), "inboundMail", b.dataset.fwdDismiss), { dismissed: true, dismissedAt: serverTimestamp() });
      redrawForward();
    } catch (e) { toast("Not hidden: " + (e.code || e.message)); }
  });
}
function bindInbox(A) {
  const all = loadedJobs();
  const go = () => refreshAfterImport();
  A.querySelectorAll("[data-ib]").forEach(x => x.onclick = () => { ui.ib = x.dataset.ib; go(); });
  const u = A.querySelector("#ibun"); if (u) u.onchange = () => { ui.ibUnread = u.checked; go(); };
  const qi = A.querySelector("#iq"); if (qi) qi.oninput = () => { ui.iq = qi.value; const p = qi.selectionStart; go(); const n = $("#iq"); if (n) { n.focus(); n.setSelectionRange(p, p); } };
  const setRead = (id, v) => updateDoc(doc(db, "inbox", id), { read: v, readAt: serverTimestamp() }).catch(e => toast("Not saved: " + (e.code || e.message)));
  A.querySelectorAll("[data-imsg]").forEach(x => x.addEventListener("click", () => { const m = (ui.inbox || []).find(y => y.id === x.dataset.imsg); if (m && !m.read) setRead(m.id, true); }));
  A.querySelectorAll("[data-iread]").forEach(x => x.onclick = () => { const m = (ui.inbox || []).find(y => y.id === x.dataset.iread); if (m) setRead(m.id, !m.read); });
  A.querySelectorAll("[data-ijob]").forEach(x => x.onclick = () => { const j = all.find(y => y.id === x.dataset.ijob); j ? editJob(j) : toast("Job not loaded"); });
  A.querySelectorAll("[data-iimport]").forEach(x => x.onclick = ev => { ev.preventDefault(); ev.stopPropagation(); const m = (ui.inbox || []).find(y => y.id === x.dataset.iimport); openImport(m); });
  const bulk = A.querySelector("#ibulk"); if (bulk) bulk.onclick = () => { ui.ibMode = "bulk"; go(); };
  const back = A.querySelector("#iback"); if (back) back.onclick = () => { ui.ibMode = ui.ibMode === "review" ? "bulk" : ""; go(); };
  A.querySelectorAll("[data-isel]").forEach(x => x.onchange = () => {
    const set = new Set(ui.ibSel || []);
    if (x.checked) set.add(x.dataset.isel); else set.delete(x.dataset.isel);
    ui.ibSel = [...set];
  });
  const allBtn = A.querySelector("#iall"); if (allBtn) allBtn.onclick = () => { ui.ibSel = bulkCandidates(ui.inbox || [], { today: todayStr() }).map(m => m.id); go(); };
  const review = A.querySelector("#ireview"); if (review) review.onclick = () => {
    const ids = [...A.querySelectorAll("[data-isel]:checked")].map(x => x.dataset.isel);
    if (!ids.length) return toast("Select at least one email.");
    ui.ibReview = ids; ui.ibDraft = {}; ui.ibMode = "review"; go();
  };
  const save = A.querySelector("#isave"); if (save) save.onclick = () => saveBulkImport(A);
  wireReviewPrefill(A);
}
// ---- Clients (clients/{id}: name, office{address,phone}, contacts[{kind,name,role,mobile,phone,email,source,default}]).
// Workers read, admins edit. Contacts come from builders' emails (see data/clients_contacts.json).
let CLI = null, CLI_ERR = "";
async function loadClients(force) {
  if (!CLI || force) {
    const ref = myCompanyId() === "heartwood" ? collection(db, "clients") : query(collection(db, "clients"), where("companyId", "==", myCompanyId()));
    try { CLI = (await getDocs(ref)).docs.map(d => ({ id: d.id, ...d.data() })).filter(c => docCompanyId(c) === myCompanyId()); CLI_ERR = ""; } catch (e) { CLI = []; CLI_ERR = e.code || e.message; }
    refreshClientLists();
  }
  return CLI;
}
const normCo = s => String(s || "").toLowerCase().replace(/\(.*?\)|pty|ltd|homes?|built|[^a-z]/g, "");
const clientOf = name => (CLI || []).find(c => normCo(c.name) && normCo(c.name) === normCo(name)) || null;
const telHref = m => "tel:" + String(m || "").replace(/[^\d+]/g, "");
// Job supervisor: job fields / meta (admins) first, then the client's contact list (adds the mobile); a client with
// one supervisor (or one marked default) is used when nothing else matches.
async function jobSupervisor(j) {
  await loadClients();
  const s = await supervisorFor(j).catch(() => null), c = clientOf(j.client), sups = (c?.contacts || []).filter(x => x.kind === "supervisor");
  const hit = s && sups.find(x => (s.email && x.email && x.email.toLowerCase() === s.email.toLowerCase()) || (s.name && x.name.toLowerCase().startsWith(s.name.toLowerCase())));
  if (s) return { ...s, ...(hit || {}), email: s.email || hit?.email, name: hit?.name || s.name };
  const base = String(j.po || "").split("/")[0].replace(/\D/g, ""), byPo = base && sups.find(x => (x.pos || []).includes(base));
  if (byPo) return byPo;
  if (sups.length === 1) return sups[0];
  return sups.find(x => x.default) || null;
}
async function fillSupCard(j) {
  const box = document.querySelector(`.supcard[data-sup="${CSS.escape(j.id)}"]`); if (!box) return;
  const s = await jobSupervisor(j).catch(() => null);
  box.innerHTML = s ? `<div class="sup"><div class="sup-who"><span class="mlbl">Supervisor</span><b>${esc(s.name || s.email)}</b>${s.mobile ? `<span class="sub">${esc(s.mobile)}</span>` : ""}</div>
    <span class="sup-btns">${s.mobile ? `<a class="sm-btn primary" href="${telHref(s.mobile)}">📞 Call</a>` : ""}${s.email ? `<a class="sm-btn" href="mailto:${esc(s.email)}?subject=${encodeURIComponent((j.address || "") + (j.po ? " PO " + j.po : ""))}">✉ Email</a>` : ""}</span></div>`
    : `<div class="sup none"><span class="mlbl">Supervisor</span> <span class="sub muted">Not known for this job${isAdm() ? " - add one in Clients" : ""}</span></div>`;
}
const KIND = { supervisor: "Supervisors", accounts: "Accounts", admin: "Admin / ordering" };
function contactRow(c, x, i) {
  return `<div class="ct"><div class="ct-who"><b>${esc(x.name)}</b> <span class="sub">${esc(x.role || "")}</span>
    <div class="sub">${[x.mobile, x.phone, x.email].filter(Boolean).map(esc).join(" · ")}</div>${x.source ? `<div class="sub muted ct-src">${esc(x.source)}</div>` : ""}</div>
    <span class="ct-btns">${x.mobile || x.phone ? `<a class="sm-btn primary" href="${telHref(x.mobile || x.phone)}" title="Call">📞</a>` : ""}${x.email ? `<a class="sm-btn" href="mailto:${esc(x.email)}" title="Email">✉</a>` : ""}${isAdm() ? `<button class="sm-btn" data-ced="${esc(c.id)}:${i}" title="Edit">✎</button>` : ""}</span></div>`;
}
function clientsView() {
  if (!CLI) { loadClients().then(() => ui.view === "clients" && renderAdmin()); return `<div class="sm-head"><h1>Clients</h1></div><p class="pad muted">Loading…</p>`; }
  const q = (ui.cq2 || "").toLowerCase();
  const list = CLI.filter(c => !q || JSON.stringify(c).toLowerCase().includes(q)).sort((a, b) => (b.contacts || []).length - (a.contacts || []).length || a.name.localeCompare(b.name));
  return `<div class="sm-head"><h1>Clients</h1>${isAdm() ? `<span class="headbtns"><button class="sm-btn primary" data-cnew>＋ Add client</button></span>` : ""}</div>
    ${CLI_ERR ? `<p class="err pad">Clients not available: ${esc(CLI_ERR)}</p>` : ""}
    <div class="sbar"><span class="sbar-ic">🔍</span><input id="cq2" type="search" placeholder="Search client, name, phone…" value="${esc(ui.cq2 || "")}"></div>
    <div class="clgrid">${list.map(c => `<div class="clcard"><div class="cl-h"><h3>${esc(c.name)}</h3>${isAdm() ? `<button class="sm-btn" data-ced="${esc(c.id)}:new">＋ Contact</button>` : ""}</div>
      ${c.office?.phone || c.office?.address ? `<div class="sub cl-off">${c.office.phone ? `<a href="${telHref(c.office.phone)}">☎ ${esc(c.office.phone)}</a> · ` : ""}${esc(c.office.address || "")}</div>` : ""}
      ${Object.entries(KIND).map(([k, t]) => { const xs = (c.contacts || []).map((x, i) => [x, i]).filter(([x]) => (x.kind || "admin") === k);
        return xs.length ? `<div class="cl-k">${t}</div>` + xs.map(([x, i]) => contactRow(c, x, i)).join("") : ""; }).join("") || `<p class="sub muted">No contacts yet</p>`}</div>`).join("") || `<p class="pad muted">No clients yet</p>`}</div>`;
}
function bindClients(A) {
  const qi = A.querySelector("#cq2"); if (qi) qi.oninput = () => { ui.cq2 = qi.value; const p = qi.selectionStart; renderAdmin(); const n = $("#cq2"); n.focus(); n.setSelectionRange(p, p); };
  A.querySelectorAll("[data-ced]").forEach(b => b.onclick = () => { const [id, i] = b.dataset.ced.split(":"); editContact(CLI.find(c => c.id === id), i === "new" ? -1 : +i); });
  const nb = A.querySelector("[data-cnew]"); if (nb) nb.onclick = () => openClientForm();
}
function openClientForm() {
  const d = $("#dlg"); d.className = ""; d.onclose = null;
  refreshAutofillLists();
  d.innerHTML = clientFormHtml();
  d.showModal();
  wireClientPrefill(d);
  const form = $("#clientnew");
  form.onsubmit = async ev => {
    if (ev.submitter?.value === "cancel") return;
    ev.preventDefault();
    const built = buildClientCreate({
      companyId: myCompanyId(),
      name: form.name.value,
      contactName: form.contactName.value,
      phone: form.phone.value,
      email: form.email.value,
      address: form.address.value,
      notes: form.notes.value,
    });
    form.querySelectorAll("[data-err]").forEach(slot => { slot.hidden = true; slot.textContent = ""; });
    const err = $("#clienterr");
    if (!built.ok) {
      const message = built.reason === "email" ? "Check the email address." : built.reason === "phone" ? "Check the phone number." : "Enter the company or client name.";
      err.textContent = message;
      const slot = form.querySelector(`[data-err="${built.reason === "name" ? "name" : built.reason}"]`);
      if (slot) { slot.hidden = false; slot.textContent = message; }
      const field = form.elements[built.reason] || form.name;
      if (field) { field.setAttribute("aria-invalid", "true"); field.focus(); }
      return;
    }
    try {
      await setDoc(doc(db, "clients", built.id), { ...built.data, updatedAt: serverTimestamp(), updatedBy: me.uid }, { merge: true });
      rememberEntries({
        client: built.data.name,
        contactName: form.contactName.value,
        phone: form.phone.value,
        email: form.email.value,
        address: form.address.value,
      });
      d.close();
      await loadClients(true);
      renderAdmin();
      toast("Client saved");
    } catch (e) { err.textContent = "Not saved: " + (e.code || e.message); }
  };
}
function editContact(c, i) {
  refreshAutofillLists();
  const x = i >= 0 ? c.contacts[i] : { kind: "supervisor" }, d = $("#dlg"); d.className = ""; d.onclose = null;
  d.innerHTML = `<form method="dialog" id="cf" class="jf"><h2>${i >= 0 ? "Edit" : "Add"} contact · ${esc(c.name)}</h2>
    <label>Type<select name="kind">${Object.entries(KIND).map(([k, t]) => `<option value="${k}" ${x.kind === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
    <label>Name<input name="name" maxlength="80" ${inputAttrs("contactName")} value="${esc(x.name)}" required></label><label>Role<input name="role" value="${esc(x.role)}" autocomplete="organization-title"></label>
    <label>Mobile<input name="mobile" maxlength="40" ${inputAttrs("phone")} value="${esc(x.mobile)}"></label><label>Email<input name="email" maxlength="120" ${inputAttrs("email")} value="${esc(x.email)}"></label>
    <label>Source / note<input name="source" value="${esc(x.source)}"></label>
    <div class="btns">${i >= 0 ? `<button value="del" formnovalidate class="ghost big" id="cdel">Remove</button>` : ""}<button value="cancel" formnovalidate class="ghost big">Cancel</button><button value="ok" class="primary big">Save</button></div></form>`;
  d.showModal();
  $("#cf").onsubmit = async ev => {
    const v = ev.submitter?.value; if (v === "cancel") return; ev.preventDefault();
    if (v === "del" && !confirm(`Remove ${x.name}?`)) return;
    const f = ev.target, cs = [...(c.contacts || [])];
    const nx = { ...x, kind: f.kind.value, name: f.name.value.trim(), role: f.role.value.trim(), mobile: f.mobile.value.trim(), email: f.email.value.trim(), source: f.source.value.trim() };
    if (v === "del") cs.splice(i, 1); else if (i >= 0) cs[i] = nx; else cs.push(nx);
    try { await updateDoc(doc(db, "clients", c.id), { contacts: cs, updatedAt: serverTimestamp(), updatedBy: me.uid });
      if (v !== "del") rememberEntries({ contactName: nx.name, phone: nx.mobile, email: nx.email, supervisor: nx.kind === "supervisor" ? nx.name : "" });
      d.close(); await loadClients(true); renderAdmin(); toast("Saved"); }
    catch (e) { toast("Not saved: " + (e.code || e.message)); }
  };
}
async function emailSupervisor(j, amt) {
  if (testCompanyActive()) return holdOutbound("builder", `Builder email for ${j.address || "this job"} was not opened.`);
  let s = await supervisorFor(j);
  if (!s) {
    const e = (prompt(`Supervisor email for ${j.client || "this client"} (remembered for next time):`, "") || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return toast(e ? "That doesn't look like an email address" : "No email entered");
    s = { email: e, name: "" };
    const k = (j.client || "unknown").replace(/[.\/]/g, "_");
    setDoc(doc(db, ...supervisorsPath(myCompanyId())), myCompanyId() === "heartwood" ? { remembered: { [k]: s } } : { remembered: { [k]: s }, companyId: myCompanyId() }, { merge: true }).then(() => { (SUPS ||= {}).remembered = { ...(SUPS.remembered || {}), [k]: s }; })
      .catch(e2 => toast("Email not remembered: " + (e2.code || e2.message)));
    updateDoc(doc(db, "jobs", j.id), { supervisorEmail: e, updatedAt: serverTimestamp(), updatedBy: me.uid }).catch(() => {});
  }
  const a = amt ?? j.invoiceAmount, po = j.po || "(no PO)", task = (j.invoiceDescription || j.description || jobTypeText(j) || TYPES[j.type] || "").split("\n")[0];
  const first = (s.name || "").split(" ")[0];
  const body = `Hi ${first || "there"},

The requested task for the job below has come in over the PO value.

Job / address: ${j.address || ""}${j.sm8JobNo ? " (our job #" + j.sm8JobNo + ")" : ""}
Task: ${task}
PO: ${po}
PO value (ex GST): ${j.poAmount != null ? $$(j.poAmount) : "unknown"}
Amount charged (ex GST): ${a != null && a !== "" ? $$(a) : ""}
Difference (ex GST): ${$$(overBy(j, a))}
Reason: 

Could you please raise a variation or send an amended PO to cover the difference?

Thanks,
${builderSignoff(orgSettings(), me && me.name).join("\n")}

${POWERED_BY}`;
  const box = companyMailbox(orgSettings());
  const url = "https://mail.google.com/mail/?" + (box ? "authuser=" + encodeURIComponent(box) + "&" : "") + "view=cm&fs=1&to=" + encodeURIComponent(s.email)
    + "&su=" + encodeURIComponent(`PO exceeded - ${j.address || ""} - PO ${po}`) + "&body=" + encodeURIComponent(body);
  window.HW_LAST_MAILTO = url;      // Gmail compose in a new tab; nothing is sent from here
  const a2 = document.createElement("a"); a2.href = url; a2.target = "_blank"; a2.rel = "noopener"; document.body.appendChild(a2); a2.click(); a2.remove();
}
const xd = s => { const [y, m, d] = s.split("-"); return `${+d}/${m}/${y}`; };     // d/mm/yyyy like hwdata.d_fmt
const csvCell = v => { v = String(v ?? ""); return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
// ---- Send to Xero (admin only). The app can't hold Xero keys, so it QUEUES a request in xeroQueue; the box worker
// (tools/xero_queue.py + the Xero connector) creates a DRAFT invoice (never approved or emailed): contact = builder,
// reference = PO, line = invoice description, amount ex GST, account 200, tax OUTPUT (GST on Income), as on invoices 5442/5445.
// The worker then writes xeroInvoiceId / xeroStatus back to the job and marks it invoiced.
function xeroPill(j) { const s = j.xeroStatus; if (!s || !canXero()) return "";
  return `<div class="sub"><span class="qpill ${s === "draft" ? "q-comp" : s === "error" ? "q-alert" : "q-wo"}" title="${esc(j.xeroError || "")}">${s === "draft" ? "Draft in Xero" + (j.xeroInvoiceNo ? " #" + esc(j.xeroInvoiceNo) : "") : s === "error" ? "Xero error" : "Queued for Xero"}</span></div>`; }
async function sendToXero(list, opts = {}) {
  if (testCompanyActive()) return holdOutbound("xero", "Xero draft was not queued.");
  if (!canXero()) return;
  const bad = list.filter(j => !j.invoiceNo || !(+j.invoiceAmount > 0)), ok = list.filter(j => !bad.includes(j) && !["queued", "draft"].includes(j.xeroStatus));
  if (!ok.length) { toast(bad.length ? "Those jobs need an invoice number and a price first." : "Already sent to Xero."); return; }
  if (!opts.skipConfirm && !confirm(`Create ${ok.length} DRAFT invoice${ok.length === 1 ? "" : "s"} in Xero?\n\nThey are not approved or emailed. Check and approve them in Xero.`)) return;
  for (const j of ok) {
    const req = { jobId: j.id, invoiceNo: String(j.invoiceNo), contact: invContact(j), reference: isRealPo(j.po) ? j.po : "", description: j.invoiceDescription || invDescDefault(j),
      amountEx: +j.invoiceAmount, date: j.invoiceDate || j.date || todayStr(), accountCode: "200", taxType: "OUTPUT", status: "queued", by: auth.currentUser.uid, at: serverTimestamp() };
    try { await addDoc(collection(db, "xeroQueue"), req); await updateDoc(doc(db, "jobs", j.id), { xeroStatus: "queued", xeroQueuedAt: serverTimestamp() }); }
    catch (e) { if (e && e.code === "permission-denied") { alert("Send to Xero isn't switched on yet: the Firestore rules for Xero haven't been updated. Nothing was sent. Use Download Xero CSV for now."); return; }
      toast("Couldn't queue #" + j.invoiceNo + ": " + (e.code || e.message)); return; }
  }
  toast(`Queued ${ok.length} for Xero as draft${bad.length ? `; ${bad.length} skipped (no number or price)` : ""}.`); renderAdmin();
}
function xeroCsv(list) {
  const rows = list.map(j => { const d = j.invoiceDate || j.date;
    return [invContact(j), "", "", j.invoiceNo, isRealPo(j.po) ? j.po : "", xd(d), xd(addDays(d, 7)), "",
      j.invoiceDescription || invDescDefault(j), "1", Number(j.invoiceAmount).toFixed(2), "", "200", "GST on Income", "AUD"]; });
  return [XERO_COLS, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
function downloadText(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  window.HW_LAST_CSV = { name, text };
  toast("Downloaded " + name);
}
function downloadCsv(list) {
  if (myCompanyId() !== "heartwood") {
    downloadText(`invoices-${todayStr()}.csv`, invoiceCsv(list));
    return;
  }
  const ns = list.map(j => +j.invoiceNo).filter(Boolean).sort((a, b) => a - b);
  const name = `${canXero() ? "xero" : "invoice"} import ${ns.length > 1 ? ns[0] + "-" + ns[ns.length - 1] : ns[0]}.csv`;
  downloadText(name, xeroCsv(list));
}
function downloadHoursCsv() {
  if (!canCompanyExport()) return;
  const ws = tsWeek();
  const L = ui.tsAll && ui.tsAllWs === ws ? ui.tsAll : [];
  const rep = buildHoursReport({ weekStart: ws, people: tsPeople(L), sheets: L, leaves: ui.leave || [], jobs });
  downloadText(`hours-${ws}.csv`, hoursCsv(rep));
}
function downloadJobsCsv(list) {
  if (!canCompanyExport()) return;
  downloadText(`jobs-${todayStr()}.csv`, jobsCsv((list || []).map(j => ({ ...j, jobNo: j.jobNo || jobNo(j) }))));
}
function downloadClaimsCsv() {
  if (!canCompanyExport()) return;
  downloadText(`reimbursements-${todayStr()}.csv`, reimbursementsCsv(ui.claims || []));
}
ui.inv = "ready"; ui.invSel = new Set();
function invoicesView() {
  if (!me || me.role !== "admin") { ui.view = "home"; return `<p class="pad muted">Invoices are admin only.</p>`; }
  const done = (ui.done || []).filter(j => j.status === "Done" && matchQ(j));
  const excl = j => j.invoiceExcluded === true;          // "Remove" on the Invoices screen (job kept, never invoiced)
  const removed = done.filter(j => excl(j) && !j.invoiceNo).sort((a, b) => (b.invoiceExcludedAt || "").localeCompare(a.invoiceExcludedAt || ""));
  const ready = done.filter(j => !j.invoiceNo && !excl(j) && !j.doNotInvoice).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const numbered = done.filter(j => j.invoiceNo && !j.invoiced).sort((a, b) => +a.invoiceNo - +b.invoiceNo);
  const since = addDays(todayStr(), -30);
  const recent = done.filter(j => j.invoiceNo && j.invoiced && (j.invoiceDate || j.date || "") >= since).sort((a, b) => +b.invoiceNo - +a.invoiceNo);
  const list = { ready, numbered, recent, removed }[ui.inv];
  const sel = list.filter(j => ui.invSel.has(j.id));
  const tot = a => a.reduce((t, j) => t + (+j.invoiceAmount || 0), 0);
  const money = v => (!canSeeMoney() || v == null || v === "") ? "" : "$" + Number(v).toLocaleString("en-AU", { minimumFractionDigits: 2 });
  // Monthly totals: all invoiced (numbered) jobs, by invoice month (fallback: job/completed date). Removed / do-not-invoice excluded.
  const monthOf = j => String(j.invoiceDate || j.date || "").slice(0, 7);
  const allInv = done.filter(j => j.invoiceNo && !excl(j) && !j.doNotInvoice);
  const months = {}, seenNo = {};
  for (const j of allInv) { const m = monthOf(j) || "?"; (months[m] ||= { n: 0, ex: 0 }); (seenNo[m] ||= new Set()).add(String(j.invoiceNo)); months[m].ex += +j.invoiceAmount || 0; }
  // read-only box history (meta/invHist_*), already deduped against app invoice numbers when loaded
  if (!ui.invHist) loadInvHist();
  const qw = qWords();
  for (const r of ui.invHist || []) { const [no, d, addr, cl, amt, po, task] = r;
    if (qw.length && !qw.every(w => `${no} ${addr} ${cl} ${po} ${task}`.toLowerCase().includes(w))) continue;
    if (allInv.some(j => String(j.invoiceNo) === no)) continue;
    const m = String(d).slice(0, 7) || "?"; (months[m] ||= { n: 0, ex: 0 }); (seenNo[m] ||= new Set()).add(no); months[m].ex += +amt || 0; }
  for (const m in months) months[m].n = seenNo[m].size;
  const mName = m => { const [y, mo] = m.split("-"); return mo ? new Date(+y, +mo - 1, 1).toLocaleString("en-AU", { month: "short", year: "numeric" }) : "No date"; };
  const mStr = m => `${months[m]?.n || 0} invoice${months[m]?.n === 1 ? "" : "s"} · <b>${$$(months[m]?.ex || 0)}</b> ex GST · ${$$(Math.round((months[m]?.ex || 0) * 110) / 100)} inc GST`;
  const curM = todayStr().slice(0, 7);
  const stripMs = [...new Set([curM, ...Object.keys(months)])].filter(m => /^\d{4}-\d{2}$/.test(m) && m <= curM).sort().reverse().slice(0, 4);
  const strip = ui.inv === "numbered" || ui.inv === "recent" ? `<div class="minvstrip">${stripMs.map(m => `<div class="mcard${m === curM ? " cur" : ""}"><div class="mn">${esc(mName(m))}${m === curM ? " (this month)" : ""}</div><div>${mStr(m)}</div></div>`).join("")}${ui.q ? `<span class="sub">Totals for jobs matching the search</span>` : ""}
    <details class="mall"><summary>All months${ui.invHist ? "" : " (loading history…)"}</summary>${Object.keys(months).sort().reverse().map(m => `<div class="mrow"><b>${esc(mName(m))}</b> · ${mStr(m)}</div>`).join("")}<div class="sub">Includes read-only invoice history from the box records.</div></details></div>` : "";
  if (ui.inv === "numbered" || ui.inv === "recent") list.sort((a, b) => monthOf(b).localeCompare(monthOf(a)) || +b.invoiceNo - +a.invoiceNo);
  const tab = (k, n, a) => `<button data-inv="${k}" class="${ui.inv === k ? "on" : ""}">${n} <span>${a.length}</span></button>`;
  const head = ui.inv === "removed" ? `<th></th><th>Date</th><th>Client / Site</th><th>PO</th><th>Removed</th><th></th>` : ui.inv === "ready" ? `<th></th><th>Date</th><th>Client / Site</th><th>PO</th><th>Invoice description</th><th>Amount (ex GST)</th><th></th>`
    : `<th></th><th>Invoice #</th><th>Date</th><th>Contact</th><th>Reference</th><th>Description</th><th>Amount (ex GST)</th>${ui.inv === "recent" ? "<th>Marked</th>" : ""}`;
  const row = j => ui.inv === "removed"
    ? `<tr class="jr" data-id="${j.id}"><td></td><td>${esc(shortDate(j.date))}<div class="sub">#${esc(jobNo(j))}</div></td>
        <td><b>${esc(invContact(j))}</b><div class="sub">${esc(j.address || "")}</div><div class="sub">${esc(j.description || "")}</div></td>
        <td>${esc(j.po || "no PO")}</td><td class="sub">${esc(j.invoiceExcludedByName || "")} ${esc(String(j.invoiceExcludedAt || "").slice(0, 16).replace("T", " "))}</td>
        <td><button type="button" class="sm-btn irestore">↩ Restore</button></td></tr>`
    : ui.inv === "ready"
    ? `<tr class="jr" data-id="${j.id}"><td><input type="checkbox" class="isel" ${ui.invSel.has(j.id) ? "checked" : ""}></td>
        <td>${esc(shortDate(j.date))}<div class="sub">#${esc(jobNo(j))}</div></td>
        <td><b>${esc(invContact(j))}</b>${STD_CLIENTS.includes(invContact(j)) || / \(private\)$/.test(invContact(j)) ? "" : ` <span class="warnt" title="Not one of the standard ${canXero() ? "Xero " : ""}contact names">⚠</span>`}<div class="sub">${esc(j.address || "")}</div>
          <div class="sub">${esc(j.description || "")}${mixedBadge(j)}${j.loads ? ` · <b>${esc(j.loads)} loads</b>` : ""}${j.completedByName ? " · " + esc(j.completedByName) : ""}</div></td>
        <td>${isRealPo(j.po) ? esc(j.po) : `<span class="unal">${j.po ? esc(j.po) + " (not a PO)" : "no PO"}</span>`}${canSeeMoney() && j.poAmount != null ? `<div class="sub" title="${esc(j.poAmountBasis || "")}">PO value $${esc(Number(j.poAmount).toFixed(2))} ex GST</div>` : ""}</td>
        <td><input class="idesc" value="${esc(j.invoiceDescription || invDescDefault(j))}"></td>
        <td>${canSeeMoney() ? `<input class="iamt" type="number" step="0.01" min="0" placeholder="price" value="${esc(invAmountDefault(j) ?? "")}"><div class="opo">${overPoHtml(j, invAmountDefault(j))}</div>` : ""}</td>
        <td><button type="button" class="sm-btn iremove" title="Take off the to-invoice list (job is kept)">✕ Remove</button></td></tr>`
    : `<tr class="jr" data-id="${j.id}"><td>${ui.inv === "numbered" ? `<input type="checkbox" class="isel" ${ui.invSel.has(j.id) ? "checked" : ""}>` : `<input type="checkbox" class="isel" ${ui.invSel.has(j.id) ? "checked" : ""}>`}</td>
        <td class="jn">${esc(j.invoiceNo)}</td><td>${esc(xd(j.invoiceDate || j.date))}</td><td>${esc(invContact(j))}</td><td>${esc(isRealPo(j.po) ? j.po : "")}</td>
        <td>${esc(j.invoiceDescription || invDescDefault(j))}</td><td>${money(j.invoiceAmount)}<div class="opo">${overPoHtml(j)}</div>${xeroPill(j)}</td>${ui.inv === "recent" ? `<td><span class="qpill q-comp">Invoiced</span></td>` : ""}</tr>`;
  const acts = ui.inv === "removed" ? `<span class="sub">Removed jobs are kept but never invoiced or exported. Restore puts a job back on Ready to invoice.</span>` : ui.inv === "ready"
    ? `<button id="inum" class="sm-btn primary${canXero() ? " xero" : ""}" ${sel.length ? "" : "disabled"}">${canXero() ? `Send to Xero (${sel.length})` : `Assign invoice numbers &amp; download invoice CSV (${sel.length})`}</button>`
    : `<button id="icsv" class="sm-btn" ${sel.length ? "" : "disabled"}>Download ${canXero() ? "Xero" : "invoice"} CSV (${sel.length})</button>
       ${ui.inv === "numbered" ? `<button id="imark" class="sm-btn primary" ${sel.length ? "" : "disabled"}>Mark invoiced (${sel.length})</button>${canXero() ? ` <button id="ixero" class="sm-btn xero" title="Creates DRAFT invoices in Xero (not approved, not emailed). The box sends them within a few minutes." ${sel.length ? "" : "disabled"}>Send to Xero as draft (${sel.length})</button>` : ""}` : ""}`;
  return `<div class="sm-head"><h1>Invoices</h1>${canFindPo() ? `<button id="findall" class="sm-btn" title="Run Find PO on every open and not-yet-invoiced job">🔎 Find all POs</button>` : ""}<span class="sub">Next invoice number: <b id="inext">${nextInvoiceGuess()}</b></span></div>
    ${searchBar()}${strip}
    <div class="qtabs">${tab("ready", "Ready to invoice", ready)}${tab("numbered", canXero() ? "Invoiced (numbered, import into Xero)" : "Invoiced (numbered)", numbered)}${tab("recent", "Recent (last 30 days)", recent)}${tab("removed", "Removed", removed)}</div>
    <div class="filters">${acts}<label class="ck sub"><input type="checkbox" id="iall"> select all</label>
      <span class="sub">${canSeeMoney() ? `Selected total ${money(tot(sel)) || "$0.00"} ex GST` : ""}</span>
      <span class="sub muted" style="margin-left:auto">${ui.inv === "ready" ? (canXero() ? "Completed jobs with no invoice number. Price and description save as you type. Send to Xero assigns numbers and queues DRAFT invoices (not approved or emailed). Invoice date = job date, due +7 days." : "Completed jobs with no invoice number. Price and description save as you type. Invoice date = job date, due +7 days.") : ui.inv === "numbered" ? (canXero() ? "Import the CSV into Xero, then Mark invoiced." : "Import the CSV, then Mark invoiced.") : ""}</span></div>
    <table class="jt inv"><thead><tr>${head}</tr></thead><tbody>${(ui.inv === "numbered" || ui.inv === "recent" ? list.map((j, i) => (i === 0 || monthOf(list[i - 1]) !== monthOf(j) ? `<tr class="mhead"><td colspan="8"><b>${esc(mName(monthOf(j) || "?"))}</b> · ${mStr(monthOf(j) || "?")}${ui.inv === "recent" ? " (whole month)" : ""}</td></tr>` : "") + row(j)) : list.map(row)).join("") || `<tr><td colspan="8" class="muted pad">Nothing here.</td></tr>`}</tbody></table>`;
}
// Heartwood numbers from meta/invoicing (floor 5402). Other companies keep their own counter from 1 in companyMeta.
function invFloor() { return myCompanyId() === "heartwood" ? INV_FLOOR : 0; }
function invMetaRefs() {
  return myCompanyId() === "heartwood"
    ? [doc(db, "meta", "invoicing"), doc(db, "meta", "boxInvoiceMax")]
    : [doc(db, "companyMeta", myCompanyId() + "_invoicing"), null];
}
function nextInvoiceGuess() {
  const m = Math.max(invFloor(), ui.invMeta?.lastNo || 0, ui.invMeta?.boxMax || 0, ...(ui.done || []).map(j => parseInt(j.invoiceNo) || 0));
  return m + 1;
}
async function loadInvHist() {
  if (loadInvHist.busy) return; loadInvHist.busy = true;
  // meta/invHist_* is Heartwood's imported history. Other companies have none, and reading it is (rightly) denied.
  if (myCompanyId() !== "heartwood") { ui.invHist = []; return; }
  try { const ix = (await getDoc(doc(db, "meta", "invHistIndex"))).data();
    const parts = await Promise.all((ix?.years || []).map(y => getDoc(doc(db, "meta", "invHist_" + y))));
    ui.invHist = parts.flatMap(p => { try { return JSON.parse(p.data()?.rows || "[]"); } catch { return []; } });
  } catch (e) { ui.invHist = []; toast("Invoice history not loaded: " + (e.code || e.message)); }
  if (ui.view === "invoices") renderAdmin();
}
async function loadInvMeta() {
  const [mr, br] = invMetaRefs();
  const [a, b] = await Promise.all([getDoc(mr), br ? getDoc(br) : Promise.resolve(null)]).catch(e => { toast("Invoicing rules not live: " + (e.code || e.message)); return []; });
  ui.invMeta = { lastNo: a?.data()?.lastNo || 0, boxMax: b?.data()?.max || 0 };
  const el = $("#inext"); if (el) el.textContent = nextInvoiceGuess();
}
function bindInvoices(A) {
  supervisors();
  if (!ui.invMeta) loadInvMeta();
  const all = ui.done || [], byId = id => all.find(j => j.id === id);
  A.querySelectorAll("[data-inv]").forEach(b => b.onclick = () => { ui.inv = b.dataset.inv; ui.invSel.clear(); renderAdmin(); });
  A.querySelectorAll(".isel").forEach(c => c.onchange = () => { const id = c.closest("[data-id]").dataset.id; c.checked ? ui.invSel.add(id) : ui.invSel.delete(id); renderAdmin(); });
  const ia = $("#iall"); if (ia) ia.onchange = () => { A.querySelectorAll(".isel").forEach(c => { const id = c.closest("[data-id]").dataset.id; ia.checked ? ui.invSel.add(id) : ui.invSel.delete(id); }); renderAdmin(); };
  // writeJob: the price (invoiceAmount) goes to the office-only jobMoney doc and any legacy copy on the job is removed.
  const save = (el, field, conv) => el.onchange = async () => { const id = el.closest("[data-id]").dataset.id;
    try { await writeJob(id, { [field]: conv(el.value), updatedAt: serverTimestamp(), updatedBy: me.uid }); toast("Saved"); }
    catch (e) { toast("Not saved: " + (e.code || e.message)); } };
  A.querySelectorAll(".iamt").forEach(el => save(el, "invoiceAmount", v => v === "" ? null : Math.round(+v * 100) / 100));
  A.querySelectorAll(".iamt").forEach(el => el.oninput = () => { const j = byId(el.closest("[data-id]").dataset.id); const o = el.parentNode.querySelector(".opo");
    if (j && o) { o.innerHTML = overPoHtml(j, el.value); bindSup(o); } });
  const bindSup = root => root.querySelectorAll(".emailsup").forEach(b => b.onclick = ev => { ev.stopPropagation();
    const tr = b.closest("[data-id]"), j = byId(tr.dataset.id), inp = tr.querySelector(".iamt");
    if (j) emailSupervisor(j, inp ? (inp.value === "" ? null : +inp.value) : j.invoiceAmount).catch(e => toast(e.message)); });
  bindSup(A);
  A.querySelectorAll(".idesc").forEach(el => save(el, "invoiceDescription", v => v.trim() || null));
  const setExcl = async (j, on) => {
    const u = on ? { invoiceExcluded: true, invoiceExcludedAt: new Date().toISOString(), invoiceExcludedBy: me.uid, invoiceExcludedByName: me.name }
                 : { invoiceExcluded: false, invoiceRestoredAt: new Date().toISOString(), invoiceRestoredByName: me.name };
    const w = updateDoc(doc(db, "jobs", j.id), { ...u, updatedAt: serverTimestamp(), updatedBy: me.uid });   // Firestore only; nothing goes to ServiceM8
    w.catch(e => toast("Not saved: " + (e.code || e.message)));
    Object.assign(j, u); ui.invSel.delete(j.id); renderAdmin();
  };
  A.querySelectorAll(".iremove").forEach(b => b.onclick = async ev => { ev.stopPropagation();
    const j = byId(b.closest("[data-id]").dataset.id); if (!j) return;
    if (!b.classList.contains("arm")) {          // quick confirmation: second tap within 4 s
      b.classList.add("arm"); b.textContent = "Tap again to remove"; clearTimeout(b._t);
      b._t = setTimeout(() => { b.classList.remove("arm"); b.textContent = "✕ Remove"; }, 4000); return; }
    try { await setExcl(j, true); undoToast(`Removed #${jobNo(j)} from invoicing`, () => setExcl(j, false).then(() => toast("Restored"))); }
    catch (e) { toast("Not removed: " + (e.code || e.message)); } });
  A.querySelectorAll(".irestore").forEach(b => b.onclick = async ev => { ev.stopPropagation();
    const j = byId(b.closest("[data-id]").dataset.id); if (!j) return;
    try { await setExcl(j, false); undoToast(`Restored #${jobNo(j)} to Ready to invoice`, () => setExcl(j, true)); }
    catch (e) { toast("Not restored: " + (e.code || e.message)); } });
  if ($("#inum")) $("#inum").onclick = () => assignNumbers([...ui.invSel].map(byId).filter(Boolean));
  if ($("#icsv")) $("#icsv").onclick = () => downloadCsv([...ui.invSel].map(byId).filter(Boolean));
  if ($("#imark")) $("#imark").onclick = () => markInvoiced([...ui.invSel].map(byId).filter(Boolean));
  if (canXero() && $("#ixero")) $("#ixero").onclick = () => sendToXero([...ui.invSel].map(byId).filter(Boolean));
}
async function assignNumbers(list) {
  // read the current inputs (in case onchange hasn't fired yet)
  for (const j of list) { const tr = document.querySelector(`tr[data-id="${j.id}"]`); if (!tr) continue;
    const v = tr.querySelector(".iamt").value; j.invoiceAmount = v === "" ? null : Math.round(+v * 100) / 100;
    j.invoiceDescription = tr.querySelector(".idesc").value.trim() || invDescDefault(j); }
  const bad = list.filter(j => j.invoiceAmount == null || !(j.invoiceAmount >= 0) || !j.date || !invContact(j));
  if (bad.length) return alert("Set a price first for:\n" + bad.map(j => `• ${shortDate(j.date)} ${j.address}`).join("\n"));
  const nopo = list.filter(j => STD_CLIENTS.includes(invContact(j)) && !isRealPo(j.po));
  if (nopo.length && !confirm(`${nopo.length} job(s) have no PO (Reference will be blank):\n` + nopo.map(j => "• " + j.address).join("\n") + "\n\nContinue?")) return;
  const over = list.filter(j => overBy(j));      // review note only; the price is used exactly as typed
  if (over.length && !confirm(`Over PO (note only, prices are kept as entered):\n` + over.map(j => `• ${j.address} PO ${j.po}: ${$$(j.invoiceAmount)} vs PO ${$$(j.poAmount)} - Over PO by ${$$(overBy(j))}`).join("\n") + "\n\nContinue?")) return;
  // Xero users: one click assigns numbers then queues drafts (no CSV). Same confirm wording as #ixero, plus assign.
  if (canXero() && !confirm(`Assign invoice numbers and create ${list.length} DRAFT invoice${list.length === 1 ? "" : "s"} in Xero?\n\nThey are not approved or emailed. Check and approve them in Xero.`)) return;
  list.sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.id.localeCompare(b.id));   // date order, like hwdata
  let out;
  try {
    out = await runTransaction(db, async tx => {
      const [mRef, bRef] = invMetaRefs();
      const m = await tx.get(mRef); const b = bRef ? await tx.get(bRef) : null;
      const snaps = []; for (const j of list) snaps.push(await tx.get(doc(db, "jobs", j.id)));
      const taken = snaps.filter(s => s.data()?.invoiceNo); if (taken.length) throw new Error(`already numbered: ${taken.map(s => s.data().invoiceNo).join(", ")}`);
      let n = Math.max(invFloor(), m.data()?.lastNo || 0, b?.data()?.max || 0, ...(ui.done || []).map(j => parseInt(j.invoiceNo) || 0));
      const res = [];
      for (const j of list) { n++;
        const f = { invoiceNo: String(n), invoiceDescription: j.invoiceDescription, invoiceContact: invContact(j),
          invoiceDate: j.date, invoiced: false, numberedAt: serverTimestamp(), numberedBy: me.uid, updatedAt: serverTimestamp(), updatedBy: me.uid };
        // The price is office only: it goes to jobMoney/{jobId} in the same transaction; any legacy copy on the job is removed.
        tx.update(doc(db, "jobs", j.id), { ...f, invoiceAmount: deleteField() });
        tx.set(doc(db, JOB_MONEY_COLLECTION, j.id), jobMoneyDoc(j.id, myCompanyId(), { invoiceAmount: j.invoiceAmount }, { updatedAt: serverTimestamp(), updatedBy: me.uid }), { merge: true });
        res.push({ ...j, ...f, invoiceAmount: j.invoiceAmount }); }
      tx.set(mRef, { lastNo: n, updatedAt: serverTimestamp(), updatedBy: me.uid, ...(myCompanyId() === "heartwood" ? {} : { companyId: myCompanyId() }) }, { merge: true });
      return res;
    });
  } catch (e) { return alert("Numbers NOT assigned: " + txFail(e)); }
  ui.invMeta = null; ui.invSel.clear();
  if (canXero()) { ui.inv = "numbered"; await sendToXero(out, { skipConfirm: true }); }  // queues xeroQueue + xeroStatus queued; no CSV
  else { downloadCsv(out); ui.inv = "numbered"; renderAdmin(); }
}
async function markInvoiced(list) {
  if (!confirm(`Mark ${list.length} invoice(s) as invoiced${canXero() ? " (imported into Xero)" : ""}?`)) return;
  try { await Promise.all(list.map(j => updateDoc(doc(db, "jobs", j.id), { invoiced: true, invoicedAt: serverTimestamp(), invoicedBy: me.uid, updatedAt: serverTimestamp(), updatedBy: me.uid }))); }
  catch (e) { return toast("Not saved: " + (e.code || e.message)); }
  ui.invSel.clear(); toast(`Marked ${list.length} invoiced`); ui.inv = "recent"; renderAdmin();
}

// ------------------------------------------------------------------ operator
// Phone shell: cream page, coffee header, bottom tabs. Ids and data-act values stay wired to the same handlers.
const ICO = {
  today: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  jobs: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="3.5" width="15" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 8h8M8 12h8M8 16h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  photos: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3.2l1.4-2h6.8l1.4 2H20a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`,
  more: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  chat: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6.5h14a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H9l-3.5 3v-3H5a1 1 0 0 1-1-1V7.5a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  back: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6 8.5 12l6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="10" r="2.1" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`
};
const phoneTime = t => {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)?/i.exec(String(t || "").trim());
  if (!m) return t || "—";
  if (m[3]) return `${+m[1]}:${m[2]} ${m[3].toUpperCase()}`;
  let h = +m[1]; const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
};
const phonePlace = addr => {
  const raw = String(addr || "").trim();
  if (!raw) return { head: "Job", street: "", line: "", place: "", locality: "", full: "" };
  const bits = raw.split(",").map(s => s.trim()).filter(Boolean);
  const first = bits[0] || raw;
  const dot = first.split("·").map(s => s.trim()).filter(Boolean);
  const place = bits.slice(1).join(", ");
  const locality = place.replace(/\b(QLD|NSW|VIC|SA|WA|TAS|NT|ACT)\b.*$/i, "").replace(/[,\s]+$/, "").trim();
  return { head: dot[0] || first, street: dot.slice(1).join(" · "), line: first, place, locality: locality || place, full: raw };
};
const longDate = s => {
  if (!s) return "";
  const d = new Date(s + "T00:00:00Z");
  const w = d.toLocaleDateString("en-AU", { weekday: "long", timeZone: "UTC" });
  const day = d.toLocaleDateString("en-AU", { day: "numeric", timeZone: "UTC" });
  const month = d.toLocaleDateString("en-AU", { month: "long", timeZone: "UTC" });
  return `${w}, ${day} ${month}`;
};
const opTabKey = t => t === "week" ? "week" : t === "photos" ? "photos" : t === "chat" ? "chat" : t === "today" ? "today" : "more";
const opTabs = on => {
  const key = opTabKey(on);
  const tabs = [["today", "Today", ICO.today], ["week", "Jobs", ICO.jobs], ["chat", "Chat", ICO.chat], ["photos", "Photos", ICO.photos], ["more", "More", ICO.more]];
  return `<nav class="mob-tabs" aria-label="Sections">${tabs.map(([k, n, ic]) => `<button type="button" data-tab="${k}" class="${key === k ? "on" : ""}"${key === k ? ` aria-current="page"` : ""}><span class="mic">${ic}</span><span>${n}</span>${k === "chat" ? CHAT.badge("staff") : ""}</button>`).join("")}</nav>`;
};
const adminBack = () => companyViewBanner({ operator: true });
const opSeg = on => `<div class="seg mob-seg" role="group" aria-label="When">${[["today", "Today"], ["week", "Upcoming"]].map(([k, n]) => `<button type="button" data-tab="${k}" class="${on === k ? "on" : ""}">${n}</button>`).join("")}</div>`;
// Quote amounts for the crew (rubbish / concrete / material amounts). Price-free by construction (quotes.js workAmounts).
function workAmountsHtml(j, cls) {
  // Older jobs can carry a typed price in a note ("$450 cash"). Blank the price, keep the line: dropping it hid the
  // whole rubbish / concrete amount from the crew.
  const list = Array.isArray(j && j.workAmounts) ? j.workAmounts.filter(a => typeof a === "string" && a).map(noDollars).slice(0, 8) : [];
  return list.length ? `<ul class="${cls}">${list.map(a => `<li>${esc(a)}</li>`).join("")}</ul>` : "";
}
function prepareOperatorPlan(list) {
  ui.opPlan = new Map();
  const settings = dispatchSettingsNow();
  const history = dispatchHistory(list);
  const byDate = new Map();
  for (const j of list || []) {
    if (!j || !j.date) continue;
    if (!byDate.has(j.date)) byDate.set(j.date, []);
    byDate.get(j.date).push(j);
  }
  for (const [date, rows] of byDate) {
    const sheet = me ? readRunSheet(me.uid, date) : null;
    const ordered = orderJobsForRun(rows, sheet);
    for (const slot of spaceDay(ordered, { settings, history, ordered: true, reuseStored: true })) ui.opPlan.set(slot.id, slot);
  }
}
function slotFor(j) {
  const hit = (ui.opPlan && ui.opPlan.get(j.id)) || (ui.homePlan && ui.homePlan.get(j.id));
  if (hit) return hit;
  const est = estimateDuration(j, { durations: dispatchSettingsNow().durations, history: ui.dispatchHist || dispatchHistory([j]) });
  return { time: normaliseTime(j && j.time) || "", estHours: est.hours, estSource: est.source, fixed: keepsStart(j) };
}
function opCard(j) {
  const p = phonePlace(j.address);
  const crew = namesOf(j);
  const type = jobTypeText(j) || TYPES[j.type] || j.client || "Job";
  const st = j.status === "In progress" ? "inprog" : j.status === "Done" ? "done" : "";
  const stop = ui.runStops && ui.runStops[j.id];
  const slot = slotFor(j);
  return `<div class="mrow opj t-${esc(j.type || "other")}" data-id="${esc(j.id)}" role="button" tabindex="0" aria-label="${esc(type + " " + (p.line || p.full) + " " + phoneTime(slot.time || j.time))}">
    ${stop ? `<div class="run-stop">Stop ${stop}</div>` : ""}
    <div class="mtime"><b>${esc(phoneTime(slot.time || j.time))}</b><small class="est" title="${esc(slot.estSource === "quote" ? "Hours from the quote" : slot.estSource === "history" ? "Median clocked time for this kind of job" : "Default for this kind of job")}">${esc(formatEstimate(slot.estHours))}</small></div>
    <div class="mbody">${ipTop(j, "sm")}<div class="mcl"><span class="qdot ${QCLS[queueOf(j)]}"></span>${esc(type)}${jobPhotosIcon(j)}</div>
      <div class="maddr">${esc(p.line || p.full || "-")}</div>
      <div class="mdesc">${esc(p.locality || j.client || "")}</div>
      ${workAmountsHtml(j, "mamt")}
      <div class="mst ${st}">${esc(crew.length ? crew.join(", ") : "Unallocated")}<span class="sub"> · #${esc(jobNo(j))}</span></div></div>
    <div class="chev" aria-hidden="true"></div></div>`;
}
function bindOp(mine) {
  PUSH.mount($("#app"));
  refreshDesktopBanner();
  bindMasterReturn($("#app"));
  if ($("#toadmin")) $("#toadmin").onclick = () => { ui.myJobs = false; ui.opSel = null; renderAdmin(); };
  // A tab tap is a deliberate move: force the redraw, or an open Prestart/Compliance form keeps the screen (stuck until reload).
  $("#app").querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { ui.opTab = b.dataset.tab; ui.forceRender = true; renderOperator(); window.scrollTo(0, 0); });
  $("#app").querySelectorAll("[data-go]").forEach(b => b.onclick = () => { if (b.dataset.go === "swms") return swmsOverlay(); ui.opTab = b.dataset.go; renderOperator(); window.scrollTo(0, 0); });
  $("#app").querySelectorAll("[data-ps-open]").forEach(b => b.onclick = () => {
    ui.prestartKind = b.dataset.psKind || "";
    tsOpenPrestart(b.dataset.psOpen || "");
  });
  const openJob = id => { if (ui.opSel !== id) ui.jobPane = "job"; ui.opSel = id; renderOperator(); window.scrollTo(0, 0); };
  $("#app").querySelectorAll(".mrow").forEach(r => {
    r.onclick = e => { if (e.target.closest("a, button")) return; openJob(r.dataset.id); };
    r.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openJob(r.dataset.id); } };
  });
  $("#app").querySelectorAll(".hrow[data-id]").forEach(r => r.onclick = () => openJob(r.dataset.id));
  $("#app").querySelectorAll("[data-photo]").forEach(b => b.onclick = e => {
    e.stopPropagation();
    const j = (mine || []).find(x => x.id === b.dataset.photo);
    if (j) emailPhotos(j);
  });
  bindProfileExtras($("#app"));
}
function snapExists(snap) {
  if (!snap) return false;
  return typeof snap.exists === "function" ? !!snap.exists() : !!snap.exists;
}
function readRunSheet(uid, date) {
  const id = runSheetId(uid, date);
  if (!id) return null;
  ui.runSheets = ui.runSheets || {};
  if (ui.runSheets[id] === undefined) {
    ui.runSheets[id] = null;
    cachedGetDoc(doc(db, "runSheets", id)).then(snap => {
      ui.runSheets[id] = snapExists(snap) ? { id, ...snap.data() } : false;
      const sheet = ui.runSheets[id];
      if (sheet && sheet.status === "approved" && !ui.opSel && me && (me.role !== "admin" || ui.myJobs)) renderOperator();
    }).catch(() => { ui.runSheets[id] = false; });
  }
  const sheet = ui.runSheets[id];
  return sheet && sheet.status === "approved" ? sheet : null;
}
function withRunOrder(list) {
  const dates = [...new Set(list.map(j => j.date))].sort();
  const out = [];
  for (const date of dates) {
    const sheet = readRunSheet(me.uid, date);
    const rows = orderJobsForRun(list.filter(j => j.date === date), sheet);
    rows.forEach((j, i) => {
      if (sheet && Array.isArray(sheet.jobIds) && sheet.jobIds.includes(j.id)) ui.runStops[j.id] = i + 1;
      out.push(j);
    });
  }
  return out;
}
function renderOperator() {
  noteFirstScreen();
  if (!ui.opTab || ui.opTab === "home") ui.opTab = "today";
  if ((!OP_SAFE.has(ui.opTab) || ui.opSel) && !featuresOn) {
    loadFeaturePack().then(() => { if (me) renderOperator(); });
    return;
  }
  refreshAutofillLists();
  paintBrand();
  PUSH.settle();
  if (canImport()) inboxSub();
  const forceOp = ui.forceRender;
  if (!forceOp && document.querySelector("#compform, #prestartform")) return;
  ui.forceRender = false;
  if (ui.opTab === "crew" && !canSeeCrewMap(me)) ui.opTab = "more";
  if (ui.opTab === "crew" && !forceOp && document.getElementById("crewmap")) { paintCrew(); return; }
  const opCrew = canSeeCrewMap(me) && (ui.opTab === "crew" || ui.opTab === "today");
  if (!opCrew) leaveCrewScreen();
  else destroyCrewMap();
  document.body.className = "operator";
  ui.runStops = {};
  CHAT.watch(jobs);
  const t0 = todayStr(), t1 = addDays(t0, 1), wkEnd = addDays(t0, 7);
  const mine = jobs.filter(j => j.status !== "Cancelled" && (me.role !== "admin" || (j.assigned || []).includes(me.uid))).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  prepareOperatorPlan(mine);
  const sel = ui.opSel && mine.find(j => j.id === ui.opSel);
  if (sel) return renderOpDetail(sel);
  unmountDocuments();
  if (ui.opTab === "chat" && document.activeElement?.closest?.(".chat-compose")) return;
  if (ui.opTab === "quotes" && !(canQuote() && me.role !== "admin")) ui.opTab = "more";
  if (ui.opTab === "capacity" && !canSeeCapacity()) ui.opTab = "more";
  if (ui.opTab === "quotes") {
    const qhtml = adminViewRouter("quotes", ui, { esc, $$, staff, jobs: mine, todayStr, rerender: () => renderOperator(), canEditQuoteRates, isAdmin: () => !!(me && me.role === "admin") });
    paintApp(`<div class="mob">${adminBack()}<div class="mob-bar"><div class="mob-title">Quotes</div><div class="mob-sub">Guided pricing · ex GST</div></div>
      <div class="pad">${qhtml || ""}</div>${opTabs("quotes")}</div>`);
    bindOp(mine);
    QG.bindAdmin({ ui: { ...ui, view: "quotes" }, A: $("#app") });
    return;
  }
  if (!ui.tsForce && ui.opTab === "hours" && (ui.tsBusy || ui.tsAsk || (ui.tsMachineShift && document.getElementById("tsmachine"))) && !ui.opSel) return;
  if (!ui.tsForce && ui.opTab === "hours" && (ui.tsDirty || ui.tsEdit) && ($("#tsman") || $("#tsf")) && !ui.opSel) return;
  if (ui.opTab === "hours" && !ui.opSel) {
    paintApp(`<div class="mob">${adminBack()}<div class="mob-bar"><div class="mob-title">My hours</div><div class="mob-sub">Clock on, or enter hours manually</div></div>
      <div class="pad">${locationNoticeHtml()}${tsEditor()}</div>${opTabs("hours")}</div>`);
    bindOp(mine); bindTs($("#app"), renderOperator); return;
  }
  if (ui.opTab === "leave" && document.activeElement?.closest?.("#leaveform, .lv-decide")) return;
  if (ui.opTab === "leave" && !ui.opSel) {
    paintApp(`<div class="mob">${adminBack()}<div class="mob-bar"><div class="mob-title">Leave</div><div class="mob-sub">Annual, sick, or other</div></div>
      <div class="pad">${leaveScreenHtml({ requests: ui.leave || [], uid: me.uid, canDecide: leaveCanDecide(), canOpenCert: leaveCanOpen() })}</div>${opTabs("more")}</div>`);
    bindOp(mine); bindLeave($("#app")); return;
  }
  if (ui.opTab === "claims" && document.activeElement?.closest?.("#claimform, .rc-decide")) return;
  if (ui.opTab === "claims" && !ui.opSel) {
    paintApp(`<div class="mob">${adminBack()}<div class="mob-bar"><div class="mob-title">Reimbursements</div><div class="mob-sub">Claim back what you paid for</div></div>
      <div class="pad">${claimsScreenHtml(claimsArgs())}</div>${opTabs("more")}</div>`);
    bindOp(mine); bindClaims($("#app"), renderOperator); return;
  }
  if (ui.opTab === "prestart" && COMP.canPrestart()) {
    paintApp(`<div class="mob">${adminBack()}<div class="mob-bar"><div class="mob-title">Prestart</div><div class="mob-sub">Any machine · before you use it</div></div>
      ${COMP.staffHtml()}${opTabs("prestart")}</div>`);
    bindOp(mine);
    COMP.bind($("#app"));
    return;
  }
  if (ui.opTab === "prestart") ui.opTab = "more";
  if (ui.opTab === "fleet" && COMP.canSee()) {
    paintApp(`<div class="mob">${adminBack()}<div class="mob-bar"><div class="mob-title">Compliance</div><div class="mob-sub">${COMP.canEditService() ? "Fleet and servicing" : "Fleet and servicing · read only"}</div></div>
      ${COMP.staffHtml()}${opTabs("fleet")}</div>`);
    bindOp(mine);
    COMP.bind($("#app"));
    return;
  }
  if (ui.opTab === "fleet") ui.opTab = "more";
  if (ui.opTab === "take5" && take5EntryVisible({ enabled: ui.take5On !== false }) && !ui.opSel) {
    const body = canViewTake5(me)
      ? take5ListHtml(ui.take5s || [], { empty: "No Take 5s yet. Open a job and tap Start Take 5." })
      : `<p class="pad">A Take 5 is the five-step check before you start work: stop, look, assess, control, proceed. Open a job and tap <b>Start Take 5</b>.</p>`;
    paintApp(`<div class="mob">${adminBack()}<div class="mob-bar"><div class="mob-title">Take 5s</div><div class="mob-sub">Stop, look, assess, control, proceed</div></div>
      <div class="pad">${body}</div>${opTabs("more")}</div>`);
    bindOp(mine); return;
  }
  if (ui.opTab === "take5") ui.opTab = "more";
  if (ui.opTab === "staff" && document.activeElement?.closest?.("#invitef")) return;
  if (ui.opTab === "staff" && canInvite()) {
    paintApp(`<div class="mob">${adminBack()}<div class="mob-bar"><div class="mob-title">Staff</div><div class="mob-sub">Logins and invites</div></div>
      <div class="pad">${staffPageHtml()}</div>${opTabs("more")}</div>`);
    bindOp(mine); bindStaff($("#app")); return;
  }
  if (ui.opTab === "staff") ui.opTab = "more";
  if (ui.opTab === "inbox" && canImport()) {
    const pool = loadedJobs();
    paintApp(`<div class="mob">${adminBack()}<div class="mob-bar"><div class="mob-title">Inbox</div><div class="mob-sub">Import builder emails as jobs</div></div>
      ${inboxView(pool)}${opTabs("more")}</div>`);
    bindInbox($("#app")); bindOp(mine); return;
  }
  if (ui.opTab === "inbox") ui.opTab = "more";
  if (ui.opTab === "forward" && canForward()) {
    paintApp(`<div class="mob">${adminBack()}<div class="mob-bar"><div class="mob-title">Job email</div><div class="mob-sub">Forwarded mail waiting for approval</div></div>
      ${forwardView()}${opTabs("more")}</div>`);
    bindForward($("#app")); bindOp(mine); return;
  }
  if (ui.opTab === "forward") ui.opTab = "more";
  if (ui.opTab === "settings" && canEditTitles()) {
    paintApp(`<div class="mob">${adminBack()}<div class="mob-bar"><div class="mob-title">Company</div><div class="mob-sub">Trades</div></div>
      <div class="pad">${settingsView()}</div>${opTabs("more")}</div>`);
    bindOp(mine); bindSettings($("#app")); return;
  }
  if (ui.opTab === "settings") ui.opTab = "more";
  if (ui.opTab === "crew" && canSeeCrewMap(me) && !ui.opSel) {
    paintApp(`<div class="mob">${adminBack()}<div class="mob-bar"><div class="mob-title">Crew map</div><div class="mob-sub">Who is clocked on</div></div>
      <div class="pad">${crewMapScreen()}</div>${opTabs("more")}</div>`);
    bindOp(mine); openCrewScreen(); return;
  }
  if (ui.opTab === "capacity" && canSeeCapacity()) {
    paintApp(`<div class="mob">${adminBack()}<div class="pad">${capacityScreen()}</div>${opTabs("more")}</div>`);
    bindOp(mine);
    $("#app").querySelectorAll("[data-cap]").forEach(b => b.onclick = () => { ui.capWk = +b.dataset.cap === 0 ? 0 : (ui.capWk || 0) + +b.dataset.cap; renderOperator(); });
    return;
  }
  if (ui.opTab === "more") {
    const quoteBtn = canQuote() && me.role !== "admin" ? `<button type="button" class="mob-more" data-go="quotes"><b>Quotes</b><small>Guided pricing for supervisors</small></button>` : "";
    const crewBtn = canSeeCrewMap(me) ? `<button type="button" class="mob-more" data-go="crew"><b>Crew map</b><small>Who is clocked on right now</small></button>` : "";
    const capBtn = canSeeCapacity() ? `<button type="button" class="mob-more" data-go="capacity"><b>Capacity</b><small>Who is free this week</small></button>` : "";
    const fleetBtn = COMP.canSee() ? `<button type="button" class="mob-more" data-go="fleet"><b>Compliance</b><small>Registration and COI status</small></button>` : "";
    const staffBtn = canInvite() ? `<button type="button" class="mob-more" data-go="staff"><b>Staff</b><small>Everyone with a login or an invite</small></button>` : "";
    const inboxBtn = canImport() ? `<button type="button" class="mob-more" data-go="inbox"><b>Inbox</b><small>Import builder emails as jobs</small></button>` : "";
    const forwardBtn = canForward() ? `<button type="button" class="mob-more" data-go="forward"><b>Job email</b><small>Forwarded mail to approve</small></button>` : "";
    paintApp(`<div class="mob">${adminBack()}<div class="mob-bar"><div class="mob-title">More</div><div class="mob-sub">${esc(me.name || "")} · ${esc(orgSettings().name)}</div></div>
      <div class="mob-menu">
        ${crewBtn}
        <button type="button" class="mob-more" data-go="hours"><b>Hours</b><small>Clock on, or add hours manually</small></button>
        <button type="button" class="mob-more" data-go="leave"><b>Leave</b><small>Annual, sick, or other</small></button>
        <button type="button" class="mob-more" data-go="claims"><b>Reimbursements</b><small>Claim back fuel, parts, tip fees…</small></button>
        <button type="button" class="mob-more" data-go="done"><b>Completed</b><small>Finished in the last 30 days</small></button>
        <div class="mob-sec">Safety</div>
        <button type="button" class="mob-more" data-go="swms"><b>SWMS</b><small>${companyHasSwms() ? "Read and sign" : "None set up yet"}</small></button>
        ${COMP.canPrestart() ? `<button type="button" class="mob-more" data-go="prestart"><b>Prestart</b><small>Any machine, before you use it</small></button>` : ""}
        ${fleetBtn}
        <button type="button" class="mob-more incbtn" data-inc=""><b>Report incident</b><small>Safety report</small></button>
        ${take5EntryVisible({ enabled: ui.take5On !== false }) ? `<button type="button" class="mob-more" data-go="take5"><b>Take 5</b><small>Five-step check before you start a job</small></button>` : ""}
        ${capBtn}
        ${quoteBtn}
        ${staffBtn}
        ${canEditTitles() ? `<button type="button" class="mob-more" data-go="settings"><b>Company</b><small>Add or remove trades. Details and billing stay with an admin.</small></button>` : ""}
        ${inboxBtn}
        ${forwardBtn}
        <button type="button" class="mob-more" data-raise-ticket><b>Raise ticket</b><small>Tell CallUp support what went wrong</small></button>
        ${PUSH.panelHtml()}
        ${skillsEditorHtml((me.cloudProfile && me.cloudProfile.skills) || [], { canEdit: true })}
        <p class="powered pad">${esc(orgSettings().name)} · ${esc(POWERED_BY)}</p>
      </div>
      ${myIncidentsHtml()}
      ${opTabs("more")}</div>`);
    bindOp(mine); return;
  }
  if (ui.opTab === "chat") {
    paintApp(`<div class="mob">${adminBack()}
      ${CHAT.teamHtml()}
      ${opTabs("chat")}</div>`);
    bindOp(mine);
    CHAT.mount($("#app"));
    return;
  }
  if (ui.opTab === "photos") {
    const list = mine.filter(j => j.status !== "Cancelled");
    paintApp(`<div class="mob">${adminBack()}<div class="mob-bar"><div class="mob-title">Photos</div><div class="mob-sub">Email site photos to the office</div></div>
      <p class="muted pad">Choose a job to add photos. They are emailed to the office, and a private cloud copy is saved when storage accepts them.</p>
      <div class="mob-list">${list.map(j => `${opCard(j)}<button type="button" class="mnote op-photo" data-photo="${esc(j.id)}">${ICO.photos}<span>Add photos</span></button><div data-photoslot="${esc(j.id)}" data-photorole="cloud"></div>${emailedPhotosNote(j) ? `<div class="pad">${emailedPhotosNote(j)}</div>` : ""}`).join("") || `<p class="muted pad">No jobs to photograph.</p>`}</div>
      ${opTabs("photos")}</div>`);
    list.forEach(j => { rememberJob(j); watchJobPhotos(j); }); paintPhotoSlots(); bindOp(mine); return;
  }
  const isDone = j => queueOf(j) === "Completed" || queueOf(j) === "Unsuccessful";
  const open = mine.filter(j => !isDone(j));
  const doneL = mine.filter(j => queueOf(j) === "Completed" && j.date >= addDays(t0, -30) && j.date <= t0).reverse();
  const first = esc(String(me.name || "").split(" ")[0]);
  if (ui.opTab === "today") {
    const todayJobs = withRunOrder(open.filter(j => j.date === t0 || (j.date < t0 && j.status === "In progress")));
    const todaySheet = readRunSheet(me.uid, t0);
    const n = todayJobs.length;
    paintApp(`<div class="mob">${adminBack()}${bannerSlotHtml()}
      <div class="mob-intro"><div class="mob-kicker">Today · ${esc(orgSettings().name)}</div><div class="mob-date">${esc(longDate(t0))}</div>
        <h1 class="mob-hello">${esc(greet())}, ${first}</h1><p class="mob-count">${n} job${n === 1 ? "" : "s"} today</p>${todaySheet ? `<p class="run-note">Approved driving order${todaySheet.returnToDepot ? " · back to the depot" : ""}</p>` : ""}${opSeg("today")}</div>
      ${COMP.staffBannerHtml()}
      ${swmsReminderHtml()}
      ${COMP.prestartReminder(ui.prestartNotices)}
      ${locationNoticeHtml()}
      ${homeCrewCard()}
      <div class="mob-list">${todayJobs.map(opCard).join("") || `<p class="muted pad">Nothing booked for ${esc(orgSettings().name)}.</p>`}</div>
      ${opTabs("today")}</div>`);
    bindOp(mine);
    if (!ui.holdSideWork && homeCrewSlot(me) === "crew") openCrewScreen();
    return;
  }
  const groups = ui.opTab === "done" ? groupByDate(doneL).map(([d, js]) => [d === t0 ? "Today · " + dayLabel(d) : dayLabel(d), js])
    : groupByDate(withRunOrder(open.filter(j => j.date >= t1 && j.date <= wkEnd))).map(([d, js]) => [(d === t1 ? "Tomorrow · " : "") + dayLabel(d), js]);
  const upcomingN = groups.reduce((n, [, js]) => n + js.length, 0);
  const head = ui.opTab === "done"
    ? `<div class="mob-bar"><div class="mob-title">Completed</div><div class="mob-sub">Last 30 days</div></div>`
    : `<div class="mob-intro"><div class="mob-kicker">Jobs</div><div class="mob-date">Upcoming</div>
        <h1 class="mob-hello">This week</h1><p class="mob-count">${upcomingN} job${upcomingN === 1 ? "" : "s"}</p>${opSeg("week")}</div>`;
  paintApp(`<div class="mob">${adminBack()}${head}
    ${groups.map(([g, js]) => `<div class="mob-sec mday">${esc(g)} <span>${js.length}</span></div>
      ${js.map(opCard).join("") || `<p class="muted pad">Nothing booked for ${esc(orgSettings().name)}.</p>`}`).join("") || `<p class="muted pad">${ui.opTab === "done" ? "No completed jobs in the last 30 days." : "Nothing booked for " + orgSettings().name + " this week."}</p>`}
    ${opTabs(ui.opTab)}</div>`);
  bindOp(mine);
}
function renderOpDetail(j) {
  const q = queueOf(j), done = j.status === "Done", started = j.status === "In progress";
  const p = phonePlace(j.address);
  const crew = namesOf(j);
  const type = jobTypeText(j) || TYPES[j.type] || "Job";
  const addrLine = [p.street, p.place].filter(Boolean).join(", ") || p.full || j.address || "";
  const onChat = ui.jobPane === "chat";
  paintApp(`<div class="mob">${companyViewBanner()}<div class="mob-bar det ${QCLS[q]}"><button class="mback" id="back" type="button">${ICO.back}<span class="sr">Jobs</span></button>
      <div class="mob-bar-txt"><div class="mob-title">Job details</div>${started ? ipTop(j, "onbar") : ""}<div class="mob-sub">${done ? "Completed" : started ? "In progress" : "Scheduled"} · #${esc(jobNo(j))}</div>
        <div class="mob-brandline"><span class="wordmark" aria-label="${esc(PRODUCT_NAME)}">Call<span>Up</span></span><span class="orgbit">${esc(orgSettings().name)}</span></div></div></div>
    <div class="job-switch" role="tablist" aria-label="Job sections">
      <button type="button" data-jtab="job" class="${onChat ? "" : "on"}">Job</button>
      <button type="button" data-jtab="chat" class="${onChat ? "on" : ""}">Chat ${CHAT.badge("job_" + j.id)}</button>
    </div>
    <div class="job-chat"${onChat ? "" : " hidden"}></div>
    <div class="det-body"${onChat ? " hidden" : ""}>
      <div class="typepill">${esc(type)}</div>
      <h1 class="det-lot">${esc(p.head || "Job")}</h1>
      <p class="det-addr">${esc(addrLine || "-")}</p>
      <div class="mcard"><div class="mlbl">Client</div><div class="mval">${esc(j.client || "—")}</div><div class="supcard" data-sup="${esc(j.id)}"></div></div>
      <dl class="det-facts">
        <div><dt>Scheduled</dt><dd>${esc(j.date ? longDate(j.date) : "Unscheduled")}${slotFor(j).time ? " · " + esc(phoneTime(slotFor(j).time)) : ""} · ${esc(formatEstimate(slotFor(j).estHours))}</dd></div>
        <div><dt>Crew</dt><dd>${esc(crew.length ? crew.join(", ") : "—")}</dd></div>
        <div><dt>Purchase order</dt><dd><b>${esc(j.po || "—")}</b></dd></div>
        <div class="scope"><dt>Scope</dt><dd>${esc(crewText(j.description) || "—")}</dd></div>
        ${Array.isArray(j.workAmounts) && j.workAmounts.length ? `<div class="scope"><dt>Amounts</dt><dd>${workAmountsHtml(j, "det-amt")}</dd></div>` : ""}
        ${jobStepsHtml(j, ui.tradeSetup) ? `<div class="scope"><dt>${esc(jobStepsScopeLabel(j, ui.tradeSetup))}</dt><dd>${jobStepsHtml(j, ui.tradeSetup)}</dd></div>` : ""}
      </dl>
      <div class="mcard"><div class="mlbl">Diary</div>${(j.log || []).map(l => `<div class="de"><span class="av">${esc((l.byName || "?")[0])}</span><div><small>${esc(l.byName)} · ${esc(l.at)}</small><div>${esc(l.text)}</div></div></div>`).join("") || `<div class="muted sub">No notes yet</div>`}
        <button class="mnote" type="button" data-act="note">Add note</button></div>
      <div class="mcard"><div class="mlbl">Photos</div><div data-photoslot="${esc(j.id)}" data-photorole="cloud"></div>${emailedPhotosNote(j)}<div class="muted sub">Cloud photos are the private copies stored for this job.</div></div>
      <div class="mcard job-docs" data-job-docs="${esc(j.id)}"></div>
      <div class="mcard safecard"><div class="mlbl">Safety</div>${companyHasSwms() ? `<button type="button" class="mnote" data-swms="${j.id}">View SWMS</button>` : ""}<button type="button" class="mnote incbtn" data-inc="${j.id}">Report incident</button>
        ${take5EntryVisible({ enabled: ui.take5On !== false }) || (ui.take5s || []).some(row => row.jobId === j.id) ? `<div id="take5slot">${take5StartButtonHtml({ enabled: ui.take5On !== false, done: hasTake5(ui.take5s, me.uid, j.id) })}${take5JobHtml(ui.take5s || [], j.id, { ownUid: me.uid, canView: canViewTake5(me) })}</div>` : ""}</div>
      <div class="mcard">${jobReceiptsHtml(j)}</div>
    </div>
    <div class="mactions"${onChat ? " hidden" : ""}>${done ? `<div class="donebar">Completed${j.loads ? ` · ${esc(j.loads)} loads` : ""}</div>` :
      `<button class="mbtn start" type="button" data-act="start" ${started ? "disabled" : ""}>${ICO.play}<span>${started ? "Started" : "Start job"}</span></button>
       <button class="mbtn complete" type="button" data-act="done">Complete job</button>`}
      <button type="button" class="mbtn mnote op-photo" id="emailph">${ICO.photos}<span>Add photos</span></button>
      <button type="button" class="mbtn outline" id="emailjob">Email job</button>
      <a class="mcard link mbtn outline" href="${mapsUrl(j.address || "")}" target="_blank" rel="noopener">${ICO.pin}<span>Get directions</span></a>
    </div></div>`);
  rememberJob(j); bindMasterReturn($("#app")); $("#emailph").onclick = () => emailPhotos(j); $("#emailjob").onclick = () => { openJobEmail(j).catch(e => toast(e.message || "Couldn't open the email")); }; const startTake = $("#starttake5"); if (startTake) startTake.onclick = () => openTake5(j); wireJobReceipts(j); fillSupCard(j); watchJobPhotos(j); paintPhotoSlots();
  wireJobDocuments(document.querySelector("[data-job-docs]"), j);
  if (!hasTake5(ui.take5s, me.uid, j.id)) rememberOwnTake5(j);
  const showJobPane = which => {
    ui.jobPane = which === "chat" ? "chat" : "job";
    $("#app").querySelectorAll("[data-jtab]").forEach(b => { b.classList.toggle("on", b.dataset.jtab === ui.jobPane); b.setAttribute("aria-selected", b.dataset.jtab === ui.jobPane ? "true" : "false"); });
    const chatOn = ui.jobPane === "chat";
    document.querySelector(".det-body")?.toggleAttribute("hidden", chatOn);
    document.querySelector(".mactions")?.toggleAttribute("hidden", chatOn);
    const pane = document.querySelector(".job-chat");
    pane?.toggleAttribute("hidden", !chatOn);
    if (chatOn) CHAT.openJob(pane, j);
  };
  $("#app").querySelectorAll("[data-jtab]").forEach(b => b.onclick = () => showJobPane(b.dataset.jtab));
  if (onChat) CHAT.openJob(document.querySelector(".job-chat"), j);
  $("#back").onclick = () => { ui.opSel = null; ui.jobPane = "job"; renderOperator(); };
  $("#app").querySelectorAll("[data-act]").forEach(b => b.onclick = () => opAction(j, b.dataset.act));
}
const logEntry = text => ({ text, by: me.uid, byName: me.name, at: new Date().toLocaleString("en-AU", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }) });
async function opAction(j, act) {
  const ref = doc(db, "jobs", j.id), base = { updatedAt: serverTimestamp(), updatedBy: me.uid };
  if (act === "start") {
    if (shouldPromptTake5(me, ui.take5On !== false) && !hasTake5(ui.take5s, me.uid, j.id)) {
      const existing = await getDoc(doc(db, "take5s", take5IdFor(me.uid, j.id))).catch(() => null);
      if (!(existing && existing.exists())) { openTake5(j, () => startJobDoc(j)); return; }
    }
    await startJobDoc(j); return;
  }
  const d = $("#dlg"); d.className = ""; d.onclose = null;
  d.innerHTML = `<form method="dialog" id="of" class="jf"><h2>${act === "done" ? "Complete job" : "Add note"}</h2>
    <p class="muted">${esc(j.address)}</p>
    ${act === "done" ? `<label>Loads (optional)<input name="loads" type="number" inputmode="numeric" min="0" value="${esc(j.loads ?? "")}"></label>` : ""}
    <label>Note${act === "done" ? " (optional)" : ""}<textarea name="note" rows="3" ${act === "note" ? "required" : ""}></textarea></label>
    <div class="btns"><button value="cancel" formnovalidate class="ghost big">Cancel</button><button value="ok" class="primary big">${act === "done" ? "Complete ✔" : "Save note"}</button></div></form>`;
  d.showModal();
  $("#of").onsubmit = async ev => {
    if (ev.submitter?.value !== "ok") return;
    ev.preventDefault(); const f = ev.target, note = f.note.value.trim();
    const u = { ...base };
    if (note) u.log = arrayUnion(logEntry(note));
    if (act === "done") Object.assign(u, { status: "Done", completedAt: serverTimestamp(), completedBy: me.uid, completedByName: me.name,
      loads: f.loads.value === "" ? null : +f.loads.value });
    d.close();
    queueWrite(updateDoc(ref, u), { id: "job-" + act + ":" + j.id, kind: act === "done" ? "status" : "note", label: act === "done" ? "Complete job " + jobNo(j) : "Job note" }, act === "done" ? "Marked done" : "Note saved").catch(e => toast("Not saved: " + (e.code || e.message)));
  };
}

function emailActorRole() {
  if (!me) return "operator";
  const profileRole = (me.cloudProfile && me.cloudProfile.role) || "";
  if (canSeeMoney()) {
    for (const role of [me.role, me.staffRole, profileRole]) {
      if (role === "admin" || role === "manager" || role === "supervisor") return role;
    }
    return "supervisor";
  }
  return profileRole === "labourer" || me.role === "labourer" || me.staffRole === "labourer" ? "labourer" : "operator";
}
async function emailJobDocuments(job) {
  const role = documentActorRole();
  const col = collection(db, "jobs", job.id, "documents");
  const src = canManageDocuments(role) ? col : query(col, where("visibility", "==", "crew"));
  try {
    const snap = await getDocs(src);
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(row => docCompanyId(row) === myCompanyId());
  } catch {
    return [];
  }
}
async function emailJobReceipts(job) {
  // Same read as the job card: Alex sees the job's receipts, everyone else only their own.
  // Crew never reach this. Receipt images show dollar amounts.
  if (!canSeeMoney() || !job || !job.id) return [];
  const col = collection(db, "receipts");
  const src = isOwner()
    ? query(col, where("jobId", "==", job.id))
    : query(col, where("jobId", "==", job.id), where("uid", "==", me.uid));
  try {
    const snap = await getDocs(src);
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(row => docCompanyId(row) === myCompanyId());
  } catch {
    return [];
  }
}
async function emailQuote(job) {
  if (!canSeeMoney() || !job || !job.quoteId) return null;
  try {
    const snap = await getDoc(doc(db, "quotes", job.quoteId));
    if (!snap.exists()) return null;
    const row = snap.data() || {};
    return docCompanyId(row) === myCompanyId() ? row : null;
  } catch {
    return null;
  }
}
async function copyEmailText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* the field below still copies on older phones */ }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  area.remove();
  return ok;
}
async function prepareEmailFiles(items, onProgress) {
  const files = [];
  for (let i = 0; i < items.length; i++) {
    onProgress(i + 1, items.length);
    // Same private getBlob the gallery uses. No download URL is created.
    const blob = await blobForPhoto(items[i].path);
    const compressed = await compressImageBlob(blob);
    files.push(new File([compressed.blob], jpegName(items[i].name, i), { type: "image/jpeg" }));
  }
  const names = uniqueNames(files.map(file => file.name));
  return files.map((file, i) => new File([file], names[i], { type: "image/jpeg" }));
}
async function downloadEmailZip(files) {
  const rows = [];
  for (const file of files) rows.push({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) });
  const packed = photosZip(rows);
  if (!packed.ok) return false;
  const url = URL.createObjectURL(new Blob([packed.zip], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "job-photos.zip";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}
async function openJobEmail(job) {
  if (!job || !job.id) return;
  if (docCompanyId(job) !== myCompanyId()) return toast("That job belongs to another company.");
  await ensurePhotoList(job).catch(() => {});
  await loadClients().catch(() => {});
  await loadEmailRecipients();
  const row = ui.photoLists[job.id];
  const listing = row && row.gallery && row.gallery.ok ? row.gallery.photos : [];
  const photoError = !!(row && row.status === "error");
  const [documents, receiptRows, quote] = await Promise.all([emailJobDocuments(job), emailJobReceipts(job), emailQuote(job)]);
  const role = emailActorRole();
  const picked = selectEmailAttachments({
    membership: cloudMembership(), job, companyId: myCompanyId(), role, listing, receipts: receiptRows,
  });
  if (!picked.ok) return toast("You can't email this job.");
  const moneyJob = canSeeMoney() ? withMoney(job) : job;
  const suggested = suggestRecipient(job, clientOf(job.client));
  let shareOk = deviceCanShareFiles();
  let allowLarge = false;
  const chosen = () => {
    const box = document.getElementById("jobemail");
    if (!box) return picked.attachments;
    const ids = [];
    box.querySelectorAll("[data-jem-index]:checked").forEach(el => {
      const index = Number(el.dataset.jemIndex);
      const item = el.dataset.jemKind === "receipt" ? picked.receipts[index] : picked.photos[index];
      if (item) ids.push(item.id);
    });
    const again = selectEmailAttachments({
      membership: cloudMembership(), job, companyId: myCompanyId(), role, listing, receipts: receiptRows, pickedIds: ids,
    });
    return again.ok ? again.attachments : [];
  };
  const builtFor = items => buildJobEmail({
    job: moneyJob,
    company: orgSettings(),
    companyId: myCompanyId(),
    role,
    documentRole: documentActorRole(),
    typeLabels: TYPES,
    documents,
    photos: items.filter(item => item.kind === "photo"),
    receipts: items.filter(item => item.kind === "dump-receipt"),
    quote: canSeeMoney() ? quote : null,
    recipient: (document.getElementById("jemto") || {}).value || suggested.email,
  });
  const first = builtFor(picked.attachments);
  if (!first.ok) return toast("You can't email this job.");
  const host = document.querySelector("dialog[open]") || document.body;
  host.querySelectorAll("#jobemail").forEach(node => node.remove());
  const v = document.createElement("div");
  v.id = "jobemail";
  v.className = "emdlg";
  v.innerHTML = emailSheetHtml({
    subject: first.subject, body: first.body, to: suggested.email, suggestion: suggested.email,
    suggestions: currentSuggestions().email,
    photos: picked.photos, receipts: picked.receipts, photoError,
  });
  host.appendChild(v);
  const subjectEl = v.querySelector("#jemsubj");
  const bodyEl = v.querySelector("#jembody");
  const warnEl = v.querySelector("#jemwarn");
  const stateEl = v.querySelector("#jemstate");
  const progEl = v.querySelector("#jemprog");
  const sendBtn = v.querySelector("#jemsend");
  const mailLink = v.querySelector("#jemmail");
  const zipBtn = v.querySelector("#jemzip");
  const toInput = v.querySelector("#jemto");
  const ccInput = v.querySelector("#jemcc");
  const setProg = msg => { progEl.hidden = !msg; progEl.textContent = msg || ""; };
  const setState = msg => { stateEl.hidden = !msg; stateEl.textContent = msg || ""; };
  const paint = () => {
    const items = chosen();
    const built = builtFor(items);
    if (!built.ok) return;
    subjectEl.textContent = built.subject;
    bodyEl.textContent = built.body;
    const plan = emailSendPlan({ canShareFiles: shareOk, attachmentCount: items.length });
    mailLink.href = mailtoHref({ to: toInput.value, subject: built.subject, body: built.body }).href;
    zipBtn.hidden = !plan.download;
    if (!allowLarge && sendBtn.dataset.sent !== "1") warnEl.hidden = true;
    if (!deviceOnline() && sendBtn.dataset.sent !== "1") {
      sendBtn.disabled = true;
      warnEl.hidden = false;
      warnEl.textContent = needsSignal("email-job", false).message;
    }
  };
  function sentLine(result, fallbackTo) {
    const who = (result.to && result.to.length ? result.to : fallbackTo).join(", ");
    let line = `Sent to ${who}.`;
    const attached = Number(result.attached) || 0;
    const linked = Number(result.overflowCount != null ? result.overflowCount : result.overflow) || 0;
    const compressed = Number(result.compressed) || 0;
    const dockets = Number(result.compressedReceipts) || 0;
    const skipped = Number(result.skipped) || 0;
    if (attached) line += ` ${attached} file${attached === 1 ? "" : "s"} attached.`;
    if (compressed) line += ` ${compressed} photo${compressed === 1 ? "" : "s"} compressed to fit.`;
    if (dockets) line += ` ${dockets} tip docket${dockets === 1 ? "" : "s"} compressed to fit.`;
    if (skipped) line += ` ${skipped} file${skipped === 1 ? "" : "s"} skipped.`;
    if (linked) line += ` ${linked} file${linked === 1 ? " was" : "s were"} too large and ${linked === 1 ? "is" : "are"} linked in the email for people signed in to this company.`;
    return line;
  }
  async function sendViaCallUp() {
    if (sendBtn.dataset.sent === "1") return;
    // Not queued: the callable's idempotency key includes the send time, so a later retry could email twice.
    if (!emailOutboxAllowed() && !deviceOnline()) {
      warnEl.hidden = false;
      warnEl.textContent = needsSignal("email-job", false).message;
      return;
    }
    const recipients = parseEmailRecipients({ to: toInput.value, cc: ccInput ? ccInput.value : "" });
    if (!recipients.ok) {
      warnEl.hidden = false;
      warnEl.textContent = "Enter a valid email address. You can send to 5 addresses at most.";
      return;
    }
    sendBtn.disabled = true;
    warnEl.hidden = true;
    setState("Sending…");
    try {
      const result = await callAuthed("sendJobEmail", { jobId: job.id, to: toInput.value, cc: ccInput ? ccInput.value : "" });
      if (!result || result.ok !== true) throw new Error("Couldn't send that email. Try again in a minute.");
      setState(sentLine(result, recipients.to));
      sendBtn.dataset.sent = "1";
      sendBtn.textContent = "Sent";
      rememberSentEmails([...(recipients.to || []), ...(recipients.cc || [])]);
    } catch (e) {
      setState("");
      warnEl.hidden = false;
      warnEl.textContent = (e && e.message) || "Couldn't send that email. Try again in a minute.";
      if (sendBtn.isConnected) sendBtn.disabled = false;
    }
  }
  async function shareOther(force) {
    const items = chosen();
    const built = builtFor(items);
    if (!built.ok || !items.length) return;
    try {
      setProg(`Downloading file 1 of ${items.length}…`);
      const files = await prepareEmailFiles(items, (n, total) => setProg(`Downloading file ${n} of ${total}…`));
      const budget = photoBudget(files);
      if (budget.over && !force) {
        allowLarge = true;
        warnEl.hidden = false;
        warnEl.textContent = budget.message;
        return;
      }
      if (navigator.canShare && navigator.canShare({ files })) {
        await navigator.share({
          files,
          title: built.subject,
          text: shareText({ to: toInput.value, subject: built.subject, body: built.body }),
        });
        return;
      }
      shareOk = false;
      allowLarge = false;
      paint();
      toast("This device can't attach files. Use the mail link and download the photos.");
    } catch (e) {
      if (!e || e.name !== "AbortError") {
        shareOk = false;
        allowLarge = false;
        paint();
        toast("Couldn't open the share sheet. Use the mail link instead.");
      }
    } finally {
      setProg("");
    }
  }
  v.onclick = ev => { if (ev.target === v) v.remove(); };
  v.querySelector("#jemx").onclick = () => v.remove();
  const useBtn = v.querySelector("#jemuse");
  if (useBtn) useBtn.onclick = () => { toInput.value = suggested.email; paint(); };
  const noneBtn = v.querySelector("#jemnone");
  if (noneBtn) noneBtn.onclick = () => {
    v.querySelectorAll('[data-jem-kind="photo"]').forEach(el => { el.checked = false; });
    allowLarge = false;
    paint();
  };
  v.querySelectorAll("[data-jem-index]").forEach(el => el.addEventListener("change", () => { allowLarge = false; paint(); }));
  toInput.addEventListener("input", paint);
  if (ccInput) ccInput.addEventListener("input", () => { if (sendBtn.dataset.sent !== "1") warnEl.hidden = true; });
  sendBtn.onclick = () => { sendViaCallUp().catch(e => toast(e.message || "Couldn't send that email")); };
  mailLink.onclick = async ev => {
    const plan = emailSendPlan({ canShareFiles: shareOk, attachmentCount: chosen().length });
    if (plan.channel === "share") {
      ev.preventDefault();
      await shareOther(allowLarge);
      return;
    }
    if (!plan.download) return;
    const items = chosen();
    if (!items.length) return;
    try {
      const files = await prepareEmailFiles(items, (n, total) => setProg(`Downloading file ${n} of ${total}…`));
      const saved = await downloadEmailZip(files);
      if (!saved) toast("Couldn't build the download. The mail app is still opening.");
    } catch {
      toast("Couldn't download a file. The mail app is still opening.");
    } finally {
      setProg("");
    }
  };
  v.querySelector("#jemcopy").onclick = async () => {
    const built = builtFor(chosen());
    if (!built.ok) return;
    const ok = await copyEmailText(shareText({ to: toInput.value, subject: built.subject, body: built.body }));
    toast(ok ? "Copied" : "Couldn't copy. Select the preview and copy it.");
  };
  zipBtn.onclick = async () => {
    const items = chosen();
    if (!items.length) return;
    zipBtn.disabled = true;
    try {
      const files = await prepareEmailFiles(items, (n, total) => setProg(`Downloading file ${n} of ${total}…`));
      const budget = photoBudget(files);
      if (budget.over) { warnEl.hidden = false; warnEl.textContent = budget.message; }
      const saved = await downloadEmailZip(files);
      toast(saved ? "Photos downloaded. Attach them to the email." : "Couldn't build the download.");
    } catch (e) {
      toast("Couldn't download a file. Nothing was saved.");
      console.warn("job email files", e && (e.code || e.message) || e);
    } finally {
      setProg("");
      zipBtn.disabled = false;
    }
  };
  paint();
}

// ------------------------------------------------------------------ email photos
// Pick photos -> (downscale) -> share sheet (Mail / Gmail) with subject + body, or a mailto: fallback. Then a diary entry.
// Accepted files are also mirrored to private Storage. The gallery reads those objects back and does not rewrite the job.
// The share must be started by a fresh tap (browsers require a user gesture), so the picked photos are shown in a
// small dialog with a "Send" button.
// Photos go to this company's office email (Heartwood: alex@heartwoodew.com via org defaults).
const officeEmail = () => orgSettings().email || (myCompanyId() === "heartwood" ? "alex@heartwoodew.com" : "");
const emailSubject = j => `[Job Photos] Job #${jobNo(j)} – ${j.address || "(no address)"}`;
const emailBody = (j, infos, attached) => [`Job #${jobNo(j)}`, `Address: ${j.address || "-"}`, `Client: ${j.client || "-"}`, `PO: ${j.po || "-"}`,
  `Job date: ${j.date ? dayLabel(j.date) : "-"}`, "",
  attached ? `${infos.length} photo${infos.length > 1 ? "s" : ""} attached:` : `Please attach ${infos.length > 1 ? `these ${infos.length} photos` : "this photo"} to this email:`,
  ...infos.map((x, i) => `${i + 1}. ${x.time} (Brisbane) · ${fmtLL(x.gps)}${x.gps ? ` (${x.gps.src === "photo" ? "photo GPS" : "phone location"}) ${mapLink(x.gps)}` : ""}`),
  "", `From ${me.name}`, orgSettings().signoff, POWERED_BY].join("\n");
// Minimal EXIF reader (JPEG APP1): DateTimeOriginal + GPS. Returns {}, never throws.
async function readExif(f) {
  try {
    const v = new DataView(await f.slice(0, 256 * 1024).arrayBuffer());
    if (v.getUint16(0) !== 0xFFD8) return {};
    let o = 2;
    while (o + 4 < v.byteLength) {
      const m = v.getUint16(o), len = v.getUint16(o + 2);
      if (m === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) return parseTiff(v, o + 10);
      if ((m & 0xFF00) !== 0xFF00) break; o += 2 + len;
    }
  } catch {}
  return {};
}
function parseTiff(v, t) {
  const le = v.getUint16(t) === 0x4949, u16 = o => v.getUint16(o, le), u32 = o => v.getUint32(o, le);
  const ifd = off => { const out = {}, n = u16(t + off); for (let i = 0; i < n; i++) { const e = t + off + 2 + i * 12; out[u16(e)] = { type: u16(e + 2), cnt: u32(e + 4), at: e + 8 }; } return out; };
  const str = e => { const p = e.cnt > 4 ? t + u32(e.at) : e.at; let r = ""; for (let i = 0; i < e.cnt - 1; i++) r += String.fromCharCode(v.getUint8(p + i)); return r; };
  const rats = e => { const p = t + u32(e.at); return [...Array(e.cnt)].map((_, i) => u32(p + i * 8) / (u32(p + i * 8 + 4) || 1)); };
  const out = {}, i0 = ifd(u32(t + 4));
  if (i0[0x8769]) { const ex = ifd(u32(i0[0x8769].at)); const d = ex[0x9003] || ex[0x9004]; if (d) out.taken = str(d); }
  if (!out.taken && i0[0x0132]) out.taken = str(i0[0x0132]);
  if (i0[0x8825]) {
    const g = ifd(u32(i0[0x8825].at));
    if (g[2] && g[4]) {
      const dms = a => a[0] + a[1] / 60 + a[2] / 3600, ref = k => g[k] ? String.fromCharCode(v.getUint8(g[k].at)) : "";
      out.lat = dms(rats(g[2])) * (ref(1) === "S" ? -1 : 1); out.lng = dms(rats(g[4])) * (ref(3) === "W" ? -1 : 1);
    }
  }
  return out;
}
// EXIF "YYYY:MM:DD HH:MM:SS" is camera-local (phones here = Brisbane); lastModified is an instant.
function takenAt(f, ex) {
  const m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d)/.exec(ex.taken || "");
  if (m) return { label: `${+m[3]}/${+m[2]}/${m[1]} ${m[4]}:${m[5]}`, src: "camera" };
  const d = new Date(f.lastModified || Date.now());
  return { label: d.toLocaleString("en-AU", { timeZone: TZ, day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", ""), src: "file" };
}
let geoAsked = null;
function hereNow() {     // asked once per session; resolves null if denied / unavailable
  if (!navigator.geolocation) return Promise.resolve(null);
  if (geoAsked) return geoAsked;
  geoAsked = new Promise(r => navigator.geolocation.getCurrentPosition(p => r({ lat: p.coords.latitude, lng: p.coords.longitude }), () => r(null),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 120000 }));
  geoAsked.then(x => { if (!x) setTimeout(() => { geoAsked = null; }, 60000); });
  return geoAsked;
}
const fmtLL = g => g ? `${g.lat.toFixed(5)}, ${g.lng.toFixed(5)}` : "location unavailable";
const mapLink = g => g ? `https://maps.google.com/?q=${g.lat.toFixed(5)},${g.lng.toFixed(5)}` : "";
// Stamp (always) + downscale (unless keeping full size): black bar at the bottom, job number big, then time, GPS, address.
async function stampPhoto(f, j, info, max) {
  try {
    const bmp = await createImageBitmap(f, { imageOrientation: "from-image" });
    const k = max ? Math.min(1, max / Math.max(bmp.width, bmp.height)) : 1;
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext("2d"); g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
    const u = Math.max(14, Math.round(Math.min(c.width, c.height) / 40)), pad = Math.round(u * 0.7);
    const lines = [[`${info.time}   ·   ${fmtLL(info.gps)}`, u], [j.address || "", u]];
    const barH = pad * 2 + Math.round(u * 2.2) + lines.length * Math.round(u * 1.35);
    g.fillStyle = "rgba(0,0,0,0.6)"; g.fillRect(0, c.height - barH, c.width, barH);
    g.fillStyle = "#fff"; g.textBaseline = "top";
    let y = c.height - barH + pad;
    g.font = `bold ${Math.round(u * 1.9)}px system-ui, sans-serif`; g.fillText(`JOB #${jobNo(j)}`, pad, y); y += Math.round(u * 2.2);
    for (const [t, sz] of lines) { g.font = `${sz}px system-ui, sans-serif`; g.fillText(t, pad, y, c.width - pad * 2); y += Math.round(sz * 1.35); }
    const b = await new Promise(r => c.toBlob(r, "image/jpeg", max ? 0.85 : 0.92));
    return b ? new File([b], `job${jobNo(j)}_${f.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" }) : f;
  } catch { return f; }       // a format the browser can't decode: send the original unstamped
}
function recordPhotosCaptured(j, n, o = {}) {
  updateDoc(doc(db, o.coll || "jobs", j.id), { photosEmailedAt: new Date().toISOString(), photosEmailedCount: (j.photosEmailedCount || 0) + n, updatedAt: serverTimestamp(), updatedBy: me.uid })
    .catch(e => console.warn("photosEmailed flag not saved", e.code || e.message));
}
function emailPhotos(j, o = {}) {
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
  inp.style.cssText = "position:fixed;left:-9999px;opacity:0"; document.body.appendChild(inp);
  inp.onchange = async () => {
    const picked = [...inp.files].filter(f => /^image\//.test(f.type || "image/jpeg")); inp.remove();
    if (!picked.length) return;
    toast("Preparing photos…");
    const exifs = await Promise.all(picked.map(readExif));
    const here = exifs.every(e => e.lat != null) ? null : await hereNow();
    const keep = picked.length <= 3 && picked.reduce((a, f) => a + f.size, 0) <= 20e6;
    const infos = picked.map((f, i) => ({ name: f.name, time: takenAt(f, exifs[i]).label,
      gps: exifs[i].lat != null ? { lat: exifs[i].lat, lng: exifs[i].lng, src: "photo" } : here && { ...here, src: "phone" } }));
    const files = await Promise.all(picked.map((f, i) => stampPhoto(f, j, infos[i], keep ? 0 : 2560)));
    await afterPhotosPrepared(j, files, infos, o);
  };
  inp.click();
}
async function afterPhotosPrepared(j, files, infos, o = {}) {
  let mirror = null;
  if (!o.coll || o.coll === "jobs") {
    toast("Saving photos to the job…");
    try { mirror = await mirrorJobPhotos(j, files); }
    catch (e) {
      console.warn("cloud photo mirror", e && (e.code || e.message) || e);
      mirror = { ok: false, reason: e && (e.code || e.message) || "mirror-failed", uploaded: [], skipped: files.map((f, sourceIndex) => ({ sourceIndex, name: f && f.name, reason: "mirror-failed" })) };
    }
  }
  const decision = decidePhotoEmail({ collection: o.coll, mirror, fileCount: files.length });
  if (decision.reason === "queued") {
    toast(SAVED_ON_PHONE);
    paintPhotoSlots();
    return;
  }
  if (!decision.email) {
    recordPhotosCaptured(j, files.length, o);
    const n = files.length;
    const ref = doc(db, "jobs", j.id);
    try {
      await updateDoc(ref, { log: arrayUnion(logEntry(`Photos saved (${n}) by ${me.name}: ` + infos.map(x => `${x.time} @ ${fmtLL(x.gps)}`).join("; "))), updatedAt: serverTimestamp(), updatedBy: me.uid });
      toast("Photos saved to the job");
    } catch (e) { toast("Photos saved, but the diary was not updated: " + (e.code || e.message)); }
    return;
  }
  if (decision.reason === "partial-mirror" && decision.storedCount) recordPhotosCaptured(j, decision.storedCount, o);
  const idx = decision.fileIndexes;
  const emailFiles = idx ? idx.map(i => files[i]).filter(Boolean) : files;
  const emailInfos = idx ? idx.map(i => infos[i]) : infos;
  const why = (mirror && mirror.skipped || []).map(x => x && x.reason).find(Boolean) || decision.reason;
  const captured = j.photosEmailedCount || 0;
  const jobForDialog = decision.storedCount ? { ...j, photosEmailedCount: captured + decision.storedCount } : j;
  emailDialog(jobForDialog, emailFiles, emailInfos, { ...o, saveFail: why });
}
function photoFailText(reason) {
  const r = String(reason || "");
  if (r === "offline") return "no signal on this phone";
  if (r === "upload-stalled") return "the upload stopped moving (weak signal)";
  if (r === "storage/retry-limit-exceeded") return "the upload kept failing (weak signal)";
  if (r === "storage/unauthorized" || r === "storage/unauthenticated") return `the app was not allowed to save them (${r})`;
  if (r === "mime-not-allowed") return "this photo type can't be saved (for example HEIC)";
  if (r === "too-large") return "a photo is bigger than 15 MB";
  if (r === "too-many-files") return "more than 10 photos at once";
  return r;
}
function emailDialog(j, files, infos, o = {}) {
  const subj = o.subject || emailSubject(j), body = o.body || emailBody;
  // Job-photo Storage already ran in afterPhotosPrepared. Incident photos are email-only.
  recordPhotosCaptured(j, files.length, o);
  const mb = files.reduce((a, f) => a + f.size, 0) / 1e6, n = files.length;
  const canShare = !!(navigator.canShare && navigator.canShare({ files }));
  const mailto = `mailto:${officeEmail()}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body(j, infos, false))}`;
  const v = document.createElement("div"); v.className = "emdlg";
  v.innerHTML = `<div class="embox"><h3>📧 Email ${n} photo${n > 1 ? "s" : ""}</h3>${!o.coll || o.coll === "jobs" ? `<p class="sub">These photos could not be saved to the job, so they still need to be emailed to the office.</p>${o.saveFail ? `<p class="sub muted">Why: ${esc(photoFailText(o.saveFail))}</p>` : ""}` : ""}
    <div class="emthumbs">${files.map(f => `<img src="${URL.createObjectURL(f)}" alt="">`).join("")}</div>
    <p class="sub muted">${o.coll ? esc(j.reportNo) : "Job #" + esc(jobNo(j))} · ${esc(j.address || "")} · ${mb.toFixed(1)} MB${mb > 24 ? " — may be too big for one email, send fewer at a time" : ""}</p>
    ${canShare ? `<button type="button" class="mbtn complete" data-a="share">Send via email app</button>
      <p class="sub muted">Choose Mail or Gmail, then put <b>${officeEmail() || "your office's email"}</b> in the To box (the subject and job details are filled in).</p>`
    : `<p class="sub">This browser can't attach photos automatically. Tap below to open an email to ${officeEmail() || "your office"}, then attach the photos yourself.</p>
      <a class="mbtn complete" data-a="mail" href="${mailto}">Open email to the office</a>
      <button type="button" class="mbtn" data-a="sent">I've sent it</button>`}
    <button type="button" class="mbtn ghost" data-a="x">Cancel</button></div>`;
  (document.querySelector("dialog[open]") || document.body).appendChild(v);
  const close = () => v.remove();
  v.querySelector('[data-a="x"]').onclick = close;
  const logIt = o.log ? () => o.log(n) : async () => {
    const ref = doc(db, "jobs", j.id);
    try { await updateDoc(ref, { log: arrayUnion(logEntry(`Photos emailed (${n}) by ${me.name}: ` + infos.map(x => `${x.time} @ ${fmtLL(x.gps)}`).join("; "))), updatedAt: serverTimestamp(), updatedBy: me.uid }); toast("Noted in the diary"); }
    catch (e) { toast("Diary not updated: " + (e.code || e.message)); }
  };
  const sh = v.querySelector('[data-a="share"]');
  if (sh) sh.onclick = async () => {
    try {
      await navigator.share({ files, title: subj, text: `To: ${officeEmail()}\nSubject: ${subj}\n\n${body(j, infos, true)}` });
      close(); logIt();
    } catch (e) { if (e.name !== "AbortError") toast("Share failed: " + e.message); }
  };
  const sent = v.querySelector('[data-a="sent"]');
  if (sent) sent.onclick = () => { close(); logIt(); };
}

// ------------------------------------------------------------------ Dispatch Board on a phone (<= 760px): one-day agenda
// Sticky day header (‹ Today ›, swipe left/right), 7-day strip with counts, jobs grouped by staff in bold bands,
// big cards; "Move" opens a bottom sheet (date / time / staff) that saves exactly like the desktop drag
// (editedInApp -> pushed to ServiceM8 by the box sync).
function mobileDispatch(all) {
  const t0 = todayStr(); ui.mday = ui.mday || t0; const d = ui.mday;
  const sched = all.filter(j => j.date && queueOf(j) !== "Unsuccessful");
  noteDispatch(all, [d]);
  const wk0 = addDays(d, -dowMon(d)), strip = [...Array(7)].map((_, i) => addDays(wk0, i));
  const dayJobs = sched.filter(j => j.date === d);
  const card = (j, slot) => {
    const away = assignmentWarning(ui.leave || [], j.date, leavePeople(namesOf(j)));
    const time = slot ? slot.time : (j.time || "--:--");
    const est = slot ? formatEstimate(slot.estHours) : "";
    const late = slot && slot.pastFinish;
    return `<div class="mdc ${QCLS[queueOf(j)]} ${away ? "on-leave" : ""} ${late ? "past-finish" : ""}" data-id="${j.id}">
      <div class="mdc-top"><b class="mdc-time">${esc(time)}</b><span class="mdc-no">#${esc(jobNo(j))}</span><span class="pstack">${ipPill(j, "sm")}<span class="qpill ${QCLS[queueOf(j)]}">${esc(queueOf(j))}</span></span></div>
      <div class="mdc-cl">${esc(j.client || "")}</div>
      <a class="mdc-addr" href="${mapsUrl(j.address || "")}" target="_blank" rel="noopener">📍 ${esc(j.address || "-")}</a>
      <div class="mdc-desc">${esc(firstLine(crewText(j.description)))}</div>
      ${est ? `<div class="sub est">${esc(est)}</div>` : ""}
      ${late ? `<p class="sub past-finish">Runs past finish time</p>` : ""}
      ${away ? `<p class="leave-chip">${esc(away)}</p>` : ""}
      <div class="mdc-foot"><span class="sub">${j.po ? "PO " + esc(j.po) : "No PO"}${est ? " · " + esc(est) : ""}</span>
        <span><button type="button" class="sm-btn mdc-unsch" data-unsch="${j.id}" title="Remove from dispatch board (back to Unscheduled)">✕ Off board</button> <button type="button" class="sm-btn mdc-move" data-move="${j.id}">⇄ Move</button></span></div></div>`;
  };
  const groups = rowsFor(all).map(r => {
    const plan = rowPlan(r, d, dayJobs);
    const cards = plan.map(slot => { const j = dayJobs.find(x => x.id === slot.id); return j ? card(j, slot) : ""; }).join("");
    return [r, cards, plan.length];
  });
  return `<div class="mdisp" id="mdisp"><div class="mdh">
      <div class="mdh-row"><button class="sm-btn" data-md="-1" aria-label="Previous day">‹</button>
        <div class="mdh-date"><b>${esc(dayLabel(d))}</b>${d === t0 ? '<span class="sub">Today</span>' : ""}</div>
        <button class="sm-btn" data-md="1" aria-label="Next day">›</button><button class="sm-btn" data-md="0">Today</button></div>
      <div class="mstrip">${strip.map(x => { const n = sched.filter(j => j.date === x).length;
        return `<button class="${x === d ? "on" : ""} ${x === t0 ? "today" : ""}" data-mday="${x}"><small>${new Date(x + "T00:00:00Z").toLocaleDateString("en-AU", { weekday: "short", timeZone: "UTC" })}</small><b>${+x.slice(8)}</b><span class="${n ? "" : "zero"}">${n}</span></button>`; }).join("")}</div></div>
    <button type="button" class="route-open" id="optorder">Optimise order</button>
    ${plannerLeaveHtml(ui.leave || [], [d], staff.map(s => ({ uid: s.uid || "", name: s.name })))}
    ${groups.map(([r, html, n]) => `<div class="mgrp">${esc(r.name)} <span class="cnt">${n}</span></div>${html || `<p class="muted sub pad">Nothing booked for ${esc(orgSettings().name)}.</p>`}`).join("")}
    <p class="sub muted pad">Swipe left / right to change day. Tap a card to open the job.</p></div>`;
}
function bindMobileDispatch(A, pool) {
  const go = d => { ui.mday = d; renderAdmin(); window.scrollTo(0, 0); };
  A.querySelectorAll("[data-md]").forEach(b => b.onclick = () => go(+b.dataset.md === 0 ? todayStr() : addDays(ui.mday, +b.dataset.md)));
  A.querySelectorAll("[data-mday]").forEach(b => b.onclick = () => go(b.dataset.mday));
  A.querySelectorAll(".mdc").forEach(c => { c.draggable = false; c.ondragstart = null; });
  A.querySelectorAll(".mdc-addr").forEach(a => a.addEventListener("click", ev => ev.stopPropagation()));
  A.querySelectorAll("[data-move]").forEach(b => b.onclick = ev => { ev.stopPropagation(); const j = pool.find(x => x.id === b.dataset.move); if (j) moveSheet(j); });
  A.querySelectorAll("[data-unsch]").forEach(b => b.onclick = ev => { ev.stopPropagation(); const j = pool.find(x => x.id === b.dataset.unsch); if (!j) return;
    if (!armBtn(b, "✕ Off board", "Tap again to remove")) return; unscheduleJob(j).catch(e => toast("Not removed: " + (e.code || e.message))); });
  const el = $("#mdisp"); let x0 = null, y0 = null;
  if (el) {
    el.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    el.addEventListener("touchend", e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
      if (Math.abs(dx) > 70 && Math.abs(dx) > 1.5 * Math.abs(dy)) go(addDays(ui.mday, dx < 0 ? 1 : -1)); }, { passive: true });
  }
}
function moveSheet(j) {
  const v = document.createElement("div"); v.className = "emdlg"; const cur = namesOf(j).map(n => n.toLowerCase());
  v.innerHTML = `<form class="embox msheet"><h3>Move #${esc(jobNo(j))}</h3><p class="sub muted">${esc(j.address || "")}</p>
    <div class="row"><label>Date<input type="date" name="date" value="${esc(j.date || todayStr())}" required></label><label>Time<input type="time" name="time" value="${esc(j.time || "07:00")}"></label></div>
    <p class="sub">Change the time to pin it. Leave it and the board spaces this job.</p>
    <fieldset class="staffs">${staff.map(s => `<label class="ck"><input type="checkbox" name="st" value="${esc(skey(s))}" ${cur.includes(s.name.toLowerCase()) ? "checked" : ""}> ${esc(s.name)}</label>`).join("")}</fieldset>
    <p class="sub muted">No one ticked = Unallocated. ${esc(syncNote("Saved to the app, then synced at the next sync.", "Saved straight away."))}</p>
    <button class="mbtn complete">Save</button><button type="button" class="mbtn" data-x>Cancel</button></form>`;
  document.body.appendChild(v);
  v.querySelector("[data-x]").onclick = () => v.remove();
  v.onclick = e => { if (e.target === v) v.remove(); };
  const timeInput = v.querySelector("[name=time]");
  if (timeInput) timeInput.addEventListener("input", () => { timeInput.dataset.touched = "1"; });
  v.querySelector("form").onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    const picked = [...f.querySelectorAll("[name=st]:checked")].map(x => staff.find(s => skey(s) === x.value)).filter(Boolean);
    const touched = f.time.dataset.touched === "1";
    const u = { date: f.date.value, assignedNames: picked.map(s => s.name), assigned: picked.filter(s => s.uid).map(s => s.uid),
      editedInApp: true, updatedAt: serverTimestamp(), updatedBy: me.uid,
      ...(touched ? { time: f.time.value, timeSource: "manual" } : {}) };
    if (!confirmIfOnLeave(u.date, u.assignedNames)) return;
    try { await updateDoc(doc(db, "jobs", j.id), u); } catch (err) { return toast("Not saved: " + (err.code || err.message)); }
    const prevDate = j.date;
    Object.assign(j, u);
    queueDispatchPersist([...(jobs || []).filter(x => x.id !== j.id), { ...j, ...u }], [prevDate, u.date].filter(Boolean));
    v.remove(); ui.mday = u.date; toast(`Moved to ${shortDate(u.date)} ${u.time || j.time || ""} · ${u.assignedNames.join(", ") || "Unallocated"}`); renderAdmin();
  };
}

// ------------------------------------------------------------------ Safety / incident reports (ISO 45001-friendly records)
// incidents/{INC-0001}: sequential report no from incidentCounter/main (transaction). Reporter can't edit after submit;
// admins add root cause + corrective actions and close. Every change is appended to `history` (audit trail). No deletes.
const INC_TYPES = ["Incident", "Near miss", "Hazard", "Injury", "Property damage"];
const incPad = n => "INC-" + String(n).padStart(4, "0");
const nowLocal = () => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date()).replace(" ", "T");
const stamp = () => new Date().toLocaleString("en-AU", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
const fmtDT = s => s ? new Date(s + ":00Z").toLocaleString("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "-";
const incPhotosUrl = r => gmBase() + "#search/" + encodeURIComponent(`subject:"[Incident Photos] ${r.reportNo}"`);
const incCls = r => r.status === "Closed" ? "q-comp" : "q-alert";
const isAdm = () => me && me.role === "admin";
document.addEventListener("click", e => {
  const b = e.target.closest("[data-inc]"); if (!b) return; e.preventDefault(); e.stopPropagation();
  const j = b.dataset.inc && [...jobs, ...(ui.undated || []), ...(ui.done || [])].find(x => x.id === b.dataset.inc);
  incidentForm(j || null);
}, true);
document.addEventListener("click", e => {
  const r = e.target.closest("[data-incid]"); if (!r || e.target.closest("a")) return;
  const inc = (ui.incidents || []).find(x => x.id === r.dataset.incid); if (inc) incidentDetail(inc);
});
function incOverlay(html, keep) {
  if (!keep) document.querySelectorAll(".incdlg").forEach(x => x.remove());
  const v = document.createElement("div"); v.className = "emdlg incdlg"; v.innerHTML = `<div class="embox incbox">${html}</div>`;
  (document.querySelector("dialog[open]") || document.body).appendChild(v); return v;
}
function incidentForm(j) {
  const v = incOverlay(`<h3>⚠ Report incident</h3>
    <form id="incf" class="incform">
      <label>Type<select name="type" required>${INC_TYPES.map(t => `<option>${t}</option>`).join("")}</select></label>
      <label>Date / time<input type="datetime-local" name="occurredAt" value="${nowLocal()}" required></label>
      <label>Job (optional)<input name="jobNo" value="${j ? esc(jobNo(j)) : ""}" placeholder="Job #"></label>
      <label>Location / address<input name="location" value="${esc(j ? j.address || "" : "")}" required></label>
      <label>People involved<input name="people" placeholder="Names, incl. visitors / subbies"></label>
      ${(staff || []).some(s => s.uid) ? `<fieldset class="take5"><legend>Staff involved</legend>${staff.filter(s => s.uid).map(s => `<label class="take5-step"><input type="checkbox" name="involved" value="${esc(s.uid)}"> ${esc(s.name)}</label>`).join("")}</fieldset>` : ""}
      <label>What happened<textarea name="what" rows="4" required></textarea></label>
      <label class="injf hidden">Injury details (body part, nature, treatment)<textarea name="injury" rows="3"></textarea></label>
      <label>Immediate action taken<textarea name="action" rows="3" required></textarea></label>
      <p class="sub muted">Reported by <b>${esc(me.name)}</b> · saved as a numbered record (can't be edited after submit). Add photos on the next screen.</p>
      <div class="btns"><button type="button" class="mbtn ghost" data-x>Cancel</button><button class="mbtn complete">Submit report</button></div>
    </form>`);
  const f = v.querySelector("#incf"), inj = v.querySelector(".injf");
  f.type.onchange = () => { inj.classList.toggle("hidden", f.type.value !== "Injury"); f.injury.required = f.type.value === "Injury"; };
  v.querySelector("[data-x]").onclick = () => v.remove();
  f.onsubmit = async ev => {
    ev.preventDefault(); const btn = f.querySelector(".complete"); btn.disabled = true;
    const involved = [...f.querySelectorAll("[name=involved]:checked")].map(x => x.value).slice(0, 30);
    const data = { type: f.type.value, occurredAt: f.occurredAt.value, jobId: j ? j.id : "", jobNo: f.jobNo.value.trim(), location: f.location.value.trim(),
      people: f.people.value.trim(), ...(involved.length ? { staffInvolved: involved } : {}), what: f.what.value.trim(), injury: f.type.value === "Injury" ? f.injury.value.trim() : "", action: f.action.value.trim(),
      reportedBy: me.uid, reportedByName: me.name, reportedAt: new Date().toISOString(), createdAt: serverTimestamp(), status: "Open",
      companyId: myCompanyId(), ...(myCompanyId() === "heartwood" ? {} : { tenantId: myCompanyId() }),
      rootCause: "", actions: [], history: [{ at: stamp(), by: me.name, text: "Reported" }] };
    const holdIncident = async () => {
      const payload = { ...data };
      delete payload.createdAt;
      const built = makeOutbox({
        id: "incq_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        uid: me.uid, kind: "incident", companyId: myCompanyId(), label: "Incident report", payload,
      });
      if (!built.ok) throw new Error("queue");
      await offlineStore.putOutbox(built.row);
      paintSync();
      registerUploadSync().catch(() => {});
      toast(SAVED_ON_PHONE + ". The report number is assigned when this phone is back in signal.");
      v.remove();
    };
    // The report number comes from a transaction, which the server has to see. The form is kept on the phone until then.
    if (!deviceOnline()) { try { await holdIncident(); } catch { btn.disabled = false; toast("Not saved: offline"); } return; }
    try {
      const no = await runTransaction(db, async tx => {
        const cref = doc(db, "incidentCounter", myCompanyId() === "heartwood" ? "main" : myCompanyId()), c = await tx.get(cref);
        const n = (c.exists() ? c.data().n : 0) + 1, reportNo = incPad(n);
        // Heartwood keeps incidents/INC-0001. Other companies: incidents/{companyId}_INC-0001, so numbers never collide.
        const id = myCompanyId() === "heartwood" ? reportNo : myCompanyId() + "_" + reportNo;
        tx.set(cref, { n }); tx.set(doc(db, "incidents", id), { ...data, seq: n, reportNo }); return { id, reportNo };
      });
      toast(`${no.reportNo} saved`); v.remove();
      incidentDetail({ id: no.id, reportNo: no.reportNo, seq: 0, ...data });
    } catch (e) {
      if (classifyUploadError(e) === "retry") { try { await holdIncident(); return; } catch { /* fall through */ } }
      btn.disabled = false; toast("Not saved: " + txFail(e));
    }
  };
}
function incRefresh() {   // keep an open detail view in sync with Firestore
  const d = document.querySelector(".incdlg[data-open]"); if (!d) return;
  const r = (ui.incidents || []).find(x => x.id === d.dataset.open); if (r && !d.querySelector(".dirty")) incidentDetail(r);
}
function incidentDetail(r) {
  const adm = isAdm(), open = r.status !== "Closed", acts = r.actions || [];
  const row = (k, v) => v ? `<div class="incrow"><div class="mlbl">${k}</div><div>${esc(v).replace(/\n/g, "<br>")}</div></div>` : "";
  const v = incOverlay(`<div class="inchead"><h3>${esc(r.reportNo)} · ${esc(r.type)}</h3><span class="qpill ${incCls(r)}">${esc(r.status)}</span></div>
    ${row("Date / time", fmtDT(r.occurredAt))}${row("Job", r.jobNo ? "#" + r.jobNo : "")}${row("Location", r.location)}${row("People involved", r.people)}
    ${row("What happened", r.what)}${row("Injury details", r.injury)}${row("Immediate action taken", r.action)}
    ${row("Reported by", `${r.reportedByName || "?"} · ${r.reportedAt ? new Date(r.reportedAt).toLocaleString("en-AU", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }) : ""}`)}
    <div class="incrow"><div class="mlbl">Photos</div><button type="button" class="sm-btn" id="incph">📧 Email photos</button>
      ${r.photosEmailedCount ? ` <a class="phlink" href="${incPhotosUrl(r)}" target="_blank" rel="noopener">📷 Photos (${r.photosEmailedCount} sent)</a>` : ""}</div>
    <h4>Investigation</h4>
    ${adm && open ? `<label>Root cause<textarea id="incrc" rows="3">${esc(r.rootCause || "")}</textarea></label>` : row("Root cause", r.rootCause || (open ? "Not yet investigated" : "-"))}
    <div class="mlbl">Corrective actions</div>
    <table class="jt incacts"><thead><tr><th>Action</th><th>Owner</th><th>Due</th><th>Done</th></tr></thead><tbody>
      ${acts.map((a, i) => `<tr><td>${esc(a.text)}</td><td>${esc(a.owner)}</td><td>${esc(a.due ? dmy(a.due) : "")}</td>
        <td>${adm && open ? `<input type="checkbox" data-ad="${i}" ${a.done ? "checked" : ""}>` : a.done ? "✔ " + esc(a.doneAt || "") : ""}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">None yet</td></tr>`}</tbody></table>
    ${adm && open ? `<div class="incadd"><input id="iat" placeholder="New corrective action"><select id="iao">${staff.map(s => `<option>${esc(s.name)}</option>`).join("")}</select><input id="iad" type="date"><button type="button" class="sm-btn" id="iaadd">+ Add</button></div>` : ""}
    ${!open ? row("Closed", `${r.closedByName || "?"} · ${r.closedAt || ""}`) : ""}
    <details class="inchist"><summary>History (${(r.history || []).length})</summary>${(r.history || []).map(h => `<div class="sub">${esc(h.at)} · ${esc(h.by)} · ${esc(h.text)}</div>`).join("")}</details>
    <div class="btns">${adm && open ? `<button type="button" class="mbtn" id="incsave">Save</button><button type="button" class="mbtn complete" id="incclose">Close report</button>` : ""}<button type="button" class="mbtn ghost" data-x>Back</button></div>`);
  v.dataset.open = r.id;
  v.querySelector("[data-x]").onclick = () => v.remove();
  v.querySelector("#incph").onclick = () => emailPhotos({ id: r.id, reportNo: r.reportNo, sm8JobNo: r.reportNo, address: r.location, photosEmailedCount: r.photosEmailedCount }, {
    coll: "incidents", subject: `[Incident Photos] ${r.reportNo}`,
    body: (x, infos, att) => [`Incident report ${r.reportNo} (${r.type})`, `When: ${fmtDT(r.occurredAt)}`, `Location: ${r.location || "-"}`, r.jobNo ? `Job #${r.jobNo}` : "", "",
      att ? `${infos.length} photo(s) attached:` : `Please attach ${infos.length} photo(s) to this email:`, ...infos.map((y, i) => `${i + 1}. ${y.time} (Brisbane) · ${fmtLL(y.gps)}`), "", `From ${me.name}`].filter(x => x !== null).join("\n"),
    log: () => toast("Photos noted on " + r.reportNo) });
  if (!(adm && open)) return;
  v.querySelectorAll("textarea,input").forEach(x => x.oninput = () => x.classList.add("dirty"));
  const ref = doc(db, "incidents", r.id);
  const save = async (extra = {}, note) => {
    const rc = v.querySelector("#incrc").value.trim(), hist = [...(r.history || [])];
    if (rc !== (r.rootCause || "")) hist.push({ at: stamp(), by: me.name, text: "Root cause updated" });
    if (note) hist.push({ at: stamp(), by: me.name, text: note });
    const u = { rootCause: rc, history: hist, updatedAt: serverTimestamp(), updatedBy: me.uid, ...extra };
    try {
      const saved = await queueWrite(updateDoc(ref, u), { id: "incident:" + r.id, kind: "incident", label: "Incident " + (r.reportNo || "") }, "", { announce: false });
      Object.assign(r, u);
      toast(saved && saved.queued ? SAVED_ON_PHONE : "Saved");
      if (!(saved && saved.queued)) incidentDetail(r);
    } catch (e) { toast("Not saved: " + (e.code || e.message)); }
  };
  v.querySelector("#iaadd").onclick = () => { const t = v.querySelector("#iat").value.trim(); if (!t) return toast("Type the action first");
    const a = { text: t, owner: v.querySelector("#iao").value, due: v.querySelector("#iad").value, done: false };
    save({ actions: [...acts, a] }, `Action added: ${t} (${a.owner}${a.due ? ", due " + dmy(a.due) : ""})`); };
  v.querySelectorAll("[data-ad]").forEach(cb => cb.onchange = () => { const i = +cb.dataset.ad, na = acts.map((a, k) => k === i ? { ...a, done: cb.checked, doneAt: cb.checked ? stamp() : "" } : a);
    save({ actions: na }, `Action ${cb.checked ? "done" : "re-opened"}: ${acts[i].text}`); });
  v.querySelector("#incsave").onclick = () => save();
  v.querySelector("#incclose").onclick = () => {
    if (!v.querySelector("#incrc").value.trim()) return toast("Add the root cause before closing");
    if (acts.some(a => !a.done) && !confirm("Some corrective actions aren't done. Close anyway?")) return;
    save({ status: "Closed", closedBy: me.uid, closedByName: me.name, closedAt: stamp() }, "Closed");
  };
}
function safetyView() {
  ui.incS = ui.incS || "Open"; ui.incT = ui.incT || "";
  const all = (ui.incidents || []).slice().sort((a, b) => (b.seq || 0) - (a.seq || 0));
  const list = all.filter(r => (ui.incS === "All" || r.status === ui.incS) && (!ui.incT || r.type === ui.incT));
  const cnt = st => all.filter(r => st === "All" || r.status === st).length;
  setTimeout(() => {
    document.querySelectorAll("[data-incs]").forEach(b => b.onclick = () => { ui.incS = b.dataset.incs; renderAdmin(); });
    const t = $("#inct"); if (t) t.onchange = () => { ui.incT = t.value; renderAdmin(); };
  });
  const take5Block = canViewTake5(me) && (ui.take5On !== false || (ui.take5s || []).length) ? `<h3 class="swh">Take 5s</h3>${take5ListHtml(ui.take5s || [])}` : "";
  return `<div class="sm-head"><h1>Safety</h1><span class="headbtns"><button class="sm-btn" data-view="swms">📋 SWMS</button><button class="sm-btn primary" data-inc="">⚠ Report incident</button></span></div>
    ${take5Block}
    <div class="qtabs">${["Open", "Closed", "All"].map(k => `<button data-incs="${k}" class="${ui.incS === k ? "on" : ""}">${k} <span>${cnt(k)}</span></button>`).join("")}</div>
    <div class="filters"><select id="inct"><option value="">All types</option>${INC_TYPES.map(t => `<option ${ui.incT === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
    <table class="jt"><thead><tr><th>Report</th><th>Type</th><th>When</th><th>Location / job</th><th>What happened</th><th>Reported by</th><th>Actions</th><th>Status</th></tr></thead><tbody>
    ${list.map(r => `<tr class="jr" data-incid="${esc(r.id)}"><td class="jn">${esc(r.reportNo)}${r.photosEmailedCount ? ` <a class="phicon" href="${incPhotosUrl(r)}" target="_blank" rel="noopener">📷</a>` : ""}</td><td>${esc(r.type)}</td><td>${esc(fmtDT(r.occurredAt))}</td>
      <td>${esc(r.location || "-")}<div class="sub">${r.jobNo ? "Job #" + esc(r.jobNo) : ""}</div></td><td>${esc(firstLine(r.what))}</td><td>${esc(r.reportedByName || "")}</td>
      <td>${(r.actions || []).filter(a => a.done).length}/${(r.actions || []).length}</td><td><span class="qpill ${incCls(r)}">${esc(r.status)}</span></td></tr>`).join("") || `<tr><td colspan="8" class="muted pad">No reports.</td></tr>`}</tbody></table>`;
}
function myIncidentsHtml() {
  const L = (ui.incidents || []).filter(r => r.reportedBy === me.uid).sort((a, b) => (b.seq || 0) - (a.seq || 0));
  if (!L.length) return "";
  return `<div class="hsec"><div class="hsec-h">My safety reports <span class="cnt">${L.length}</span></div>${L.map(r => `<div class="hrow" data-incid="${esc(r.id)}"><div class="htime"><b>${esc(r.reportNo.slice(4))}</b><small>INC</small></div>
    <div class="hbody"><div class="hcl">${esc(r.type)}</div><div class="sub">${esc(fmtDT(r.occurredAt))} · ${esc(r.location || "")}</div></div><span class="qpill ${incCls(r)}">${esc(r.status)}</span></div>`).join("")}</div>`;
}

// ------------------------------------------------------------------ SWMS (Safe Work Method Statements, Jul 2026)
// Official PDFs are not in this repository. When swmsChunks has the file, that PDF is used.
// When it does not, the app opens a placeholder page that is explicitly not a SWMS.
const swmsCache = {}, swmsBin = {}, swmsPlaceholder = {};
const swNow = () => (window.HW_NOW || Date.now());
const swmsStatus = sig => {
  const st = statusOf(sig, swNow());
  if (st.k === "exp") return { ...st, label: "Expired " + swD(st.exp) };
  if (st.k === "due") return { ...st, label: `Due soon · expires ${swD(st.exp)}` };
  if (st.k === "ok") return { ...st, label: "Signed · valid to " + swD(st.exp) };
  return st;
};
const swD = ms => new Date(ms).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: TZ });
const swDT = ms => new Date(ms).toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ });
function companyHasSwms() { return companySwms(myCompanyId()).length > 0; }
const mySwms = () => companySwms(myCompanyId()).map(([id, t, d]) => ({ id, t, d, st: swmsStatus(latestSig(ui.mySigs, me && me.uid, id)) }));
function swmsReminderHtml() {
  if (!me || !ui.mySigs) return "";
  const model = swmsReminderModel(myCompanyId(), ui.mySigs, me.uid, swNow());
  if (!model) return "";
  const { exp, due, titles } = model;
  return `<button type="button" class="swremind ${exp ? "sw-exp" : "sw-due"}" data-swms=""><span class="ic">✍</span><span><b>${exp ? `${exp} SWMS need${exp === 1 ? "s" : ""} signing${due ? ` · ${due} due soon` : ""}` : `${due} SWMS due for re-signing`}</b>
    <small>${titles.map(t => esc(t)).join(" · ")}</small></span><span class="chev">›</span></button>`;
}
function swmsEmptyHtml() {
  return `<p class="muted pad">${esc(SWMS_EMPTY)}</p>`;
}
function swmsSub() {          // my signatures (everyone); all signatures (admins)
  if (ui.swmsUnsub || !me) return;
  const ownSwms = myCompanyId() === "heartwood"
    ? query(collection(db, "swmsSignatures"), where("uid", "==", me.uid))
    : query(collection(db, "swmsSignatures"), where("uid", "==", me.uid), where("companyId", "==", myCompanyId()));
  const u1 = onSnapshot(ownSwms, s => { ui.mySigs = s.docs.map(d => ({ id: d.id, ...d.data() })); swmsRefresh(); }, e => console.warn("swms", e.code));
  let u2 = () => {};
  if (me.role === "admin") u2 = onSnapshot(query(collection(db, "swmsSignatures"), where("companyId", "==", myCompanyId())), s => { ui.allSigs = s.docs.map(d => ({ id: d.id, ...d.data() })); swmsRefresh(); }, e => console.warn("swms all", e.code));
  ui.swmsUnsub = () => { u1(); u2(); ui.swmsUnsub = null; };
}
function swmsRefresh() {
  const ov = document.querySelector(".incdlg.swov"); if (ov) { const hold = ov.querySelector(".swlistwrap"); if (hold) hold.outerHTML = swmsList(ov.dataset.job || ""); return; }
  if (document.querySelector(".incdlg")) return;
  if (me.role === "admin" && !ui.myJobs) { if (ui.view === "swms" || ui.view === "home") renderAdmin(); } else if (!ui.opSel && (ui.opTab || "today") === "today") renderOperator();
}
const swFlag = s => s.k === "ok" ? "✔ " + swD(s.exp) : s.k === "due" ? "⏳ Due " + swD(s.exp) : s.k === "none" ? "✖ Not signed" : "✖ " + (s.k === "old" ? "Old version" : "Expired " + swD(s.exp));
const swmsList = (jobId = "") => `<div class="swlistwrap"><div class="swlist">${mySwms().map(({ id, t, d, st }) => `<div class="switem swsign">
    <button type="button" class="swopen" data-swmsf="${id}"><span class="swic">📄</span><span><b>${t}</b><small>${d}</small></span></button>
    <div class="swst"><span class="swpill ${st.cls}" data-swstatus="${st.k}">${st.k === "ok" ? "✔ " : st.k === "due" ? "⏳ " : "✖ "}${esc(st.label)}</span>
      <button type="button" class="swbtn ${st.k === "ok" ? "" : "primary"}" data-swsign="${id}" data-job="${esc(jobId)}">${st.k === "none" ? "Read & sign" : st.k === "ok" ? "Sign again" : "Re-sign"}</button></div></div>`).join("")}</div>
  <p class="sub muted">${esc(orgSettings().name)} SWMS · version July 2026 · tap a title to read the PDF. Signatures last 12 months. A signature due within 30 days asks you to sign again. ${esc(POWERED_BY)}.</p></div>`;
function swmsView() {
  if (!companyHasSwms()) return `<div class="sm-head"><h1>SWMS</h1></div>${swmsEmptyHtml()}`;
  return `<div class="sm-head"><h1>SWMS</h1></div>${swmsReminderHtml()}<h3 class="swh">My signatures</h3>${swmsList()}${me.role === "admin" ? swmsAdminHtml() : ""}`;
}
function swmsOverlay(jobId = "") {
  const body = companyHasSwms() ? swmsList(jobId) : swmsEmptyHtml();
  const v = incOverlay(`<h3>📋 SWMS</h3>${body}<div class="btns"><button type="button" class="mbtn ghost" data-x>Back</button></div>`);
  v.classList.add("swov"); v.dataset.job = jobId; v.querySelector("[data-x]").onclick = () => v.remove();
}
// ---- Admin: who signed what, expiry, who is overdue
function swmsAdminHtml() {
  const catalogue = companySwms(myCompanyId());
  if (!catalogue.length) return "";
  const all = ui.allSigs || [];
  const people = [...new Map([...staff.filter(s => s.uid).map(s => [useEmulator && s.uid === ALEX_UID ? "ALEX_UID" : s.uid, s.name]), ...all.map(s => [s.uid, s.name])]).entries()];
  const cells = people.map(([uid, name]) => ({ uid, name, sts: catalogue.map(([id]) => swmsStatus(latestSig(all, uid, id))) }));
  const over = cells.filter(c => c.sts.some(s => s.k !== "ok" && s.k !== "due")).length, dueN = cells.filter(c => c.sts.some(s => s.k === "due")).length;
  const short = { "working-near-roads": "Roads", "mobile-plant": "Plant", "working-with-silica": "Silica", "hazardous-substances": "Haz subs", "electrical": "Electrical" };
  const rows = [...all].sort((a, b) => sigMs(b) - sigMs(a));
  const cards = `<div class="swpeople">${cells.map(c => `<article class="swperson"><b>${esc(c.name)}</b>${c.sts.map((s, i) => `<div class="swprow"><span>${short[catalogue[i][0]]}</span><span class="swpill ${s.cls}" data-swstatus="${s.k}" ${s.sig ? `data-swsig="${esc(s.sig.id)}"` : ""}>${esc(swFlag(s))}</span></div>`).join("")}</article>`).join("")}</div>`;
  return `<h3 class="swh">Team status <span class="swpill sw-exp">${over} overdue or missing</span> <span class="swpill sw-due">${dueN} due soon</span></h3>
  ${cards}
  <div class="swtablewrap team"><table class="swtable"><thead><tr><th>Worker</th>${catalogue.map(([id]) => `<th>${short[id]}</th>`).join("")}</tr></thead><tbody>
  ${cells.map(c => `<tr><td><b>${esc(c.name)}</b></td>${c.sts.map(s => `<td><span class="swpill ${s.cls}" data-swstatus="${s.k}" ${s.sig ? `data-swsig="${esc(s.sig.id)}"` : ""}>${esc(swFlag(s))}</span></td>`).join("")}</tr>`).join("")}
  </tbody></table></div>
  ${swmsDownloadHtml()}
  <h3 class="swh">All signatures <small class="muted">${rows.length}</small></h3>
  <div class="swtablewrap"><table class="swtable swlog"><thead><tr><th>Signed</th><th>Worker</th><th>SWMS</th><th>Job</th><th>Expires</th><th></th></tr></thead><tbody>
  ${rows.map(s => { const st = swmsStatus(s), cur = latestSig(all, s.uid, s.swmsId) === s;
    return `<tr class="${cur ? "" : "superseded"}"><td>${esc(swDT(sigMs(s)))}</td><td><b>${esc(s.name)}</b></td><td>${esc(s.swmsTitle || s.swmsId)}<br><small class="muted">v${esc(s.version)}</small></td>
    <td>${s.jobLabel ? esc(s.jobLabel) : `<span class="muted">—</span>`}</td><td><span class="swpill ${cur ? st.cls : ""}">${esc(swD(sigExp(s)))}${cur ? "" : " (replaced)"}</span></td>
    <td class="swacts"><button type="button" class="swbtn" data-swsig="${esc(s.id)}">View signature</button><button type="button" class="swbtn" data-swdlsig="${esc(s.id)}" title="Signed PDF for this signer only">⬇ Download</button></td></tr>`; }).join("") || `<tr><td colspan="6" class="muted">No signatures yet.</td></tr>`}
  </tbody></table></div>`;
}
function sigDetail(id) {
  const s = (ui.allSigs || ui.mySigs || []).find(x => x.id === id) || (ui.mySigs || []).find(x => x.id === id); if (!s) return;
  const v = incOverlay(`<h3>✍ ${esc(s.swmsTitle || s.swmsId)}</h3>
    <div class="sigimg"><img src="${s.sig}" alt="Signature of ${esc(s.name)}"></div>
    <dl class="sigdl"><dt>Printed name</dt><dd>${esc(s.name)}</dd><dt>Signed</dt><dd>${esc(swDT(sigMs(s)))}</dd><dt>Expires</dt><dd>${esc(swD(sigExp(s)))}</dd>
    <dt>SWMS version</dt><dd>${esc(s.version)}</dd><dt>Job</dt><dd>${esc(s.jobLabel || "—")}</dd><dt>User ID</dt><dd><small>${esc(s.uid)}</small></dd></dl>
    <div class="btns"><button type="button" class="mbtn ghost" data-x>Close</button></div>`);
  v.querySelector("[data-x]").onclick = () => v.remove();
}
// ---- Sign flow: read (open PDF) -> tick -> optional job -> finger signature + printed name -> Sign
function signSwms(id, jobId) {
  const row = companySwms(myCompanyId()).find(x => x[0] === id);
  if (!row) return;
  const [, title, desc] = row;
  const opts = jobs.filter(j => j.status !== "Cancelled" && (j.assigned || []).includes(me.uid) && j.date >= addDays(todayStr(), -7) && j.date <= addDays(todayStr(), 14))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  if (jobId && !opts.some(j => j.id === jobId)) { const j = jobs.find(x => x.id === jobId); if (j) opts.unshift(j); }
  const jl = j => `#${jobNo(j)} · ${j.address || ""}`;
  const v = incOverlay(`<h3>✍ Sign SWMS</h3><div class="swsh"><b>${esc(title)}</b><small>${esc(desc)} · version July 2026</small></div>
    <div class="swstep"><span class="n">1</span><div><b>Read the SWMS</b><button type="button" class="swbtn wide" id="swread">📄 Open ${esc(title)} SWMS</button><iframe id="swframe" class="swframe" hidden title="SWMS document"></iframe><p class="swph" id="swph" hidden></p></div></div>
    <label class="swck"><input type="checkbox" id="swok"> <span>I have read and understood this SWMS and will follow it.</span></label>
    <div class="swstep"><span class="n">2</span><div><b>Job</b> <small class="muted">(optional)</small>
      <select id="swjob" class="swsel"><option value="">General – not for a particular job</option>${opts.map(j => `<option value="${j.id}" ${j.id === jobId ? "selected" : ""}>${esc(shortDate(j.date))} · ${esc(jl(j))}</option>`).join("")}</select></div></div>
    <div class="swstep"><span class="n">3</span><div><b>Sign with your finger</b>
      <div class="sigpad"><canvas id="swpad" aria-label="Signature"></canvas><span class="sigline">✕ Sign here</span><button type="button" class="sigclr" id="swclr">Clear</button></div>
      <label class="swname">Printed name<input id="swnm" autocomplete="name" value="${esc(me.name === "Alex" && me.uid === ALEX_UID ? "Alex Daly" : me.name || "")}"></label></div></div>
    <p class="err" id="swerr"></p>
    <div class="btns swfoot"><button type="button" class="mbtn ghost" data-x>Cancel</button><button type="button" class="mbtn complete" id="swgo" disabled>Sign SWMS</button></div>`, true);
  v.classList.add("swsignov");
  const c = v.querySelector("#swpad"), ctx = c.getContext("2d"), go = v.querySelector("#swgo");
  const fit = () => { const r = c.getBoundingClientRect(), k = window.devicePixelRatio || 1;
    if (r.width < 20) { if (!inked) requestAnimationFrame(fit); return; }
    if (inked) return;
    c.width = r.width * k; c.height = r.height * k; ctx.scale(k, k);
    ctx.lineWidth = 2.6; ctx.lineCap = ctx.lineJoin = "round"; ctx.strokeStyle = "#0b1f3a"; inked = 0; check(); };
  let inked = 0, last = null, opened = false;
  const check = () => { go.disabled = !(opened && v.querySelector("#swok").checked && inked > 8 && v.querySelector("#swnm").value.trim().length >= 2); };
  const pt = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  c.onpointerdown = e => { e.preventDefault(); try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events and some phones */ } last = pt(e); ctx.beginPath(); ctx.arc(last[0], last[1], 1.2, 0, 7); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); inked++; };
  c.onpointermove = e => { if (!last) return; e.preventDefault(); const p = pt(e); ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke(); last = p; inked++; v.classList.add("inked"); check(); };
  c.onpointerup = c.onpointercancel = () => { last = null; check(); };
  c.style.touchAction = "none";
  v.querySelector("#swclr").onclick = () => { ctx.clearRect(0, 0, c.width, c.height); inked = 0; v.classList.remove("inked"); check(); };
  v.querySelector("#swok").onchange = check; v.querySelector("#swnm").oninput = check;
  v.querySelector("#swread").onclick = async () => {
    const btn = v.querySelector("#swread");
    btn.disabled = true;
    try {
      await swmsBytes(id);
      const frame = v.querySelector("#swframe");
      frame.hidden = false;
      frame.src = swmsCache[id];
      opened = true;
      const note = v.querySelector("#swph");
      if (swmsPlaceholder[id] && note) { note.hidden = false; note.textContent = "The official PDF is not in the app. The page above is a placeholder, not the SWMS text."; }
      else toast("SWMS opened. Tick the box, then sign.");
      check();
    } catch (e) { v.querySelector("#swerr").textContent = "SWMS not available: " + (e.code || e.message); }
    finally { btn.disabled = false; }
  };
  v.querySelector("[data-x]").onclick = () => v.remove();
  requestAnimationFrame(fit);
  go.onclick = async () => {
    go.disabled = true; go.textContent = "Saving…";
    // small PNG: crop to ink, scale to max 360x120, 1-bit-ish dark ink on transparent -> usually 3-10 KB
    const out = document.createElement("canvas"), sc = Math.min(1, 360 / c.width, 120 / c.height);
    out.width = Math.round(c.width * sc); out.height = Math.round(c.height * sc);
    out.getContext("2d").drawImage(c, 0, 0, out.width, out.height);
    const sig = out.toDataURL("image/png");
    if (sig.length > 90000) { v.querySelector("#swerr").textContent = "Signature too large, please clear and sign again."; go.disabled = false; go.textContent = "Sign SWMS"; return; }
    const jid = v.querySelector("#swjob").value, j = jid && jobs.find(x => x.id === jid), now = swNow();
    const rec = { ...swmsSignatureData({ uid: me.uid, name: v.querySelector("#swnm").value, swmsId: id, swmsTitle: title, jobId: jid, jobLabel: j ? jl(j) : "", sig, now, device: navigator.userAgent }), signedAt: serverTimestamp(), companyId: myCompanyId() };
    try {
      const saved = await queueWrite(addDoc(collection(db, "swmsSignatures"), rec), { id: "swms:" + id + ":" + me.uid, kind: "swms", label: "SWMS " + title }, "", { announce: false });
      if (!saved.queued && saved.value) ui.mySigs = [...(ui.mySigs || []).filter(x => x.id !== saved.value.id), { id: saved.value.id, ...rec }];
      v.remove();
      toast(saved.queued ? SAVED_ON_PHONE : `✔ Signed ${title} · valid to ${swD(rec.expiresAtMs)}`);
      swmsRefresh();
    } catch (e) { v.querySelector("#swerr").textContent = "Could not save: " + (e.code || e.message); go.disabled = false; go.textContent = "Sign SWMS"; }
  };
}
async function swmsChunkBytes(id) {
  try {
    const s = await getDocs(query(collection(db, "swmsChunks"), where("file", "==", id)));
    const parts = s.docs.map(d => d.data()).sort((a, b) => a.k - b.k);
    if (!parts.length || parts.some(p => typeof p.data !== "string" || !p.data)) return null;
    const bin = atob(parts.map(p => p.data).join("")), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    if (u8.length < 5 || String.fromCharCode(u8[0], u8[1], u8[2], u8[3], u8[4]) !== "%PDF-") return null;
    return u8;
  } catch { return null; }
}
async function swmsBytes(id) {          // official SWMS PDF, or a labelled placeholder when the PDF is not in swmsChunks
  // Only Heartwood has these documents. Other companies are not offered a placeholder PDF.
  if (!isHeartwoodCompany(myCompanyId())) return null;
  if (!swmsBin[id]) {
    const got = await swmsChunkBytes(id);
    if (got) { swmsPlaceholder[id] = false; swmsBin[id] = got; }
    else {
      const known = SWMS.find(x => x[0] === id);
      swmsPlaceholder[id] = true;
      swmsBin[id] = await buildPlaceholderPdf(await loadPdfLib(), known ? known[1] : id, orgSettings());
    }
    swmsCache[id] = URL.createObjectURL(new Blob([swmsBin[id]], { type: "application/pdf" }));
  }
  return swmsBin[id];
}
async function openSwms(id) {
  if (!companySwms(myCompanyId()).some(row => row[0] === id)) return false;
  const w = window.open("", "_blank");            // open now (inside the tap) so phones don't block the popup
  if (!w) { toast("Pop-up blocked. Allow pop-ups to read the SWMS, then sign."); return false; }
  try { w.document.write("<p style='font:16px sans-serif;padding:20px'>Loading SWMS…</p>"); } catch { /* already navigating */ }
  try {
    await swmsBytes(id);
    w.location.href = swmsCache[id];
    if (swmsPlaceholder[id]) toast("Official SWMS PDF is not in the app. That page is a placeholder, not the SWMS.");
    return true;
  } catch (e) { try { w.close(); } catch { /* */ } toast("SWMS not available: " + (e.code || e.message)); return false; }
}
// ---- Signed download (admins): original SWMS pages + a sign-off sheet, built in the browser with pdf-lib
// (vendor/pdf-lib.min.js, MIT, loaded on first use only — no CDN).
// Sign-off sheet names the signed-in company. Heartwood keeps its legal name and ABN.
// Another company never gets Heartwood's name or ABN on this sheet. CallUp is the product line.
let pdfLibP = null;
const loadPdfLib = () => pdfLibP || (pdfLibP = new Promise((ok, no) => {
  if (window.PDFLib) return ok(window.PDFLib);
  const sc = document.createElement("script"); sc.src = new URL("vendor/pdf-lib.min.js", import.meta.url).href;
  sc.onload = () => ok(window.PDFLib); sc.onerror = () => { pdfLibP = null; no(new Error("PDF library failed to load")); }; document.head.appendChild(sc);
}));
const sigJobKey = s => s.jobId || s.jobLabel || "";
// current valid signature per worker for one SWMS (newest, right version, not expired); optional job filter
function validSigners(id, job = "") {
  const all = ui.allSigs || [], uids = [...new Set(all.filter(s => s.swmsId === id).map(s => s.uid))];
  return uids.map(u => latestSig(all, u, id)).filter(s => s && ["ok", "due"].includes(swmsStatus(s).k) && (!job || sigJobKey(s) === job))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
async function buildSignedSwmsPdf(id, sigs, jobLabel = "", single = false) {
  const L = await loadPdfLib(), { PDFDocument, StandardFonts, rgb } = L;
  const known = companySwms(myCompanyId()).find(x => x[0] === id);
  if (!known) throw new Error("No SWMS for this company");
  const [, title, desc] = known;
  const bytes = await swmsBytes(id);
  if (!bytes) throw new Error("No SWMS for this company");
  const out = await PDFDocument.create(), src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  (await out.copyPages(src, src.getPageIndices())).forEach(pg => out.addPage(pg));
  const F = await out.embedFont(StandardFonts.Helvetica), B = await out.embedFont(StandardFonts.HelveticaBold);
  const T = x => String(x ?? "").replace(/[\u00a0\u202f\u2009]/g, " ").replace(/[^\x20-\x7e\u00a1-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022]/g, "?");
  const fit = (t, f, sz, w) => { t = T(t); while (t.length > 1 && f.widthOfTextAtSize(t, sz) > w) t = t.slice(0, -2) + "…"; return t; };
  const org = swmsSignoffOrg(orgSettings(), myCompanyId());
  const W = 595.28, H = 841.89, M = 32, navy = rgb(0.043, 0.122, 0.227), grey = rgb(0.4, 0.42, 0.45), line = rgb(0.75, 0.77, 0.8), red = rgb(0.55, 0.08, 0.08);
  const cols = [[M, 100, "Name"], [M + 100, 118, "Signature"], [M + 218, 108, "Signed"], [M + 326, 128, "Job"], [M + 454, W - M - (M + 454), "Expires"]];
  const RH = 58, gen = swDT(swNow()), ph = !!swmsPlaceholder[id];
  let pg, y, n = 0;
  const head = () => {
    pg = out.addPage([W, H]); y = H - M; n++;
    pg.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: navy });
    pg.drawText(fit(org.legalName, B, 16, W * 0.62), { x: M, y: y - 14, size: 16, font: B, color: navy });
    if (org.abn) pg.drawText("ABN " + org.abn, { x: M, y: y - 30, size: 9.5, font: F, color: grey });
    if (org.companyId && org.companyId !== "heartwood") {
      const contact = [org.address, [org.phone, org.email].filter(Boolean).join(" · ")].filter(Boolean).join("  ");
      if (contact) { y -= 12; pg.drawText(fit(contact, F, 8, W - 2 * M), { x: M, y: y - 30, size: 8, font: F, color: grey }); }
    }
    const r = "SWMS SIGN-OFF SHEET"; pg.drawText(r, { x: W - M - B.widthOfTextAtSize(r, 11), y: y - 14, size: 11, font: B, color: navy });
    const powered = POWERED_BY; pg.drawText(powered, { x: W - M - F.widthOfTextAtSize(powered, 8), y: y - 30, size: 8, font: F, color: grey });
    y -= 44; pg.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: navy }); y -= 22;
    pg.drawText(fit(title, B, 14, W - 2 * M), { x: M, y, size: 14, font: B }); y -= 16;
    pg.drawText(fit(`Safe Work Method Statement · ${desc} · Version ${SWMS_VERSION}`, F, 9.5, W - 2 * M), { x: M, y, size: 9.5, font: F, color: grey }); y -= 14;
    pg.drawText(fit((single ? "Individual sign-off: " + (sigs[0] && sigs[0].name) + (jobLabel ? " · " : "") : "") + (jobLabel ? "Job: " + jobLabel : single ? "" : "All current valid signatures (all jobs)"), F, 9.5, W - 2 * M), { x: M, y, size: 9.5, font: B }); y -= 14;
    pg.drawText(fit("Each person below has read and understood this SWMS and agreed to follow it. Signatures are valid 12 months from signing.", F, 8.5, W - 2 * M), { x: M, y, size: 8.5, font: F, color: grey }); y -= 14;
    if (ph) { pg.drawText(fit("PLACEHOLDER COVER: the official SWMS PDF is not in the app. Do not send this file to a client as the SWMS.", B, 8, W - 2 * M), { x: M, y, size: 8, font: B, color: red }); y -= 14; }
    y -= 4;
    pg.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 20, color: rgb(0.93, 0.94, 0.96) });
    cols.forEach(([x, , h]) => pg.drawText(h, { x: x + 5, y, size: 9, font: B, color: navy })); y -= 6;
  };
  head();
  if (!sigs.length) { y -= 24; pg.drawText("No current valid signatures.", { x: M + 5, y, size: 10, font: F, color: grey }); }
  for (const s of sigs) {
    if (y - RH < M + 30) head();
    const top = y; y -= RH;
    pg.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: line });
    const mid = y + RH / 2 - 4;
    pg.drawText(fit(s.name, B, 10, cols[0][1] - 10), { x: cols[0][0] + 5, y: mid, size: 10, font: B });
    try {
      const img = await out.embedPng(s.sig), sc = Math.min((cols[1][1] - 10) / img.width, (RH - 8) / img.height);
      pg.drawImage(img, { x: cols[1][0] + 5, y: y + (RH - img.height * sc) / 2, width: img.width * sc, height: img.height * sc });
    } catch (e) { pg.drawText("(signature image unavailable)", { x: cols[1][0] + 5, y: mid, size: 8, font: F, color: grey }); }
    pg.drawText(fit(swDT(sigMs(s)), F, 8, cols[2][1] - 8), { x: cols[2][0] + 4, y: mid, size: 8, font: F });
    pg.drawText(fit(s.jobLabel || "General", F, 8, cols[3][1] - 8), { x: cols[3][0] + 4, y: mid, size: 8, font: F });
    pg.drawText(fit(swD(sigExp(s)), F, 8, cols[4][1] - 8), { x: cols[4][0] + 4, y: mid, size: 8, font: F });
    void top;
  }
  const pages = out.getPages().slice(-n);
  pages.forEach((p, i) => { p.drawText(T(fit(`Generated ${gen} (Brisbane time) · ${POWERED_BY} · Sign-off page ${i + 1} of ${n}`, F, 8, W - 2 * M)), { x: M, y: M - 14, size: 8, font: F, color: grey }); });
  out.setTitle(`${title} SWMS – signed`); out.setAuthor(org.legalName); out.setCreator(PRODUCT_NAME);
  return out.save();
}
function signedFileName(id, job, one) {
  const found = SWMS.find(x => x[0] === id);
  const t = found ? found[1] : "SWMS", slug = x => String(x).replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
  return `SWMS_${slug(t)}_v${SWMS_VERSION}_signed${one ? "_" + slug(one) : job ? "_" + slug(job) : ""}_${ymd(new Date(swNow()))}.pdf`;
}
// Ready sheet: a fresh tap for Share (iPhone/iPad share sheet: Mail, Messages, Files…) / Download / Open.
function deliverPdf(bytes, name, placeholder = false) {
  const blob = new Blob([bytes], { type: "application/pdf" }), url = URL.createObjectURL(blob);
  const file = typeof File === "function" ? new File([blob], name, { type: "application/pdf" }) : null;
  const canShare = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));
  const v = incOverlay(`<h3>📄 Signed SWMS ready</h3><p class="sub">${esc(name)}<br><small class="muted">${Math.round(bytes.length / 1024)} KB</small></p>
    ${placeholder ? `<p class="swph">Placeholder cover only. The official SWMS PDF is not in the app, so do not send this file to a client as the SWMS.</p>` : ""}
    <div class="btns swdlbtns">${canShare ? `<button type="button" class="mbtn complete" id="swshare">Share / Save…</button>` : ""}
    <a class="mbtn ${canShare ? "" : "complete"}" id="swdl" href="${url}" download="${esc(name)}">⬇ Download</a>
    <a class="mbtn ghost" href="${url}" target="_blank" rel="noopener">Open</a><button type="button" class="mbtn ghost" data-x>Close</button></div>`);
  v.classList.add("swdlov"); window.HW_LAST_PDF = { url, name, size: bytes.length, placeholder };
  v.querySelector("[data-x]").onclick = () => { v.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); };
  const sh = v.querySelector("#swshare");
  if (sh) sh.onclick = () => navigator.share({ files: [file], title: name }).catch(e => { if (e.name !== "AbortError") toast("Share failed: " + e.message); });
}
async function downloadSigned(id, job = "", sigId = "") {
  if (!me || me.role !== "admin") return;
  const catalogue = companySwms(myCompanyId());
  if (!catalogue.length) return;
  const all = ui.allSigs || [];
  const one = sigId && all.find(x => x.id === sigId);
  const sigs = one ? [one] : validSigners(id || "", job), sid = one ? one.swmsId : id;
  if (!catalogue.some(row => row[0] === sid)) return;
  const jobLabel = one ? (one.jobLabel || "") : job ? ((all.find(s => sigJobKey(s) === job) || {}).jobLabel || job) : "";
  if (!one && !sigs.length) return toast("No current valid signatures" + (job ? " for that job" : "") + ".");
  toast("Building signed PDF…");
  try { const bytes = await buildSignedSwmsPdf(sid, sigs, jobLabel, !!one); deliverPdf(bytes, signedFileName(sid, jobLabel, one && one.name), !!swmsPlaceholder[sid]); }
  catch (e) { console.warn(e); toast("Could not build PDF: " + (e.code || e.message)); }
}
function swmsDownloadHtml() {
  const catalogue = companySwms(myCompanyId());
  if (!catalogue.length) return "";
  return `<h3 class="swh">Signed downloads <small class="muted">for clients · SWMS + sign-off sheet</small></h3><div class="swdl">
  ${catalogue.map(([id, t]) => { const v = validSigners(id), jobsM = new Map(v.filter(s => sigJobKey(s)).map(s => [sigJobKey(s), s.jobLabel || sigJobKey(s)]));
    return `<div class="swdlrow"><div class="swdlt"><b>${esc(t)}</b><small class="muted">${v.length} current valid signer${v.length === 1 ? "" : "s"}</small></div>
    <select class="swdljob" data-for="${id}" aria-label="Job filter for ${esc(t)}"><option value="">All current valid signatures</option>${[...jobsM].map(([k, l]) => `<option value="${esc(k)}">Job: ${esc(l)}</option>`).join("")}</select>
    <button type="button" class="swbtn primary" data-swdl="${id}" ${v.length ? "" : "disabled"}>⬇ Download signed PDF</button></div>`; }).join("")}</div>`;
}
document.addEventListener("click", e => {
  const gps = e.target.closest("[data-gps-open]"); if (gps) { e.preventDefault(); return openClockScreen(); }
  const a = e.target.closest("[data-swms]"); if (a) { e.preventDefault(); e.stopPropagation(); return swmsOverlay(a.dataset.swms || ""); }
  const sg = e.target.closest("[data-swsign]"); if (sg) { e.preventDefault(); e.stopPropagation(); return signSwms(sg.dataset.swsign, sg.dataset.job || ""); }
  const sv = e.target.closest("[data-swsig]"); if (sv) { e.preventDefault(); e.stopPropagation(); return sigDetail(sv.dataset.swsig); }
  const dl = e.target.closest("[data-swdl]"); if (dl) { e.preventDefault(); e.stopPropagation(); const sel = document.querySelector(`.swdljob[data-for="${dl.dataset.swdl}"]`); return downloadSigned(dl.dataset.swdl, sel ? sel.value : ""); }
  const d1 = e.target.closest("[data-swdlsig]"); if (d1) { e.preventDefault(); e.stopPropagation(); return downloadSigned("", "", d1.dataset.swdlsig); }
  const f = e.target.closest("[data-swmsf]"); if (f) { e.preventDefault(); openSwms(f.dataset.swmsf); }
}, true);

// ---- Global job search (header): lot, street, PO, job number, client. Admin searches every job; staff only their own.
(function gsearch() {
  const box = $("#gsw"), q = $("#gq"), res = $("#gres"); if (!box) return;
  const norm = x => String(x ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const pool = () => { const seen = new Set(), adm = me && me.role === "admin";
    return [...jobs, ...(ui.undated || []), ...(ui.done || [])].filter(j => !seen.has(j.id) && seen.add(j.id) && (adm || (j.assigned || []).includes(me?.uid))); };
  const run = () => { const t = norm(q.value); if (!t) { res.classList.add("hidden"); return; }
    const toks = t.split(" ");
    const hits = pool().map(j => { const hay = " " + norm([jobNo(j), j.sm8JobNo, j.po, j.address, j.client].join(" ")) + " ";
      const ok = toks.every(k => hay.includes(k)); if (!ok) return null;
      const exact = norm(jobNo(j)) === t || norm(j.po) === t; return [exact ? 0 : 1, j]; }).filter(Boolean)
      .sort((a, b) => a[0] - b[0] || String(b[1].date || "").localeCompare(String(a[1].date || ""))).slice(0, 12).map(x => x[1]);
    res.innerHTML = hits.map(j => `<button type="button" class="gr" data-gid="${j.id}"><span class="gr-a">${esc(j.address || "-")}</span>
      <span class="gr-m">#${esc(jobNo(j))} · ${esc(j.client || "")}${j.po ? " · PO " + esc(j.po) : ""} · ${esc(j.date ? shortDate(j.date) : "Unscheduled")}${j.status === "In progress" ? " · in progress" : ""}</span>${j.status === "Done" ? `<span class="gr-done">✔ Completed</span>` : ""}</button>`).join("")
      || `<div class="gr none">No jobs match “${esc(q.value)}”</div>`;
    res.classList.remove("hidden"); };
  q.addEventListener("input", run); q.addEventListener("focus", run);
  q.addEventListener("keydown", e => { if (e.key === "Escape") { q.value = ""; run(); q.blur(); } if (e.key === "Enter") res.querySelector(".gr[data-gid]")?.click(); });
  document.addEventListener("click", e => { if (!box.contains(e.target)) res.classList.add("hidden"); });
  res.addEventListener("click", e => { const b = e.target.closest("[data-gid]"); if (!b) return; const j = pool().find(x => x.id === b.dataset.gid); if (!j) return;
    res.classList.add("hidden"); q.blur();
    if (me.role === "admin" && !ui.myJobs) editJob(j); else { ui.opSel = j.id; renderOperator(); window.scrollTo(0, 0); } });
  setInterval(() => box.classList.toggle("hidden", !me), 1000);
})();

function mountChat() {
  CHAT = installChatApp({ db, storage, getMe: () => me, toast });
  if (me) CHAT.start();
}
function openPushTarget(target) {
  if (!me || !target) return false;
  const strip = () => {
    try {
      const url = new URL(location.href);
      url.searchParams.delete("chat");
      url.searchParams.delete("thread");
      url.searchParams.delete("prestart");
      url.searchParams.delete("kind");
      url.searchParams.delete("day");
      url.searchParams.delete("psjob");
      if (url.searchParams.get("jobs") === "today") url.searchParams.delete("jobs");
      if (url.searchParams.get("open") === "today" || url.searchParams.get("open") === "chat" || url.searchParams.get("open") === "timesheet") url.searchParams.delete("open");
      url.searchParams.delete("ticket");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch { /* keep the current address */ }
  };
  if (target.kind === "ticket") {
    if (me.platformOwner && !me.testCompanyId) {
      ui.myJobs = false;
      ui.view = "master";
      ui.ticketFocus = target.ticketId;
    }
    strip();
    return true;
  }
  if (target.kind === "timesheet") {
    ui.opSel = null;
    if (me.role === "admin" && !ui.myJobs) ui.view = "timesheet";
    else ui.opTab = "hours";
    strip();
    return true;
  }
  if (target.kind === "today") {
    ui.myJobs = me.role === "admin";
    ui.opTab = "today";
    ui.opSel = null;
    ui.jobPane = "job";
    strip();
    return true;
  }
  if (target.kind === "prestart") {
    ui.prestartAsset = target.assetId || "";
    ui.prestartKind = target.prestartKind || "";
    if (COMP.focusPrestart) COMP.focusPrestart(ui.prestartAsset, ui.prestartKind);
    ui.opSel = null;
    ui.jobPane = "job";
    if (me.role === "admin" && !ui.myJobs) ui.view = "prestart";
    else ui.opTab = "prestart";
    strip();
    return true;
  }
  if (target.kind !== "chat") return false;
  if (target.thread === "staff") {
    ui.opSel = null;
    if (me.role === "admin" && !ui.myJobs) ui.view = "chat";
    else ui.opTab = "chat";
    strip();
    return true;
  }
  const jobId = String(target.thread || "").slice(4);
  const pool = [...(jobs || []), ...(ui.undated || []), ...(ui.done || [])];
  const job = pool.find(j => j.id === jobId);
  if (!job) {
    if (target.missing) { strip(); return true; }
    if (!target.loading) {
      target.loading = true;
      getDoc(doc(db, "jobs", jobId)).then(snap => {
        target.loading = false;
        if (!snapExists(snap)) { target.missing = true; }
        else {
          const row = { id: jobId, ...snap.data() };
          if (docCompanyId(row) === myCompanyId()) jobs.push(row);
          else target.missing = true;
        }
        if (me && me.role === "admin" && !ui.myJobs) renderAdmin(); else renderOperator();
      }).catch(() => { target.loading = false; });
    }
    return false;
  }
  if (docCompanyId(job) !== myCompanyId()) { strip(); return true; }
  strip();
  if (me.role === "admin" && !ui.myJobs) {
    ui.openJobChat = true;
    queueMicrotask(() => editJob(job));
    return true;
  }
  ui.opSel = job.id;
  ui.jobPane = "chat";
  return true;
}
function mountPush() {
  PUSH = installPush({
  app: fb, db, vapidKey, emulator: useEmulator,
  getUid: () => me && me.uid,
  getCompanyId: () => myCompanyId(),
  toast,
  rerender() {
    if (!me) return;
    if (me.role === "admin" && !ui.myJobs) renderAdmin(); else renderOperator();
  },
  open: openPushTarget,
  });
  if (me) PUSH.start();
}
function mountCompliance() {
  COMP = installCompliance({
  db, collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp,
  queueWrite, savedOnPhone: SAVED_ON_PHONE,
  getJobs: () => [...(jobs || []), ...(ui.undated || []), ...(ui.done || [])],
  getMe: () => me, getUi: () => ui, today: todayStr, toast,
  canSeeMoney,
  rerenderAdmin: () => { if (me && me.role === "admin") { ui.forceRender = true; renderAdmin(); } },
  rerenderOperator: () => { ui.forceRender = true; renderOperator(); },
  });
  if (me) COMP.start();
}
// ---- Guided Quotes (CallUp, Nov 2026). Rates in meta/quoteRates — never invented. No GPS in this build.
async function loadRunSheets(date) {
  ui.runSheets = ui.runSheets || {};
  await Promise.all(staff.filter(s => s && s.uid).map(async s => {
    const id = runSheetId(s.uid, date);
    if (!id) return;
    try {
      const snap = await cachedGetDoc(doc(db, "runSheets", id));
      ui.runSheets[id] = snapExists(snap) ? { id, ...snap.data() } : false;
    } catch { ui.runSheets[id] = false; }
  }));
}
ROUTE = installRouteOrder({
  db, doc, setDoc, updateDoc, serverTimestamp,
  todayStr, toast,
  getMe: () => me,
  getCompanyId: () => myCompanyId(),
  getStaff: () => staff,
  getJobs: () => [...jobs, ...(ui.undated || [])],
  peekSheet: (uid, date) => {
    const id = runSheetId(uid, date);
    const sheet = (ui.runSheets || {})[id];
    return sheet && sheet.status === "approved" ? sheet : null;
  },
  loadSheets: loadRunSheets,
  rememberSheet: (id, data) => {
    ui.runSheets = ui.runSheets || {};
    ui.runSheets[id] = { id, ...data, status: "approved" };
    queueDispatchPersist(jobs, [data && data.date].filter(Boolean));
    if (ui.view === "dispatch") renderAdmin();
  },
  cacheGeo: (job, hit) => updateDoc(doc(db, "jobs", job.id), geoPatch(job.address, hit)),
});
async function openAcceptedJob(jobId) {
  const id = String(jobId || "").trim();
  if (!id) { toast("That job has no id yet"); return; }
  let job = [...(jobs || []), ...(ui.undated || []), ...(ui.done || [])].find(j => j.id === id);
  if (!job) {
    try {
      const snap = await getDoc(doc(db, "jobs", id));
      if (!snapExists(snap)) { toast("That job isn't on this phone yet"); return; }
      job = withMoney({ id, ...snap.data() });
    } catch (e) {
      toast("Couldn't open that job");
      return;
    }
  }
  const d = $("#dlg");
  if (d) d.onclose = null;
  if (d && d.open) d.close();
  if (me && me.role === "admin" && !ui.myJobs) editJob(job);
  else if ((jobs || []).some(j => j.id === job.id)) { ui.opSel = job.id; ui.jobPane = "job"; renderOperator(); window.scrollTo(0, 0); }
  else editJob(job);
}
function mountQuotes() {
  QG = installQuotes({
  db, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, collection, query, where, onSnapshot, serverTimestamp, arrayUnion, runTransaction,
  $, esc, toast, $$, CLIENTS, TYPES, canSeeMoney, canQuote, canEditQuoteRates, todayStr, jobNo,
  openJob: openAcceptedJob,
  getMe: () => me, getUi: () => ui, getCompanyId: () => myCompanyId(),
  suggestions: field => (currentSuggestions()[field] || []),
  refreshAutofill: () => refreshAutofillLists(),
  wireClientPrefill: root => wireClientPrefill(root),
  remember: entries => rememberEntries(entries),
  isAdmin: () => !!(me && me.role === "admin"),
  sendCustomerQuote: (quoteId, to) => callCompanyFunction("sendCustomerQuote", { quoteId, to }),
  saveExtraTrade: async (tradeId) => {
    const id = normalizeTrade(tradeId);
    if (!id || !canEditTitles()) { toast("Only an admin or a manager can change trades."); return; }
    const cur = (ui.tradeSetup && ui.tradeSetup.enabled) || [];
    if (cur.includes(id)) { toast(tradeLabel(id) + " is already on."); return; }
    try {
      await persistTrades([...cur, id]);
      toast(tradeLabel(id) + (quotePack(id) && quotePack(id).ready ? " added. Quote pack ready." : " added. Quote pack coming soon."));
      redrawAfterSave();
    } catch { toast("Couldn't update trades."); }
  },
  renderAdmin: () => (me && me.role === "admin" ? renderAdmin() : renderOperator()),
  get staff() { return staff; }
  });
  window.HW_QUOTES = QG; // preview / tests
}
function mountFeatureApps() {
  if (ui.featuresMounted) return;
  ui.featuresMounted = true;
  mountChat();
  mountPush();
  mountCompliance();
  mountQuotes();
  const depot = orgSettings().address;
  setRouteDepot(depot, { heartwood: myCompanyId() === "heartwood" });
  setDefaultDepot(depot, { heartwood: myCompanyId() === "heartwood" });
  if (ui.tradeSetup) setQuoteTradeSetup(ui.tradeSetup);
  startDesktopInstall(document, window, () => currentBanner() === "windows");
}
window.HW_QUOTES = QG;
