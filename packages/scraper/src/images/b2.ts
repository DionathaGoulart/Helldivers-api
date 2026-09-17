import { createHash } from "node:crypto";
import { AwsClient } from "aws4fetch";

// The private Backblaze B2 bucket through its S3 API (arch §6.5, ADR-006): path-style URLs,
// SigV4 with the write key. Keys are content hashed, so an object never changes once written.

export const IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const B2_RETRY_DELAYS_MS: readonly number[] = [1_000, 5_000, 15_000];

export interface ImageStore {
  exists(key: string): Promise<boolean>;
  put(key: string, body: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
}

export class B2Error extends Error {
  constructor(
    readonly method: string,
    readonly key: string,
    readonly status: number, // 0 for a network error
    detail = `HTTP ${status}`,
  ) {
    super(`B2 ${method} ${key} failed: ${detail}`);
    this.name = "B2Error";
  }
}

export function regionFromEndpoint(endpoint: string): string {
  const match = /^s3\.([a-z0-9-]+)\.backblazeb2\.com$/.exec(new URL(endpoint).hostname);
  if (!match?.[1]) {
    throw new Error(`cannot read the B2 region from ${endpoint}`);
  }
  return match[1];
}

export interface B2StoreOptions {
  endpoint: string; // https://s3.<region>.backblazeb2.com
  bucket: string; // case-sensitive
  keyId: string;
  appKey: string;
  fetch?: (request: Request) => Promise<Response>;
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

const isRetryable = (status: number) => status === 429 || status >= 500;

export class B2Store implements ImageStore {
  readonly #client: AwsClient;
  readonly #bucketUrl: string;
  readonly #fetch: (request: Request) => Promise<Response>;
  readonly #delays: readonly number[];
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(options: B2StoreOptions) {
    this.#client = new AwsClient({
      accessKeyId: options.keyId,
      secretAccessKey: options.appKey,
      service: "s3",
      region: regionFromEndpoint(options.endpoint),
    });
    this.#bucketUrl = `${options.endpoint.replace(/\/+$/, "")}/${encodeURIComponent(options.bucket)}`;
    this.#fetch = options.fetch ?? ((request) => fetch(request));
    this.#delays = options.retryDelaysMs ?? B2_RETRY_DELAYS_MS;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** A key without read access gets 403 for every HEAD; the PUT that follows then decides. */
  async exists(key: string): Promise<boolean> {
    const response = await this.#send("HEAD", key, [200, 403, 404]);
    return response.status === 200;
  }

  async put(key: string, body: Uint8Array): Promise<void> {
    await this.#send("PUT", key, [200], {
      body,
      headers: {
        "content-type": "image/webp",
        "cache-control": IMAGE_CACHE_CONTROL,
        // B2 checks the payload against this hash.
        "x-amz-content-sha256": createHash("sha256").update(body).digest("hex"),
      },
    });
  }

  async delete(key: string): Promise<void> {
    await this.#send("DELETE", key, [200, 204, 404]);
  }

  /** Signs every attempt anew; retries network errors, 5xx and 429. */
  async #send(
    method: string,
    key: string,
    expected: readonly number[],
    init: { body?: Uint8Array; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    const url = `${this.#bucketUrl}/${key}`;
    for (let attempt = 0; ; attempt += 1) {
      const retryDelay = this.#delays[attempt];
      let response: Response;
      try {
        const request = await this.#client.sign(url, { method, ...init });
        response = await this.#fetch(request);
      } catch (error) {
        if (retryDelay === undefined) {
          throw new B2Error(method, key, 0, error instanceof Error ? error.message : String(error));
        }
        await this.#sleep(retryDelay);
        continue;
      }
      await response.body?.cancel();
      if (expected.includes(response.status)) {
        return response;
      }
      if (isRetryable(response.status) && retryDelay !== undefined) {
        await this.#sleep(retryDelay);
        continue;
      }
      throw new B2Error(method, key, response.status);
    }
  }
}
