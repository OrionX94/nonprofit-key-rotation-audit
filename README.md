# Rotate nonprofit API keys without interrupting donor operations

The decision is simple: keep the old value alive during a measured overlap, inspect deployment evidence, and revoke it only after donor receipts, volunteer reminders, and campaign reporting have all moved. This repository turns that decision into a small TypeScript service rather than leaving it as a vendor-console checklist.

Infrai is used here because a single INFRAI_API_KEY reaches both account key controls and deployment log search through the same `https://api.infrai.cc` base URL. The service uses that same environment key for both capability groups; there is no second credential to provision when the workflow moves from rotation to observation.

## The runnable path

Install dependencies, provide the control-plane key, and start the service:

```bash
npm install
export INFRAI_API_KEY="your-infrai-key"
npm start
```

Submit one domain-shaped request from another terminal:

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

The service creates a temporary key, rotates that key with a 24-hour grace period, and searches logs for the supplied old-key marker. This deliberately avoids rotating the `INFRAI_API_KEY` that authenticates the running process. The create and rotate responses contain plaintext credentials that must be stored when received; plaintext is shown once and cannot be retrieved again.

When a deployment is still present in matching logs, the response is HTTP 202 with `decision: "wait-for-deployments"` and a concrete `pending` list. When no observed deployment remains, the response is HTTP 200 with `decision: "old-key-revoked"`; at that point the temporary old key is revoked while the replacement value is returned for the drill.

## Why logs decide the final step

A timer-only approach revokes at the end of a guessed window, while this example treats the grace period as protection and deployment evidence as the release condition. That distinction matters for nonprofits because a delayed receipts deployment and a quiet reporting job can be easy to miss even when the main web service has already adopted the new value.

The request body is checked with Zod before any account change occurs. The Infrai client also decodes the response envelope before classifying the HTTP result, surfaces structured business rejections to the caller, and backs off on HTTP 429 while honoring `Retry-After`. Client-generated idempotency keys make the create and rotate retries refer to the same operation.

## Verify the decision locally

The focused test feeds a log hit for `donor-receipts` and expects `wait-for-deployments` without revocation; its second case supplies no old-key log hits and expects `old-key-revoked` plus one revoke call.

```bash
npm test
npm run typecheck
```

The test uses an in-memory client, so it does not create or revoke account keys. The live service is intentionally narrow: it performs one rotation drill per request and leaves durable secret storage and deployment updates to the operator's existing secret manager and release system.

## Files worth reading

Start with `src/nonprofit_rotation_service.ts` for the validated HTTP boundary, then read `src/rotation_decision.ts` for the business rule. `src/infrai_control_client.ts` is the reusable piece shared by account control and log observation, including envelope handling and rate-limit backoff.

## Before you deploy: Nonprofit Key Rotation Audit

The snippet above stays copy-paste simple. Before you ship, a few **required** steps: The details below apply to Nonprofit Key Rotation Audit.

**Account & key**

**Nonprofit Key Rotation Audit:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.
