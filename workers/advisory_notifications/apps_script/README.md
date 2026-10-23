# Private advisory notice relay (local source)

This standalone Apps Script receives authenticated event IDs and sends a fixed plain-text notice only to `jlaggui47@gmail.com`. It reads no mailbox, invokes no Gemini API, and receives no photos, coordinates, survey/job IDs, source paths, URLs, custom message text, or recipients. This folder does not create a Google project, deploy a web app, or send email by itself.

## Private setup

An authorized human can copy `Code.gs` and `appsscript.json` into a separate standalone Apps Script project. Keep access to project editors restricted: editors can access Script Properties. The sole explicit OAuth scope is `https://www.googleapis.com/auth/script.send_mail`.

In Project Settings, set `RELAY_RECIPIENT` to exactly `jlaggui47@gmail.com` and `RELAY_HMAC_SECRET` to a privately generated 32-byte random secret represented by 64 lowercase hexadecimal characters. Store the identical secret privately in the approved sender environment. The HMAC key is the UTF-8 text of those 64 characters, **not** the decoded 32 bytes. Never put a real key in source, examples, chat, logs, or test output. Do not manually initialize `RELAY_SENT_EVENTS`; the relay maintains it.

Deployment and sender integration are separate authorized steps. A sender must follow the Apps Script Content Service redirect and validate the JSON response; HTTP success alone is not a notice acknowledgement. Do not use query parameters, path suffixes, a form submission, or arbitrary headers as authentication.

## Exact request contract

POST `application/json` (optionally `; charset=utf-8`), with at most 2048 ASCII bytes. Serialize this object using `JSON.stringify` in exactly this property order, without whitespace, extra keys, or duplicate keys:

```js
{
  version: 'riceguard.advisory.notice.v1',
  purpose: 'advisory_ready',
  event_id: '11111111-0000-4000-8000-000000000001',
  issued_at: 1800000000, // Current integer Unix seconds; example only.
  signature: '<64 lowercase HMAC-SHA256 hexadecimal characters>'
}
```

`event_id` is a lowercase canonical UUID. `issued_at` must be within 300 seconds of the relay clock, including after acquiring the lock. Generate a fresh timestamp/signature for a transport retry while preserving the same event ID.

The signing string consists of these five UTF-8 lines joined by a single LF (`\n`), with **no trailing LF**:

```text
riceguard.apps-script.notice-relay.v1
riceguard.advisory.notice.v1
advisory_ready
<issued_at as decimal integer>
<event_id>
```

Compute `HMAC-SHA256(secret-as-UTF8-text, signing-string-as-UTF8)` and encode its 32 bytes as lowercase hex. The domain/version/purpose prevent treating a signature for another workflow as relay authorization. The relay compares all 64 signature characters without a data-dependent early return.

Success JSON is exactly `{ok:true,event_id,status:'sent'|'duplicate',provider_receipt:'apps-script:'+event_id}`. This receipt means that MailApp returned successfully and a local receipt was persisted, or that the persisted receipt already existed. It does not prove inbox delivery, receipt, or model inspection. Errors return `{ok:false,error:<fixed code>}` with no raw exception, request, or secret.

## Receipt and failure limits

A Script Lock covers receipt lookup, quota check, sending, and persistence. A competing request returns `busy`; it must retry later using the same event ID. Before calling MailApp the relay persists a pending attempt. A returned MailApp call advances it to accepted. A thrown/ambiguous call records uncertain when possible; even if that write fails, pending remains. A pending/uncertain event always returns `manual_reconciliation` and never automatically sends again. A quota failure happens before the pending write, sends nothing and can safely be retried.

The table holds at most 128 event IDs with compact `[timestamp,state]` records (`p` pending, `a` accepted, `u` uncertain), under 8192 characters. Accepted receipts persist across executions for 30 days; expired accepted entries are pruned on the next successful new send. Pending and uncertain attempts are never automatically pruned. At capacity the relay refuses to send (`receipt_capacity`), preserving every live receipt. Malformed receipt state or a failed intent write fails closed (`receipt_store_unavailable`). A failed MailApp call never creates an accepted/sent receipt.

This does **not** guarantee exactly-once email or delivery. A crash after the pending write can block an event even if no mail was sent. A lost transport acknowledgement or failed accepted-state write returns `manual_reconciliation`; a retry observes durable pending/uncertain and does not resend. An authorized human must inspect/reconcile the private event and mail state; do not simply delete a pending record to force another send. A lost HTTP response after successful accepted-state persistence is safely retried within retention. Reusing an accepted event ID after the 30-day retention period can send again; the sender must retain the event's notified state and avoid replaying historical events. Event identity and advisory-submission idempotency remain separate safeguards.

Error codes are `invalid_request`, `expired_request`, `configuration_unavailable`, `authentication_failed`, `busy`, `receipt_store_unavailable`, `receipt_capacity`, `quota_unavailable`, `manual_reconciliation`, and fallback `relay_unavailable`. Every failure response has only `ok:false` and `error`; no provider error or received payload is echoed.

## Local verification

From the repository root:

```text
node --test workers/advisory_notifications/apps_script/tests/relay.test.mjs
```

The Node VM mocks Utilities, PropertiesService, ScriptLock, ContentService and MailApp. It exercises HMAC compatibility, replay after a fresh execution, injection/extra-key rejection, time/body bounds, fixed recipient and text, quota, lock contention, failed sends, durable receipt limits/pruning, and persistence failure. It uses a synthetic key and makes no network or email calls. Actual Apps Script authorization, deployment, quotas and inbox delivery remain unverified locally.

Official references: [web app request fields](https://developers.google.com/apps-script/guides/web), [HMAC utilities](https://developers.google.com/apps-script/reference/utilities/utilities), [Script Lock](https://developers.google.com/apps-script/reference/lock/lock-service), [MailApp and send-only scope](https://developers.google.com/apps-script/reference/mail/mail-app), [Script Properties](https://developers.google.com/apps-script/guides/properties), and [service quotas](https://developers.google.com/apps-script/guides/services/quotas).
