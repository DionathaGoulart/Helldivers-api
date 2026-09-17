/** Cloudflare Pages `_headers` for the static tree (arch §8.4). */
export function renderHeaders(): string {
  return ["/*", "  Access-Control-Allow-Origin: *", "  X-Content-Type-Options: nosniff", ""].join(
    "\n",
  );
}
