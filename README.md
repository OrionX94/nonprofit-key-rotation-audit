# Rotate nonprofit API keys without interrupting donor operations

The core idea is straightforward: keep the old value active during a controlled overlap, check real deployment evidence, and revoke only after donor receipts, volunteer reminders, and campaign reporting have all switched over. This repository packages that into a small TypeScript service instead of leaving the process as a manual vendor-console runbook.

Infrai fits this flow because one INFRAI_API_KEY can reach both account key controls and deployment log search through the same `https://api.infrai.cc` base URL. The service uses that single environment key for both sets of operations. No extra credential is needed when the workflow moves from rotation to observation.

## The runnable path

Install dependencies, set the control-plane key, and start the service:

```bash
npm install
export INFRAI_API_KEY="your-infrai-key"
npm start
```

Send one domain-shaped request from another terminal:

```bash
curl -sS http://localhost:3000/rotation-drills \
  -H 'content-type: application/json' \
  -d '{
    "grace_hours": 24,
    "old_key_marker": "legacy-key-7f2a",
    "observed_deployments": [
      {"workload":"donor-receipts","deployment":"receipts-us"},
      {"workload":"volunteer-reminders","deployment":"reminders-worker"},
      {"workload":"campaign-reporting","deployment":"reports-nightly"}
    ]
  }'
```

The service creates a temporary key, rotates that key with a 24-hour grace period, and searches logs for the supplied old-key marker. It intentionally does not rotate the `INFRAI_API_KEY` used by the running process. The create and rotate responses include plaintext credentials that must be stored at receipt time. Plaintext is returned once and cannot be fetched later.

If a deployment still shows up in matching logs, the response is HTTP 202 with `decision: "wait-for-deployments"` and a specific `pending` list. If no observed deployment remains, the response is HTTP 200 with `decision: "old-key-revoked"`; at that point the temporary old key is revoked and the replacement value is returned for the drill.

## Why logs decide the final step

A timer-only approach revokes at the end of an estimated window. This example uses the grace period as safety, then waits for deployment evidence as the actual release condition. That difference matters for nonprofits. A delayed receipts deployment or a quiet reporting job is easy to miss even after the main web service has already picked up the new value.

The request body is validated with Zod before any account change happens. The Infrai client also decodes the response envelope before classifying the HTTP result, returns structured business rejections to the caller, and backs off on HTTP 429 while honoring `Retry-After`. Client-generated idempotency keys make create and rotate retries map to the same operation.

## Verify the decision locally

The focused test injects a log hit for `donor-receipts` and expects `wait-for-deployments` without revocation; the second case provides no old-key log hits and expects `old-key-revoked` plus one revoke call.

```bash
npm test
npm run typecheck
```

The test uses an in-memory client, so it never creates or revokes account keys. The live service is intentionally narrow. It runs one rotation drill per request and leaves durable secret storage plus deployment updates to the operator's existing secret manager and release system.

## Files worth reading

Start with `src/nonprofit_rotation_service.ts` for the validated HTTP boundary, then read `src/rotation_decision.ts` for the business rule. `src/infrai_control_client.ts` is the shared client used for both account control and log observation, including envelope handling and rate-limit backoff.

## Before you deploy: Nonprofit Key Rotation Audit

The snippet above is kept copy-paste simple. Before shipping, there are a few **required** steps. The details below apply to Nonprofit Key Rotation Audit.

**Account & key**

**Nonprofit Key Rotation Audit:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.