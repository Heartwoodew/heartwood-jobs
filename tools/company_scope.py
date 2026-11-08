"""Which company an export or queue item belongs to, and where its accounts mail goes.

Heartwood (missing companyId) stays on accounts@heartwoodew.com.
This module does not connect to Firebase, Gmail, or Xero.
"""
import re

HEARTWOOD_ID = "heartwood"
HEARTWOOD_ACCOUNTS = "accounts@heartwoodew.com"
HEARTWOOD_SUBJECT = "Heartwood"
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
HUBDOC_RE = re.compile(r"^[a-z0-9._+-]+@app\.hubdoc\.com$")


def company_id_of(data, path_company=""):
    data = data or {}
    cid = str(data.get("companyId") or "").strip()
    if cid:
        return cid
    tenant = str(data.get("tenantId") or "").strip()
    if tenant:
        return tenant
    path = str(path_company or "").strip()
    return path or HEARTWOOD_ID


def hours_recipient(doc):
    """(ok, to, subject_name). Heartwood is accounts@ and the subject word Heartwood."""
    cid = company_id_of(doc)
    to = str((doc or {}).get("to") or "").strip()
    if cid == HEARTWOOD_ID:
        return to == HEARTWOOD_ACCOUNTS, HEARTWOOD_ACCOUNTS, HEARTWOOD_SUBJECT
    if to == HEARTWOOD_ACCOUNTS or not EMAIL_RE.fullmatch(to):
        return False, "", ""
    name = str((doc or {}).get("companyName") or "Company").strip() or "Company"
    return True, to, name


def hours_subject(subject_name, week_start_dmy, week_end_dmy, tag):
    who = HEARTWOOD_SUBJECT if subject_name == HEARTWOOD_SUBJECT else subject_name
    return f"Timesheet hours {week_start_dmy} to {week_end_dmy} - {who} {tag}"


def hubdoc_for(doc, company, heartwood_hub):
    """Heartwood uses the existing ownerSettings address. Others use their own or are skipped."""
    cid = company_id_of(doc)
    if cid == HEARTWOOD_ID:
        return heartwood_hub, "Heartwood"
    hub = str((company or {}).get("hubdocAddress") or "").strip().lower()
    name = str((company or {}).get("name") or "Company").strip() or "Company"
    if not HUBDOC_RE.fullmatch(hub):
        return "", name
    return hub, name


def xero_accounts(item, company):
    """Where a later accounts copy would go. This does not call Xero.

    Heartwood returns the existing mailbox and a note that the desktop worker is unchanged.
    """
    cid = company_id_of(item)
    if cid == HEARTWOOD_ID:
        return {
            "companyId": HEARTWOOD_ID,
            "accountsEmail": HEARTWOOD_ACCOUNTS,
            "send": False,
            "reason": "heartwood-desktop-worker-unchanged",
        }
    email = str((company or {}).get("accountsEmail") or "").strip()
    return {
        "companyId": cid,
        "accountsEmail": email,
        "send": False,
        "reason": "dry-run-company-accounts" if EMAIL_RE.fullmatch(email) else "missing-accounts-email",
    }
