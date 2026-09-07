# Phase 2: Contracts, E-Signature, and PDF Generation — Design

**Status:** Draft, pending Daniel's review
**Date:** 09-07-2026
**Depends on:** Phase 1 (foundation), Phase 6 (materials receipts) — both merged to `phase1-foundation`
**Explicitly out of scope:** Payments/Stripe (Phase 3), crew scheduling (Phase 4), deploying to Cloudflare Pages / Cloud Functions production, choosing a final domain for signing links

## 1. Overview

Today, a job's pipeline stage can be manually advanced through `CONTRACT_SENT` and `CONTRACT_SIGNED` via a plain dropdown — there is no actual contract behind either label. This phase makes those two stages real: staff can send a customer a real contract, the customer can read and sign it with no login required, and both staff and the customer end up with a real signed PDF.

This is the first phase where:
- A customer (not staff/crew) interacts with the app directly.
- The app runs any server-side code (Cloud Functions).
- The app depends on a third-party service outside Firebase (Resend, for email).

## 2. Non-goals for this phase

- No payment collection. Deposit/final invoice amounts are tracked as plain numbers for now; Stripe integration is Phase 3.
- No production deployment. Everything is built and verified against local Firebase emulators (Firestore, Auth, Storage, Functions) plus one real Resend account for genuine email delivery checks. Cloudflare Pages + Functions production deploy happens as its own later step, whenever Daniel/Grayson are ready to go live.
- No legal review of the contract's actual wording. The template text in Section 6 is a reasonable placeholder draft, not attorney-reviewed language. Grayson (and ideally a real attorney) must review and revise it before it is used with a real customer. The app must make the template easy to edit later — it does not need to get the wording "right" now.
- No editing of an already-sent contract's terms. If staff made a mistake (wrong bid amount, wrong scope), the fix is to build a "void and resend" action later if that turns out to be needed — not in this phase.

## 3. Security architecture

The customer has no Firebase Auth session at any point — the unguessable token in their emailed link **is** their access, full stop. To keep this safe without inventing a new, fragile Firestore-rules pattern for anonymous access, **all customer-facing reads and writes go through Cloud Functions**, which use the Admin SDK (bypasses security rules entirely) and manually validate the token in code. The customer's browser never talks to Firestore or Cloud Storage directly.

This was chosen over two alternatives:
- **Anonymous Firebase Auth + custom claims** — rejected. Minting scoped custom claims for an anonymous user still requires a Cloud Function, so it doesn't avoid the new infrastructure; it only adds Auth complexity on top for no benefit.
- **Token-as-document-ID with narrow public Firestore/Storage rules** — rejected. Even if reads could be made to work this way, sending email fundamentally requires server-side code (a Resend API key can never ship in a public browser bundle), so this approach would still need at least one Cloud Function — resulting in two different security models (rules for data, functions for email) instead of one. This app has already had two real security-rules bugs caught in prior review; one consistent, auditable model is safer than two overlapping ones.

Because of this, `jobs/{jobId}/contract/details` stays exactly as locked-down as `receipts` already is (`allow read, write: if isStaff()`), and the new `documentLinks/{token}` lookup collection is never touched by any client SDK at all (`allow read, write: if false` — only Cloud Functions' Admin SDK access bypasses this).

**Never persist a permanent download URL.** `known-issues.md` already flags that `getDownloadURL()` returns a permanent, unauthenticated capability URL for receipts and activity photos. This phase does it right from the start: `signatureImageUrl` and `pdfUrl` on the contract doc store the Storage **path**, not a download URL. A fresh, short-lived signed URL is minted on demand (by a Cloud Function) every time a PDF actually needs to be viewed or downloaded, and the customer's own signed copy is delivered as a direct **email attachment**, so no persisted link is needed for that at all.

## 4. Data model

### `jobs/{jobId}/contract/details` (single doc, staff-only)

| Field | Type | Notes |
|---|---|---|
| `status` | string | `"SENT"` or `"SIGNED"` |
| `bidAmount` | number | Contract price, entered by staff when sending |
| `scopeOfWork` | string | Free text, entered by staff when sending |
| `depositPercent` | number | Defaults to 30, editable by staff at send time |
| `contractText` | string | The fully filled-in template, frozen at send time — later template edits never retroactively change a sent/signed contract |
| `token` | string | The random token used in the customer's link (also the `documentLinks` doc ID) |
| `sentAt` | timestamp | Set when `sendContract` runs |
| `signedAt` | timestamp \| null | Set when `submitSignature` runs |
| `signerName` | string \| null | Typed by the customer at signing |
| `signatureImagePath` | string \| null | Storage path (not URL) to the signature PNG |
| `pdfPath` | string \| null | Storage path (not URL) to the final signed PDF |
| `signerIp` | string \| null | Best-effort, from request headers — supplementary audit info, not cryptographic proof |
| `signerUserAgent` | string \| null | Best-effort, from request headers |

Firestore rule: `allow read, write: if isStaff();` (matches `receipts`).

### `documentLinks/{token}` (lookup table, no client access at all)

| Field | Type | Notes |
|---|---|---|
| `jobId` | string | |
| `kind` | string | `"contract"` (only kind that exists yet — payments will add more in Phase 3) |
| `createdAt` | timestamp | |

Firestore rule: `allow read, write: if false;` — only Cloud Functions' Admin SDK access (which bypasses rules) ever touches this collection.

### Storage layout

- `jobs/{jobId}/contract/signature.png`
- `jobs/{jobId}/contract/signed.pdf`

Storage rules: staff-only read (`isStaff()`), no client write at all (only Cloud Functions' Admin SDK writes these paths) — matches the "no direct client access" principle above.

## 5. Cloud Functions

All functions live in a new `functions/` directory (Node.js, Firebase Cloud Functions v2). Bid amount is entered here, not earlier in the pipeline — the app has never captured a numeric bid amount before this phase, and adding it retroactively to the "Bid Given" stage is out of scope; it belongs to whichever future phase actually designs that stage's data entry.

1. **`sendContract`** (callable, staff-authenticated)
   - Input: `{ jobId, bidAmount, scopeOfWork, depositPercent }`
   - Validates: caller's `users/{uid}` role is `staff`; job exists and `status === "WON"`.
   - Fills the contract template (Section 6) with job + input data → `contractText`.
   - Generates a random token (32+ bytes), creates `documentLinks/{token}` and `jobs/{jobId}/contract/details` (`status: "SENT"`).
   - Advances the job: `WON` → `CONTRACT_SENT`.
   - Emails the customer (`job.email`) a link to the signing page via Resend.

2. **`getContractByToken`** (public HTTPS, no auth)
   - Input: `{ token }`
   - Looks up `documentLinks/{token}` → `jobId` → reads `jobs/{jobId}/contract/details` plus minimal job fields needed for display (`customerName`, `address`).
   - If `status === "SIGNED"`: returns signed state + a freshly minted short-lived download URL for the PDF.
   - If `status === "SENT"`: returns `contractText` for the customer to read and sign.
   - Unknown/invalid token: a plain "this link isn't valid" response — no information disclosure about whether a token ever existed.

3. **`submitSignature`** (public HTTPS, no auth)
   - Input: `{ token, signerName, signatureDataUrl }`
   - Re-validates the token; rejects if the contract is already `"SIGNED"` (no re-signing).
   - Uploads the signature PNG to Storage.
   - Generates the final signed PDF (`pdfmake`) embedding `contractText` + signature image + signer name/date/IP audit stamp, uploads to Storage.
   - Updates the contract doc: `status: "SIGNED"`, `signedAt`, `signerName`, `signatureImagePath`, `pdfPath`, `signerIp`, `signerUserAgent`.
   - Advances the job: `CONTRACT_SENT` → `CONTRACT_SIGNED`.
   - Emails the customer their signed PDF as a direct attachment.

4. **`resendContractLink`** (callable, staff-authenticated)
   - Re-sends the original signing-link email for a contract still in `"SENT"` status (same token — tokens don't expire, so no new one is generated).

5. **`resendContractPdf`** (callable, staff-authenticated)
   - Available once `"SIGNED"`. Re-fetches the PDF from Storage server-side and re-emails it as an attachment.

6. **`getContractPdfUrl`** (callable, staff-authenticated)
   - Available once `"SIGNED"`. Mints and returns a fresh short-lived signed URL for the PDF at `pdfPath`, backing the "View/Download PDF" button on Job Detail (Section 7). Never persisted — a new URL is minted on every call.

`pdfmake` is the chosen PDF library (over `pdf-lib`) — its declarative, section-based content model fits a multi-paragraph contract far better than `pdf-lib`'s lower-level coordinate-based drawing.

## 6. Contract template (placeholder — needs Grayson/attorney review before real use)

```
RESIDENTIAL DECK CONSTRUCTION AGREEMENT

This Agreement is made between Decked Out WNC Inc. ("Contractor") and
{{customerName}} ("Owner"), for the property located at {{address}}.

1. SCOPE OF WORK
{{scopeOfWork}}

2. CONTRACT PRICE
The total price for the work described above is {{bidAmount, formatted as currency}}.

3. PAYMENT SCHEDULE
A deposit of {{depositPercent}}% ({{depositAmount, formatted as currency}}) is due
upon signing this Agreement, before materials are ordered. The remaining balance
is due upon substantial completion of the work.

4. CHANGE ORDERS
Any change to the scope of work described above must be agreed to in writing by
both parties and may adjust the contract price and/or timeline accordingly.

5. TIMELINE
Contractor will provide an estimated start date and completion timeframe once
scheduling is confirmed. Actual timeline may be affected by weather, permitting,
and material availability.

6. PERMITS
Contractor is responsible for obtaining any building permits required for this
project.

7. WARRANTY
Contractor warrants its workmanship for a period of one (1) year from the date
of substantial completion. Manufacturer warranties on materials, where
applicable, are passed through to Owner.

8. INSURANCE
Contractor carries general liability insurance and will provide proof of
coverage upon request.

9. TERMINATION
Either party may terminate this Agreement for material breach upon written
notice. Owner remains responsible for payment for work completed and materials
already ordered as of the date of termination.

10. GOVERNING LAW
This Agreement is governed by the laws of the State of North Carolina.

11. ENTIRE AGREEMENT
This document constitutes the entire agreement between the parties and
supersedes all prior discussions regarding this project.

Accepted and agreed:

Owner: ____________________________  Date: ______________
       {{customerName}}

Contractor: Decked Out WNC Inc.       Date: {{sentDate}}
```

The customer's typed name + captured signature image + timestamp fill the "Owner" signature line at signing time. The Contractor line is pre-filled with the send date — only the customer signs interactively in this phase.

## 7. UI changes

**Job Detail page** — new staff-only "Contract" section (same placement pattern as Materials Receipts and Job Activity):
- Job is `WON` with no contract yet → "Send Contract" button opens a form: Bid Amount, Scope of Work, Deposit % (defaults 30).
- Contract `SENT` → "Sent to `{email}` on `{date}` — awaiting signature" + "Resend Signing Link" button.
- Contract `SIGNED` → "Signed by `{signerName}` on `{date}`" + "View/Download PDF" (mints a fresh short-lived URL on click) + "Resend Signed PDF" button.

**New standalone customer-facing page** (`sign.html`, no login, no app shell/sidebar/nav) — reads `?token=` from the URL:
- Unsigned: renders `contractText`, a signature pad (`signature_pad` library via CDN), a "Type your full name" field, and a "Sign & Submit" button.
- After signing: a confirmation state — "Thanks — your signed copy is on its way to your email."
- Already signed: "This contract was signed on `{date}`." + a download link.
- Invalid/unknown token: a plain "This link isn't valid" message.
- Same mountain-timber palette/typography as the rest of the app for brand consistency, but a simple single-column "read then sign" layout — no nav, no sidebar.

**Pipeline stage dropdown**: `WON → CONTRACT_SENT` and `CONTRACT_SENT → CONTRACT_SIGNED` are removed from the generic "Advance to…" list on the job card, since both are now driven only by the real actions above. `canTransition()`'s underlying state machine (`pipeline.js`) is unchanged — the UI simply stops offering those two specific options manually; the Cloud Functions call the same transition logic when they advance status.

## 8. Testing strategy

- **Unit tests**: contract-template-filling (pure function — given job/input data, produces `contractText`) gets plain `node:test` coverage, no emulator needed.
- **Functions emulator**: added to `firebase.json` alongside the existing Firestore/Auth/Storage emulators. Each Cloud Function gets integration tests against the emulator suite (role checks, token validation, "can't re-sign an already-signed contract," stage-advance side effects).
- **Rules tests**: extend the existing suite — staff can read/write `jobs/{jobId}/contract/details`, crew cannot (matches "crew cannot see financials/contract terms" from the original design), and `documentLinks` is unreachable by any client role (staff included).
- **Real email verification**: Daniel needs a free Resend account + API key before end-to-end verification. Automated tests mock the Resend call; one real manual send-and-receive check happens during final verification, using a real inbox Daniel controls.

## 9. Open items carried forward (not blocking this phase)

- Exact contract wording needs Grayson's (and ideally an attorney's) review before real customer use.
- Production deployment (Cloudflare Pages + Cloud Functions) is a separate future step.
- Node runtime version for Cloud Functions gets pinned during implementation planning, not here.
