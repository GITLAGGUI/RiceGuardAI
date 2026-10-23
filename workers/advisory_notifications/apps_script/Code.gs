// Fixed-recipient, event-only notification relay. Never log requests or secrets.
var RELAY_VERSION_ = 'riceguard.advisory.notice.v1';
var RELAY_PURPOSE_ = 'advisory_ready';
var RELAY_DOMAIN_ = 'riceguard.apps-script.notice-relay.v1';
var RELAY_UUID_ = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
var RELAY_MAX_BYTES_ = 2048;
var RELAY_RECEIPT_LIMIT_ = 128;
var RELAY_RETENTION_SECONDS_ = 30 * 86400;

function doPost(e) {
  try {
    return relayPost_(e);
  } catch (_) {
    return relayReply_({ok: false, error: 'relay_unavailable'});
  }
}

function relayPost_(e) {
  // JSON is deliberately ASCII and canonical: byte and character sizes coincide.
  // Reject duplicate JSON keys and alternate encodings by canonical comparison.
  if (!e || e.queryString || e.pathInfo || !e.postData ||
      !Number.isSafeInteger(e.contentLength) || e.contentLength < 1 || e.contentLength > RELAY_MAX_BYTES_ ||
      e.postData.length !== e.contentLength || typeof e.postData.contents !== 'string' ||
      e.postData.contents.length !== e.contentLength ||
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(e.postData.type || '') ||
      !/^[\x20-\x7e]+$/.test(e.postData.contents)) {
    return relayReply_({ok: false, error: 'invalid_request'});
  }
  var input;
  try { input = JSON.parse(e.postData.contents); }
  catch (_) { return relayReply_({ok: false, error: 'invalid_request'}); }
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).length !== 5 || input.version !== RELAY_VERSION_ || input.purpose !== RELAY_PURPOSE_ ||
      typeof input.event_id !== 'string' || !RELAY_UUID_.test(input.event_id) ||
      !Number.isSafeInteger(input.issued_at) || input.issued_at < 0 ||
      typeof input.signature !== 'string' || !/^[0-9a-f]{64}$/.test(input.signature)) {
    return relayReply_({ok: false, error: 'invalid_request'});
  }
  var canonical = {version: input.version, purpose: input.purpose, event_id: input.event_id,
    issued_at: input.issued_at, signature: input.signature};
  if (JSON.stringify(canonical) !== e.postData.contents) {
    return relayReply_({ok: false, error: 'invalid_request'});
  }
  var now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - input.issued_at) > 300) {
    return relayReply_({ok: false, error: 'expired_request'});
  }
  var properties = PropertiesService.getScriptProperties();
  var secret = properties.getProperty('RELAY_HMAC_SECRET');
  var recipient = properties.getProperty('RELAY_RECIPIENT');
  if (recipient !== 'jlaggui47@gmail.com' || typeof secret !== 'string' || !/^[0-9a-f]{64}$/.test(secret)) {
    return relayReply_({ok: false, error: 'configuration_unavailable'});
  }
  // Secret is UTF-8 text, not hex-decoded bytes. Five lines, no trailing LF.
  var signing = [RELAY_DOMAIN_, RELAY_VERSION_, RELAY_PURPOSE_, String(input.issued_at), input.event_id].join('\n');
  var signature = Utilities.computeHmacSha256Signature(signing, secret, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
  if (!relayConstantTimeEqual_(signature, input.signature)) {
    return relayReply_({ok: false, error: 'authentication_failed'});
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return relayReply_({ok: false, error: 'busy'});
  try {
    // A request that waited for a lock must still be fresh before any send.
    now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - input.issued_at) > 300) return relayReply_({ok: false, error: 'expired_request'});
    var receipts = relayReceipts_(properties.getProperty('RELAY_SENT_EVENTS'), now);
    if (receipts === null) return relayReply_({ok: false, error: 'receipt_store_unavailable'});
    var receipt = 'apps-script:' + input.event_id;
    if (Object.prototype.hasOwnProperty.call(receipts, input.event_id)) {
      if (receipts[input.event_id][1] !== 'a') {
        return relayReply_({ok: false, error: 'manual_reconciliation'});
      }
      return relayReply_({ok: true, event_id: input.event_id, status: 'duplicate', provider_receipt: receipt});
    }
    if (Object.keys(receipts).length >= RELAY_RECEIPT_LIMIT_) {
      return relayReply_({ok: false, error: 'receipt_capacity'});
    }
    var quota = MailApp.getRemainingDailyQuota();
    if (!Number.isSafeInteger(quota) || quota < 1) return relayReply_({ok: false, error: 'quota_unavailable'});
    // Durable intent precedes the irreversible mail call. A crash or ambiguous
    // transport exception then blocks retries rather than risking another send.
    receipts[input.event_id] = [now, 'p'];
    try { properties.setProperty('RELAY_SENT_EVENTS', JSON.stringify(receipts)); }
    catch (_) { return relayReply_({ok: false, error: 'receipt_store_unavailable'}); }
    try {
      MailApp.sendEmail(recipient, 'RiceGuardAI advisory event ready',
        'RiceGuardAI advisory review is ready.\n\nEvent ID: ' + input.event_id +
        '\n\nUse the authorized RiceGuardAI connector to resolve this event.');
    } catch (_) {
      receipts[input.event_id] = [now, 'u'];
      try { properties.setProperty('RELAY_SENT_EVENTS', JSON.stringify(receipts)); } catch (_) { /* Durable pending remains. */ }
      return relayReply_({ok: false, error: 'manual_reconciliation'});
    }
    // Accepted is local MailApp acceptance, not inbox delivery.
    receipts[input.event_id] = [now, 'a'];
    try { properties.setProperty('RELAY_SENT_EVENTS', JSON.stringify(receipts)); }
    catch (_) { return relayReply_({ok: false, error: 'manual_reconciliation'}); }
    return relayReply_({ok: true, event_id: input.event_id, status: 'sent', provider_receipt: receipt});
  } finally {
    lock.releaseLock();
  }
}

function relayConstantTimeEqual_(a, b) {
  // Both signatures have already been restricted to exactly 64 hex characters.
  var difference = 0;
  for (var i = 0; i < 64; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

function relayReceipts_(raw, now) {
  var stored;
  if (raw === null) return Object.create(null);
  if (typeof raw !== 'string' || raw.length > 8192) return null;
  try { stored = JSON.parse(raw); } catch (_) { return null; }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null;
  var keys = Object.keys(stored), current = Object.create(null);
  if (keys.length > RELAY_RECEIPT_LIMIT_) return null;
  for (var i = 0; i < keys.length; i++) {
    var eventId = keys[i], record = stored[eventId];
    if (!RELAY_UUID_.test(eventId) || !Array.isArray(record) || record.length !== 2 ||
        !Number.isSafeInteger(record[0]) || record[0] < 0 || record[0] > now + 300 ||
        ['p', 'a', 'u'].indexOf(record[1]) === -1) return null;
    // Uncertain/pending attempts require explicit reconciliation, however old.
    if (record[1] !== 'a' || record[0] >= now - RELAY_RETENTION_SECONDS_) current[eventId] = record;
  }
  return current;
}

function relayReply_(result) {
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
