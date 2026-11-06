// Production entry for retention. The source constant SCHEDULING_APPROVED
// is false, so this handler does not delete even if every env flag is set.
// There is no Cloud Scheduler binding in index.js.

import { SCHEDULING_APPROVED, runRetention } from "../shared/cloud-retention.js";

export function retentionSweepHandler(state, env = {}) {
  const envOn = env.RETENTION_SCHEDULING_APPROVED === "true" && env.RETENTION_PURGE_ENABLED === "true";
  if (SCHEDULING_APPROVED !== true || !envOn) {
    return {
      ran: false,
      reason: "scheduling-not-approved",
      mutated: false,
      schedulingApprovedConstant: SCHEDULING_APPROVED,
      state,
      softDeleted: [],
      purged: [],
      skipped: [],
      errors: [],
    };
  }
  return runRetention(state, {
    now: env.now || new Date(),
    flags: {
      schedulingApproved: true,
      purgeEnabled: true,
      heartwoodApproved: env.HEARTWOOD_RETENTION_APPROVED === "true",
    },
    deleteObject: env.deleteObject,
  });
}
