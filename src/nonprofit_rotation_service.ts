import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { InfraiControlClient, InfraiError } from "./infrai_control_client.js";
import { nonprofitWorkloads, rotateNonprofitKey } from "./rotation_decision.js";

const rotationBody = z.object({
  grace_hours: z.number().int().min(1).max(168),
  old_key_marker: z.string().min(4).max(128),
  observed_deployments: z.array(z.object({
    workload: z.enum(nonprofitWorkloads),
    deployment: z.string().min(1).max(120),
  })).min(3),
}).strict();

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body, null, 2));
}

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

const infrai = new InfraiControlClient(apiKey);
const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/rotation-drills") {
    send(response, 404, { error: "Route not found" });
    return;
  }

  try {
    const input = rotationBody.parse(await readJson(request));
    const result = await rotateNonprofitKey(infrai, input, randomUUID());
    send(response, result.decision === "old-key-revoked" ? 200 : 202, result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      send(response, 400, { error: "Invalid rotation request", issues: error.issues });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      send(response, status, { error: error.code, details: error.details });
      return;
    }
    send(response, 502, { error: error instanceof Error ? error.message : "Rotation request failed" });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Nonprofit rotation service listening on http://localhost:${port}`));
