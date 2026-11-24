// Drag a dispatch-board job onto another day, time or person.
// Pure planning lives here so the page can save through the same job write as the edit form.
// The day board is an hour grid: a drop snaps to a 15-minute start and pins it (timeSource manual),
// the same result as typing a start time. The week board and the phone list have no time grid:
// a drop between jobs picks a start that sorts into that gap, preferring a 15-minute mark and
// otherwise one minute later so the order on screen is the order that is saved.
// A multi-day job is one document. Moving it shifts date and any endDate/dateEnd by the same
// number of days. durationHrs is left alone, so a finish after midnight moves with the start.

import { formatMinutes, normaliseTime, parseMinutes, roundTo15 } from "./dispatch-times.js";

export const LONG_PRESS_MS = 480;
export const TOUCH_SLOP_PX = 12;
export const MOUSE_SLOP_PX = 6;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const OFFICE = new Set(["admin", "manager", "supervisor"]);
const CREW = new Set(["operator", "labourer"]);

export function addDaysIso(day, n) {
  const [y, m, d] = String(day).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function dayDelta(from, to) {
  if (!ISO.test(from || "") || !ISO.test(to || "")) return 0;
  const a = Date.parse(from + "T00:00:00Z");
  const b = Date.parse(to + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/**
 * Who may change a job's date. Matches the job rules: crew cannot.
 * Heartwood job writes are admin-only (managers and supervisors can read the board's data
 * but the rules do not let them write a job). Other companies: admin, manager, supervisor.
 * A shell role of admin still counts when the profile role was stored as crew. That is the
 * Heartwood admin login. A Heartwood manager keeps staffRole manager and cannot drag.
 */
export function canEditJobDate(actor) {
  if (!actor) return false;
  const role = String(actor.role || "").trim();
  const staffRole = String(actor.staffRole || "").trim();
  if (CREW.has(role)) return false;
  if (CREW.has(staffRole) && role !== "admin") return false;
  const company = String(actor.companyId || "heartwood").trim() || "heartwood";
  if (company === "heartwood") {
    if (staffRole === "manager" || staffRole === "supervisor") return false;
    return role === "admin" || staffRole === "admin";
  }
  const effective = staffRole || role;
  return OFFICE.has(effective) || role === "admin";
}

/** Completed and invoiced jobs are not draggable. */
export function dragBlockReason(job) {
  if (!job) return "missing";
  if (job.invoiced === true) return "invoiced";
  if (job.xeroCheck && job.xeroCheck.status === "invoiced") return "invoiced";
  if (job.status === "Done" || job.status === "Completed" || job.sm8Status === "Completed" || job.sm8Status === "Done") return "completed";
  return "";
}

export function snapQuarter(hour, fraction) {
  if (hour == null || String(hour).trim() === "") return "";
  const h = Number(hour);
  if (!Number.isInteger(h) || h < 0 || h > 23) return "";
  const f = Number(fraction);
  const q = !Number.isFinite(f) || f < 0.25 ? 0 : f < 0.5 ? 15 : f < 0.75 ? 30 : 45;
  return formatMinutes(h * 60 + q);
}

export function gridFraction(rect, y) {
  const height = rect && Number(rect.height);
  if (!height || height <= 0) return 0;
  const f = (Number(y) - Number(rect.top)) / height;
  if (!Number.isFinite(f)) return 0;
  return Math.min(1, Math.max(0, f));
}

/** The chip whose midpoint is still below the pointer, or "" to place the job last. */
export function insertBeforeId(rows, y) {
  for (const row of rows || []) {
    if (!row || !row.id) continue;
    const mid = (Number(row.top) + Number(row.bottom)) / 2;
    if (Number(y) < mid) return String(row.id);
  }
  return "";
}

function clock(mins) {
  const capped = Math.max(0, Math.min(23 * 60 + 45, Math.round(mins)));
  return formatMinutes(capped);
}

function quarterInside(lo, hi) {
  if (!(hi - lo >= 15)) return "";
  let mid = roundTo15((lo + hi) / 2);
  if (mid <= lo) mid = roundTo15(lo + 15);
  if (mid >= hi) mid = roundTo15(hi - 15);
  if (mid > lo && mid < hi) return clock(mid);
  return "";
}

/**
 * A start time that sorts between two neighbours.
 * mode "quarter" is a 15-minute mark. mode "minute" is one minute after the job above
 * (or one minute before the job below) when the gap is tighter than 15 minutes.
 * mode "same" means the neighbours are less than a minute apart, so the time is shared.
 */
export function timeBetween(prevTime, nextTime, options = {}) {
  const start = parseMinutes(options.dayStart) ?? 7 * 60;
  const prev = prevTime ? parseMinutes(prevTime) : null;
  const next = nextTime ? parseMinutes(nextTime) : null;
  if (prev == null && next == null) return { time: clock(start), mode: "day-start" };
  if (prev == null) {
    const quarter = quarterInside(Math.max(0, next - 60), next);
    if (quarter && parseMinutes(quarter) >= start) return { time: quarter, mode: "quarter" };
    const earlier = Math.max(start, next - 15);
    if (earlier < next && earlier >= start) {
      const snapped = roundTo15(earlier);
      if (snapped >= start && snapped < next) return { time: clock(snapped), mode: "quarter" };
    }
    if (next - 1 >= start && next - 1 < next) return { time: clock(next - 1), mode: "minute" };
    return { time: clock(Math.max(0, next)), mode: "same" };
  }
  if (next == null) {
    const target = prev + 15;
    const snapped = roundTo15(target);
    if (snapped > prev) return { time: clock(snapped), mode: "quarter" };
    if (target > prev) return { time: clock(target), mode: "minute" };
    return { time: clock(prev), mode: "same" };
  }
  if (next <= prev) return { time: clock(prev), mode: "same" };
  const inside = quarterInside(prev, next);
  if (inside) return { time: inside, mode: "quarter" };
  if (next - prev >= 2) return { time: clock(prev + 1), mode: "minute" };
  return { time: clock(prev), mode: "same" };
}

export function blockDays(job) {
  if (!job || !ISO.test(job.date || "")) return 1;
  let end = job.date;
  for (const key of ["endDate", "dateEnd"]) {
    if (ISO.test(job[key] || "") && job[key] > end) end = job[key];
  }
  const startMin = parseMinutes(job.time);
  const hours = Number(job.durationHrs);
  if (startMin != null && Number.isFinite(hours) && hours > 0) {
    const extra = Math.floor((startMin + hours * 60 - 1) / (24 * 60));
    if (extra > 0) {
      const byClock = addDaysIso(job.date, Math.min(extra, 13));
      if (byClock > end) end = byClock;
    }
  }
  return Math.max(1, Math.min(14, dayDelta(job.date, end) + 1));
}

/** Shift the whole booking. endDate and dateEnd, when present, move with the start date. */
export function shiftBlock(job, nextDate) {
  const patch = { date: nextDate };
  const from = job && job.date || "";
  if (!ISO.test(from) || !ISO.test(nextDate || "") || from === nextDate) return patch;
  const delta = dayDelta(from, nextDate);
  for (const key of ["endDate", "dateEnd"]) {
    if (ISO.test(job[key] || "")) patch[key] = addDaysIso(job[key], delta);
  }
  return patch;
}

export function dragGhostText(job, time) {
  const when = normaliseTime(time || (job && job.time) || "");
  const street = String((job && job.address) || "").split(",")[0].replace(/\$/g, "").trim();
  const days = blockDays(job);
  const span = days > 1 ? days + "-day block" : "";
  return [when, street, span].filter(Boolean).join(" · ");
}

function putTime(patch, job, time, mode) {
  if (!time) return "";
  const current = normaliseTime(job.time);
  // A manual job already at this clock does not need another write. An automatic 07:00
  // (or any auto time) is pinned when the drop chose that clock on purpose.
  if (time === current && job.timeSource === "manual") return "";
  if (time === current && mode === "same") return "";
  patch.time = time;
  patch.timeSource = "manual";
  return mode;
}

/**
 * Schedule fields for one drop. Staff names are applied by the page, which knows the directory.
 * Returns ok:false with reason "same" when nothing about the booking would change.
 */
export function planDispatchDrop(job, drop, options = {}) {
  const reason = dragBlockReason(job);
  if (reason) return { ok: false, reason };
  if (!drop) return { ok: false, reason: "nodrop" };
  const date = ISO.test(drop.date || "") ? drop.date : (job.date || "");
  if (!ISO.test(date)) return { ok: false, reason: "nodate" };
  const patch = {};
  const block = shiftBlock(job, date);
  if (block.date !== (job.date || "")) Object.assign(patch, block);
  let timeNote = "";
  if (drop.grid && drop.hour != null && drop.hour !== "") {
    const time = snapQuarter(drop.hour, drop.fraction);
    timeNote = putTime(patch, job, time, "quarter") ? "Snapped to 15 minutes." : "";
  } else if (drop.reorder) {
    const lane = (drop.lane || []).filter(row => row && row.id && row.id !== job.id);
    if (lane.length) {
      let idx = lane.length;
      if (drop.beforeId) {
        const at = lane.findIndex(row => row.id === drop.beforeId);
        if (at >= 0) idx = at;
      }
      const prev = idx > 0 ? lane[idx - 1] : null;
      const next = idx < lane.length ? lane[idx] : null;
      const placed = timeBetween(prev && prev.time, next && next.time, options);
      const noted = putTime(patch, job, placed.time, placed.mode);
      if (noted === "quarter" || noted === "day-start") timeNote = "Placed on a 15-minute start between the jobs around it.";
      else if (noted === "minute") timeNote = "The gap was under 15 minutes, so the start is one minute after the job above and the order stays.";
      else if (noted === "same") timeNote = "Those jobs are less than a minute apart, so this one keeps that start.";
    }
  }
  const staffChanged = !!(drop.toKey && drop.fromKey !== drop.toKey);
  if (!Object.keys(patch).length && !staffChanged) return { ok: false, reason: "same" };
  return {
    ok: true,
    patch,
    staffChanged,
    toKey: drop.toKey || "",
    fromKey: drop.fromKey || "",
    timeNote,
  };
}

export function dropFromCell(cell, y, extra = {}) {
  const data = cell && cell.dataset || {};
  const fromKey = extra.fromKey || "";
  const jobId = extra.jobId || "";
  const date = data.date || data.mday || "";
  const hour = data.hour;
  const grid = hour != null && hour !== "";
  const inStrip = typeof cell.closest === "function" && !!cell.closest(".mstrip");
  const dateOnly = inStrip && !data.staff;
  const toKey = dateOnly ? fromKey : (data.staff || fromKey);
  if (grid) {
    return {
      date, hour, fraction: gridFraction(cell.getBoundingClientRect(), y),
      grid: true, reorder: false, beforeId: "", lane: [], toKey, fromKey,
    };
  }
  if (dateOnly) {
    return { date, hour: "", fraction: 0, grid: false, reorder: false, beforeId: "", lane: [], toKey: fromKey, fromKey };
  }
  const nodes = [...(cell.querySelectorAll ? cell.querySelectorAll(".dchip[data-id], .mdc[data-id]") : [])]
    .filter(node => node.dataset && node.dataset.id !== jobId);
  const lane = nodes.map(node => ({ id: node.dataset.id, time: node.dataset.time || "" }));
  const beforeId = insertBeforeId(nodes.map(node => {
    const rect = node.getBoundingClientRect();
    return { id: node.dataset.id, top: rect.top, bottom: rect.bottom };
  }), y);
  return { date, hour: "", fraction: 0, grid: false, reorder: true, beforeId, lane, toKey, fromKey };
}

function moveGhost(ghost, x, y) {
  ghost.style.left = Math.round(x + 12) + "px";
  ghost.style.top = Math.round(y + 12) + "px";
}

function clearMarks(root) {
  root.querySelectorAll(".over").forEach(el => el.classList.remove("over"));
  root.querySelectorAll(".drop-mark, .drop-snap").forEach(el => el.remove());
}

function paintTarget(root, doc, x, y, state) {
  clearMarks(root);
  const dropEl = elementAt(doc, x, y, state);
  if (!dropEl) return null;
  dropEl.classList.add("over");
  const drop = dropFromCell(dropEl, y, { fromKey: state.fromKey, jobId: state.job.id });
  if (drop.grid) {
    const q = !Number.isFinite(drop.fraction) || drop.fraction < 0.25 ? 0 : drop.fraction < 0.5 ? 1 : drop.fraction < 0.75 ? 2 : 3;
    const mark = doc.createElement("div");
    mark.className = "drop-snap";
    mark.style.top = (q * 25) + "%";
    mark.textContent = snapQuarter(drop.hour, drop.fraction);
    dropEl.appendChild(mark);
  } else if (drop.reorder) {
    const mark = doc.createElement("div");
    mark.className = "drop-mark";
    const before = drop.beforeId && [...dropEl.querySelectorAll(".dchip[data-id], .mdc[data-id]")].find(node => node.dataset.id === drop.beforeId);
    if (before) before.before(mark);
    else dropEl.appendChild(mark);
  }
  return drop;
}

function elementAt(doc, x, y, state) {
  const stack = typeof doc.elementsFromPoint === "function" ? doc.elementsFromPoint(x, y) : [];
  for (const el of stack) {
    if (!el || !el.closest) continue;
    if (el.classList && (el.classList.contains("drag-ghost") || el.classList.contains("drop-mark") || el.classList.contains("drop-snap"))) continue;
    if (el === state.chip) continue;
    const drop = el.closest(".drop, .mstrip button[data-mday]");
    if (drop && drop !== state.chip) return drop;
  }
  return null;
}

/**
 * Pointer drag for mouse and touch. Touch waits for a long-press so the page can still scroll.
 * Returns an unbind function. Drop targets are .drop cells and the phone day strip.
 */
export function bindBoardDrag(root, api) {
  if (!root || !api || !root.ownerDocument) return () => {};
  const doc = root.ownerDocument;
  let pending = null;
  let drag = null;
  let swallowClick = false;

  function stopPending() {
    if (pending && pending.timer) clearTimeout(pending.timer);
    pending = null;
  }

  function startDrag(state, ev) {
    if (!api.canDrag(state.job)) {
      stopPending();
      swallowClick = true;
      setTimeout(() => { swallowClick = false; }, 500);
      state.chip.dataset.draglock = "1";
      if (api.onBlocked) api.onBlocked(state.job, api.blockReason ? api.blockReason(state.job) : dragBlockReason(state.job));
      return;
    }
    drag = state;
    pending = null;
    state.suppress = true;
    doc.body.classList.add("dispatch-dragging");
    state.chip.classList.add("dragging");
    try { state.chip.setPointerCapture(ev.pointerId); } catch { /* the document listener still follows the pointer */ }
    const ghost = doc.createElement("div");
    ghost.className = "drag-ghost";
    ghost.textContent = api.ghost(state.job) || "Job";
    doc.body.appendChild(ghost);
    moveGhost(ghost, ev.clientX, ev.clientY);
    paintTarget(root, doc, ev.clientX, ev.clientY, state);
  }

  function finish(commit, ev) {
    const state = drag;
    drag = null;
    stopPending();
    doc.body.classList.remove("dispatch-dragging");
    const ghost = doc.querySelector(".drag-ghost");
    if (ghost) ghost.remove();
    clearMarks(root);
    if (!state) return;
    state.chip.classList.remove("dragging");
    if (!commit || !ev) return;
    state.suppress = true;
    const drop = paintTarget(root, doc, ev.clientX, ev.clientY, state);
    clearMarks(root);
    if (drop) api.onDrop(state.job, drop);
  }

  function onDown(ev) {
    if (drag || pending) return;
    if (ev.button != null && ev.button !== 0) return;
    const chip = ev.target && ev.target.closest && ev.target.closest(".dchip[data-id], .mdc[data-id]");
    if (!chip || !root.contains(chip)) return;
    if (ev.target.closest("a, button, input, textarea, select, label")) return;
    const job = api.job(chip.dataset.id);
    if (!job) return;
    const touch = ev.pointerType === "touch" || ev.pointerType === "pen";
    const state = {
      id: ev.pointerId,
      chip,
      job,
      x: ev.clientX,
      y: ev.clientY,
      touch,
      fromKey: (chip.closest("[data-staff]") || { dataset: {} }).dataset.staff || "",
      suppress: false,
      timer: null,
    };
    pending = state;
    if (!touch) return;
    state.timer = setTimeout(() => {
      if (pending !== state) return;
      if (!api.canDrag(job)) {
        pending = null;
        state.chip.dataset.draglock = "1";
        if (api.onBlocked) api.onBlocked(job, api.blockReason ? api.blockReason(job) : dragBlockReason(job));
        return;
      }
      startDrag(state, { pointerId: state.id, clientX: state.x, clientY: state.y });
    }, api.longPressMs || LONG_PRESS_MS);
  }

  function onMove(ev) {
    if (pending && !drag && pending.id === ev.pointerId) {
      const dist = Math.hypot(ev.clientX - pending.x, ev.clientY - pending.y);
      if (pending.touch) {
        if (dist > (api.touchSlop || TOUCH_SLOP_PX)) stopPending();
        return;
      }
      if (dist >= (api.mouseSlop || MOUSE_SLOP_PX)) startDrag(pending, ev);
      return;
    }
    if (!drag || drag.id !== ev.pointerId) return;
    ev.preventDefault();
    const ghost = doc.querySelector(".drag-ghost");
    if (ghost) moveGhost(ghost, ev.clientX, ev.clientY);
    paintTarget(root, doc, ev.clientX, ev.clientY, drag);
  }

  function onUp(ev) {
    if (pending && !drag && pending.id === ev.pointerId) {
      stopPending();
      return;
    }
    if (drag && drag.id === ev.pointerId) finish(true, ev);
  }

  function onCancel(ev) {
    if ((pending && pending.id === ev.pointerId) || (drag && drag.id === ev.pointerId)) finish(false, ev);
  }

  function onClick(ev) {
    if (swallowClick) {
      swallowClick = false;
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    const chip = ev.target && ev.target.closest && ev.target.closest(".dchip[data-id], .mdc[data-id]");
    if (chip && chip.dataset && chip.dataset.draglock === "1") {
      chip.dataset.draglock = "";
      ev.preventDefault();
      ev.stopPropagation();
    }
  }

  function onContext(ev) {
    const chip = ev.target && ev.target.closest && ev.target.closest(".dchip, .mdc");
    if (chip && root.contains(chip)) ev.preventDefault();
  }

  const wrappedFinish = finish;
  finish = (commit, ev) => {
    const chip = drag && drag.chip;
    wrappedFinish(commit, ev);
    // The click that follows a pointer-up would open the job. Swallow that one click.
    if (commit) {
      swallowClick = true;
      setTimeout(() => { swallowClick = false; }, 500);
      if (chip) chip.dataset.draglock = "1";
    }
  };

  root.addEventListener("pointerdown", onDown);
  doc.addEventListener("pointermove", onMove, { passive: false });
  doc.addEventListener("pointerup", onUp);
  doc.addEventListener("pointercancel", onCancel);
  doc.addEventListener("click", onClick, true);
  root.addEventListener("contextmenu", onContext);

  return () => {
    stopPending();
    if (drag) finish(false, null);
    root.removeEventListener("pointerdown", onDown);
    doc.removeEventListener("pointermove", onMove);
    doc.removeEventListener("pointerup", onUp);
    doc.removeEventListener("pointercancel", onCancel);
    doc.removeEventListener("click", onClick, true);
    root.removeEventListener("contextmenu", onContext);
  };
}
