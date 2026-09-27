import assert from "node:assert/strict";
import test from "node:test";
import { rotateNonprofitKey, type RotationRequest } from "../src/rotation_decision.js";

const input: RotationRequest = {
  grace_hours: 24,
  old_key_marker: "legacy-key-7f2a",
  observed_deployments: [
    { workload: "donor-receipts", deployment: "receipts-us" },
    { workload: "volunteer-reminders", deployment: "reminders-worker" },
    { workload: "campaign-reporting", deployment: "reports-nightly" },
  ],
};

test("keeps the overlap open when donor receipts still use the old value", async () => {
  let revoked = false;
  const client = {
    createTemporaryKey: async () => ({ key_id: "key_temp", key: "one-time-created-value" }),
    rotateTemporaryKey: async () => ({ key_id: "key_temp", key: "one-time-replacement-value" }),
    searchDeploymentLogs: async () => ({ events: [{ service: "donor-receipts", deployment: "receipts-us" }] }),
    revokeTemporaryKey: async () => { revoked = true; },
  };

  const result = await rotateNonprofitKey(client, input, "request-1");

  assert.equal(result.decision, "wait-for-deployments");
  assert.deepEqual(result.pending, [input.observed_deployments[0]]);
  assert.equal(revoked, false);
});

test("revokes the temporary old key after all three workloads have moved", async () => {
  const calls: string[] = [];
  const client = {
    createTemporaryKey: async (idempotencyKey: string) => {
      calls.push(idempotencyKey);
      return { key_id: "key_temp", key: "one-time-created-value" };
    },
    rotateTemporaryKey: async (_keyId: string, _hours: number, idempotencyKey: string) => {
      calls.push(idempotencyKey);
      return { key_id: "key_temp", key: "one-time-replacement-value" };
    },
    searchDeploymentLogs: async () => ({ events: [] }),
    revokeTemporaryKey: async (keyId: string) => { calls.push(`revoke:${keyId}`); },
  };

  const result = await rotateNonprofitKey(client, input, "request-2");

  assert.equal(result.decision, "old-key-revoked");
  assert.deepEqual(calls, ["request-2:create", "request-2:rotate", "revoke:key_temp"]);
});
