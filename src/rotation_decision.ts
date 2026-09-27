import type { CreatedKey, InfraiControlClient, LogSearch, RotatedKey } from "./infrai_control_client.js";

export const nonprofitWorkloads = [
  "donor-receipts",
  "volunteer-reminders",
  "campaign-reporting",
] as const;

export type RotationRequest = {
  grace_hours: number;
  old_key_marker: string;
  observed_deployments: Array<{
    workload: (typeof nonprofitWorkloads)[number];
    deployment: string;
  }>;
};

export type RotationResult = {
  decision: "wait-for-deployments" | "old-key-revoked";
  pending: RotationRequest["observed_deployments"];
  temporary_key_id: string;
  replacement_key: string;
  reminder: string;
};

type RotationClient = Pick<
  InfraiControlClient,
  "createTemporaryKey" | "rotateTemporaryKey" | "searchDeploymentLogs" | "revokeTemporaryKey"
>;

function logRows(search: LogSearch): unknown[] {
  return search.results ?? search.events ?? search.logs ?? search.items ?? [];
}

export function deploymentsStillUsingOldKey(
  search: LogSearch,
  deployments: RotationRequest["observed_deployments"],
): RotationRequest["observed_deployments"] {
  const searchable = JSON.stringify(logRows(search)).toLowerCase();
  return deployments.filter(({ workload, deployment }) =>
    searchable.includes(workload.toLowerCase()) || searchable.includes(deployment.toLowerCase()),
  );
}

export async function rotateNonprofitKey(
  client: RotationClient,
  input: RotationRequest,
  requestId: string,
): Promise<RotationResult> {
  const created: CreatedKey = await client.createTemporaryKey(`${requestId}:create`);
  const rotated: RotatedKey = await client.rotateTemporaryKey(
    created.key_id,
    input.grace_hours,
    `${requestId}:rotate`,
  );
  const search = await client.searchDeploymentLogs(input.old_key_marker);
  const pending = deploymentsStillUsingOldKey(search, input.observed_deployments);

  if (pending.length === 0) {
    await client.revokeTemporaryKey(created.key_id);
  }

  return {
    decision: pending.length === 0 ? "old-key-revoked" : "wait-for-deployments",
    pending,
    temporary_key_id: created.key_id,
    replacement_key: rotated.key,
    reminder: "Store the replacement key now; its plaintext cannot be retrieved a second time.",
  };
}
