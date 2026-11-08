# Team chat and job chat

**Status: LIVE** in the client on `main` `01f2c5a6f407e123f7f48432f07f1e9445a36007`. Chat rules are a paste block. `cloud/emulator/firestore.rules` lines 7–10 say the live rules are not this file and the chat block is the piece to merge. Whether that merge has been published is **GAP**.

## Where it is

- Admin: **Chat** in the top menu (`NAV_TOP`, `app/app.js` line 154). Badge is unread staff chat (`shell`, line 161).
- Admin job card: **Chat** tab (`jobTabs`, line 1294). Badge is that job’s thread.
- Operator: **Chat** bottom tab, and a **Chat** tab on the job (`renderOpDetail`, lines 1966–1968).

`installChatApp` is called at `app/app.js` line 2686. While the compose box is focused, a snapshot refresh does not wipe the screen (admin line 1048, operator line 1870).

## Threads

`app/features/chat.js`:

- Staff thread id is `"staff"` (line 7).
- Job thread id is `job_` plus the job id. The job id must match `^[A-Za-z0-9_-]{1,200}$` (`jobThreadId`, lines 17–20).
- Team chat: any member with a resolved tenant (`canUseTeamChat`, lines 29–31).
- Job chat: `canSeeJob` (lines 33–35), same tenant, customer list if set, and admin or assigned.

Firestore paths in the paste rules (`cloud/emulator/firestore.rules` lines 170–192, also `cloud/production/firestore.chat.rules`):

- `tenants/{tenantId}/chats/{threadId}` — head (`lastAt`, `lastSenderUid`, `lastSenderName`, `preview` ≤ 140).
- `.../messages/{messageId}` — create only, no update. Delete by the sender or a chat admin.
- `tenants/{tenantId}/chatSeen/{uid}/threads/{threadId}` — only your own `{ seenAt }`.

A message may contain `senderUid`, `senderName` (1–80), `text` (≤ 4000), `createdAt` equal to `request.time`, and an optional photo (`chatMessageOk`, lines 139–158). Empty text is allowed only with a photo.

Heartwood bootstrap: Alex and Patrick with no `tenantId` resolve to tenant `heartwood` (`chatCallerTenant`, lines 71–75). A job with no `tenantId` is `heartwood` (`chatJobTenant`, lines 84–88). Another tenant’s job is not readable.

Customer scope: if `users.customerIds` is a non-empty list, the job’s `client` must be in it (`chatCustomerOk`, lines 95–101).

## Photos in chat

`planChatPhoto` (`chat.js` lines 58–85). jpeg, png, webp, gif. Max 8 MB. Path:

- Staff: `tenants/{tenant}/chat/staff/photos/c{id}`
- Job: `tenants/{tenant}/chat/jobs/{jobId}/photos/c{id}`

The id matches `^c[A-Za-z0-9]{8,40}$`. Purpose metadata is `chat-photo`. No download URL (`chat.js` lines 1–3). Storage rules allow the uploader, Alex, Patrick, or a profile admin to delete a chat photo (`storage.rules` lines 197–216). Job photos still cannot be deleted.

## Unread

Unread is local plus `chatSeen`. `unreadCount` (`chat.js` lines 146–155) counts messages from other people after `seenMillis`. The badge markup is `badgeMarkup` (line 214). Seen is written to `chatSeen` and also to `localStorage` key `hwChatSeen:` (`SEEN_KEY`, line 11).

## Errors the page shows

From `app/features/chat-ui.js`:

- Snapshot failure stores `err.code` or `permission-denied` (line 186).
- Send: `You can't post in this chat` when the code matches permission-denied or unauthorized; otherwise `Not sent: {code}` (line 358).
- Delete: `Not deleted: {code}` (line 315).
- Attach: `Couldn't attach that photo` (line 293). Planner refusals include `mime-not-allowed`, `too-large`, `empty-file`, `not-allowed`, `bad-thread` (`planChatPhoto`).

Messages are not editable. There is no customer-facing chat user in this UI. A profile with `customerIds` only narrows which jobs that staff member can open.

Provenance: `app/features/chat.js`, `app/features/chat-ui.js`, `app/app.js` call sites, `cloud/emulator/firestore.rules` chat block and `cloud/production/firestore.chat.rules`, `cloud/production/storage.rules` chat matches, commit `01f2c5a6f407e123f7f48432f07f1e9445a36007`.
