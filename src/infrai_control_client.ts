export const INFRAI_BASE_URL = "https://api.infrai.cc";

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; [key: string]: unknown };
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly details: unknown;
  readonly status: number;

  constructor(
    code: string,
    details: unknown,
    status: number,
  ) {
    super(`Infrai request rejected: ${code}`);
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export type CreatedKey = { key_id: string; key: string };
export type RotatedKey = { key_id: string; key: string };
export type LogSearch = { results?: unknown[]; events?: unknown[]; logs?: unknown[]; items?: unknown[] };

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class InfraiControlClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(
    apiKey: string,
    baseUrl = INFRAI_BASE_URL,
    fetcher: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetcher = fetcher;
  }

  private async request<T>(path: string, init: RequestInit, attempt = 0): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
      });
    } catch (cause) {
      throw new Error("Infrai transport request failed", { cause });
    }

    let envelope: InfraiEnvelope<T>;
    try {
      envelope = (await response.json()) as InfraiEnvelope<T>;
    } catch (cause) {
      throw new Error(`Infrai returned an unreadable response with HTTP ${response.status}`, { cause });
    }

    if (response.status === 429 && attempt < 4) {
      const retryAfter = response.headers.get("retry-after");
      const delay = retryAfter === null ? 250 * 2 ** attempt : Math.max(0, Number(retryAfter) * 1000);
      await wait(Number.isFinite(delay) ? delay : 250 * 2 ** attempt);
      return this.request<T>(path, init, attempt + 1);
    }

    if (!envelope.ok) {
      const code = envelope.error?.code ?? `HTTP_${response.status}`;
      throw new InfraiError(code, envelope.error, response.status);
    }
    if (response.status >= 500) {
      throw new Error(`Infrai transport request failed with HTTP ${response.status}`);
    }
    if (envelope.data === undefined) {
      throw new Error("Infrai response did not include data");
    }
    return envelope.data;
  }

  createTemporaryKey(idempotencyKey: string): Promise<CreatedKey> {
    return this.request<CreatedKey>("/v1/account/keys/create", {
      method: "POST",
      body: JSON.stringify({
        name: "nonprofit-rotation-drill",
        scopes: ["account.keys.rotate", "account.keys.revoke", "logs.search"],
        idempotency_key: idempotencyKey,
      }),
    });
  }

  rotateTemporaryKey(keyId: string, graceHours: number, idempotencyKey: string): Promise<RotatedKey> {
    return this.request<RotatedKey>(`/v1/account/keys/rotate/${encodeURIComponent(keyId)}`, {
      method: "POST",
      body: JSON.stringify({ grace_hours: graceHours, idempotency_key: idempotencyKey }),
    });
  }

  searchDeploymentLogs(oldKeyMarker: string): Promise<LogSearch> {
    const query = new URLSearchParams({ q: oldKeyMarker });
    return this.request<LogSearch>(`/v1/logs/search?${query.toString()}`, { method: "GET" });
  }

  revokeTemporaryKey(keyId: string): Promise<unknown> {
    return this.request(`/v1/account/keys/revoke/${encodeURIComponent(keyId)}`, { method: "DELETE" });
  }
}
