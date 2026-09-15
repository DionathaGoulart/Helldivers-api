/** `wgRevisionId` from the inline RLCONF script (arch §4.1); null when absent. */
export function readRevisionId(html: string): number | null {
  const match = /"wgRevisionId"\s*:\s*(\d+)/.exec(html);
  return match?.[1] ? Number(match[1]) : null;
}
