// API keys (arch §8.6, ADR-008): `hd2_<id>_<signature>`, where the signature is the base64url
// HMAC-SHA256 of the id under the `API_KEY_SECRET` Worker secret. Verifying one is a single HMAC:
// no storage, no lookup. Revoking one is listing its id in `REVOKED_KEYS` and redeploying.

const KEY_PATTERN = /^hd2_([a-z0-9]{12})_([A-Za-z0-9_-]{43})$/;
const encoder = new TextEncoder();

type HmacKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

/** Imported once per secret and isolate: importKey costs more than the HMAC itself. */
const imported = new Map<string, Promise<HmacKey>>();

function hmacKey(secret: string): Promise<HmacKey> {
  let key = imported.get(secret);
  if (!key) {
    key = crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    imported.set(secret, key);
  }
  return key;
}

const toBase64Url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** A new random id: 12 characters of [a-z0-9]. */
export function newKeyId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) =>
    alphabet.charAt(byte % alphabet.length),
  ).join("");
}

export async function signKey(secret: string, id: string): Promise<string> {
  if (!/^[a-z0-9]{12}$/.test(id)) throw new Error(`key id must be 12 of [a-z0-9], got ${id}`);
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(id));
  return `hd2_${id}_${toBase64Url(signature)}`;
}

export type KeyCheck = { ok: true; id: string } | { ok: false; reason: string };

/** Constant-time check of the signature (`crypto.subtle.verify`), then of the revocation list. */
export async function verifyKey(
  secret: string,
  key: string,
  revoked: ReadonlySet<string>,
): Promise<KeyCheck> {
  const match = KEY_PATTERN.exec(key);
  if (!match?.[1] || !match[2]) return { ok: false, reason: "is not an hd2_ key" };
  const [, id, signature] = match;
  const bytes = fromBase64Url(signature);
  // 43 characters carry 258 bits for 256: only the canonical spelling of a signature is a key.
  if (toBase64Url(bytes.buffer) !== signature) return { ok: false, reason: "is not an hd2_ key" };
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    bytes,
    encoder.encode(id),
  );
  if (!valid) return { ok: false, reason: "has an invalid signature" };
  if (revoked.has(id)) return { ok: false, reason: "was revoked" };
  return { ok: true, id };
}

/** `REVOKED_KEYS` = comma-separated ids. */
export const parseRevoked = (value: string | undefined): ReadonlySet<string> =>
  new Set(
    (value ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
