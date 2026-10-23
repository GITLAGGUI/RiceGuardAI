# RiceGuardAI event relay deployment

23 October 2026, Asia/Manila

The owner approved a separate send-only Apps Script relay, its dedicated signing
key, and an Execute as Me / Anyone web deployment. Version 1 was deployed at
13:15. This is the relay only, not a production release of the visual pipeline.

- Project: RiceGuardAI Event Notice Relay.
- Script: `1YNtsP9dLMQ1xNIVfrJrE24kI9v1Z9t0sQT7vDU7NQWsIVDd91kEuurHH`.
- Deployment: `AKfycbxqnZNleixbw_4Pvxspc_QuaIi198U-2SSgOw84NkzSByiaFis3VmTtLVgYKveRayr3`.
- Explicit OAuth scope: `script.send_mail`; no mailbox-reading scope.
- Fixed recipient configured in Script Properties; dedicated key kept outside
  source/chat. No secret is included in this receipt.
- Live invalid-signature POST returned `ok:false, error:authentication_failed`.
  No valid signed send was used in that check, and no email was sent.
- Screenshot: `output/relay-deployed-v1.png`.

The owner authorized one real test email. At 13:19 Asia/Manila a signed request
for event `207b362b-5e9f-4a1e-99c5-667e4ff6110d` returned `status:sent` and receipt
`apps-script:207b362b-5e9f-4a1e-99c5-667e4ff6110d`. Gmail then returned message
`1a16732e3cdc00c8` with INBOX and SENT labels, matching subject/event, no attachments.
Its Delivered-To and text/plain body were read and matched the fixed recipient
and event-only notice. This verifies inbox arrival, not human reading.

This synthetic transport-test event is NOT a database ready event. A real
connector must reject it as unavailable. Do not insert fake evidence or rerun
this test with another event ID without authorization. No Gemini monitor was
configured for this test; no advisory was generated or saved from it.

Local relay tests previously passed 126 mocked checks. Actual Gemini Task
invocation, image inspection and advisory submission remain unverified. Mail
acceptance is not delivery or LLM image inspection; here delivery is established
separately by the Gmail message.

Backend migrations/worker release and the new dispatch-pin migration remain
separate release gates. Existing selected-survey consent does not authorize all
future surveys. Do not enable production notification flags until commissioned.
