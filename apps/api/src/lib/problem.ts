import { CORS_HEADERS } from "./cors.ts";

// RFC 9457 problem details (arch §8.3). Every `type` has an anchor on `/docs/errors` (Phase 6).

export const ERRORS_URL = "https://helldivers-api.pages.dev/docs/errors";

export const PROBLEM_TYPES = {
  "unknown-parameter": { status: 400, title: "Unknown parameter" },
  "invalid-filter-value": { status: 400, title: "Invalid filter value" },
  "invalid-parameter": { status: 400, title: "Invalid parameter" },
  "not-found": { status: 404, title: "Not found" },
  "method-not-allowed": { status: 405, title: "Method not allowed" },
  "internal-error": { status: 500, title: "Internal error" },
  "image-backend-error": { status: 502, title: "Image backend error" },
  "images-unavailable": { status: 503, title: "Images unavailable" },
} as const;

export type ProblemType = keyof typeof PROBLEM_TYPES;

export interface ProblemInit {
  type: ProblemType;
  detail: string;
}

/** Never cached: an error must not outlive the request that caused it. */
export function problemResponse(
  url: string,
  { type, detail }: ProblemInit,
  headers: Record<string, string> = {},
): Response {
  const { status, title } = PROBLEM_TYPES[type];
  const { pathname, search } = new URL(url);
  const body = {
    type: `${ERRORS_URL}#${type}`,
    title,
    status,
    detail,
    instance: pathname + search,
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/problem+json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...CORS_HEADERS,
      ...headers,
    },
  });
}
