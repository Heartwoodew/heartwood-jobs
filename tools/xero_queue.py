#!/usr/bin/env python3
"""Xero queue dry run. Does not call Xero, does not send email, and does not write.

The live Heartwood desktop worker is not this file and is unchanged.
Heartwood queue items (no companyId, or companyId heartwood) stay on that worker
and would still be associated with accounts@heartwoodew.com.

Other companies resolve to companies/{id}.accountsEmail. This script only prints
that plan. There is no send mode.

It refuses the live project. It reads Firestore only when FIRESTORE_EMULATOR_HOST
is set and --emulator is passed. The default is a local dry run of the sample
you pass with --demo, or a no-read exit.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from company_scope import xero_accounts  # noqa: E402

LIVE_PROJECT = "heartwood-9f37f"


def plan_item(item, company):
    row = xero_accounts(item, company)
    row["id"] = item.get("id") or ""
    row["status"] = item.get("status") or ""
    return row


def main(argv):
    if any(LIVE_PROJECT in a for a in argv) or os.environ.get("GCLOUD_PROJECT") == LIVE_PROJECT or os.environ.get("GOOGLE_CLOUD_PROJECT") == LIVE_PROJECT:
        sys.exit("refusing: this script does not run against " + LIVE_PROJECT)
    if "--send" in argv or "--commit" in argv:
        sys.exit("refusing: xero_queue.py has no send mode")
    demo = "--demo" in argv
    if demo:
        rows = [
            plan_item({"id": "heartwood-sample", "status": "queued"}, None),
            plan_item({"id": "acme-sample", "status": "queued", "companyId": "acme"}, {"accountsEmail": "accounts@acme.test", "name": "Acme Civil"}),
        ]
        print(json.dumps({"mode": "dry-run", "read": False, "rows": rows}, indent=1))
        return
    if "--emulator" not in argv:
        print(json.dumps({"mode": "dry-run", "read": False, "reason": "pass --demo or --emulator. production is not read."}))
        return
    if not os.environ.get("FIRESTORE_EMULATOR_HOST"):
        sys.exit("refusing: --emulator requires FIRESTORE_EMULATOR_HOST")
    sys.exit("emulator listing is done by cloud/scripts/migrate-company-id.mjs; this file does not open a client")


if __name__ == "__main__":
    main(sys.argv[1:])
