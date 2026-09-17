// ETags of dynamic responses (arch §8.4): `W/"<dataVersion>-<fnv1a64(path + canonical query)>"`.

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;
const encoder = new TextEncoder();

/** 64-bit FNV-1a of the UTF-8 bytes, as 16 hex digits. */
export function fnv1a64(text: string): string {
  let hash = FNV_OFFSET;
  for (const byte of encoder.encode(text)) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, "0");
}

export function dynamicETag(dataVersion: string, canonicalUrl: string): string {
  return `W/"${dataVersion}-${fnv1a64(canonicalUrl)}"`;
}

/** Weak comparison (RFC 9110 §13.1.2): `W/` prefixes are ignored on both sides. */
export function matchesIfNoneMatch(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  const opaque = (tag: string) => tag.trim().replace(/^W\//, "");
  const wanted = opaque(etag);
  return header.split(",").some((tag) => tag.trim() === "*" || opaque(tag) === wanted);
}
