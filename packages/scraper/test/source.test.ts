import { describe, expect, it } from "vitest";
import type { GetOptions, HttpClient } from "../src/http/client.ts";
import { OnlineSource } from "../src/source.ts";

function recordingHttp() {
  const calls: [string, GetOptions | undefined][] = [];
  const http = {
    get: async (target: string, options?: GetOptions) => {
      calls.push([target, options]);
      return {
        url: `https://helldivers.wiki.gg${target}`,
        status: 200,
        body: Buffer.from("<html>"),
        fromCache: false,
        lastModified: null,
      };
    },
  } as unknown as HttpClient;
  return { http, calls };
}

describe("OnlineSource", () => {
  it("fetches the index pages fresh and revalidates every other page", async () => {
    const { http, calls } = recordingHttp();
    const source = new OnlineSource(http, ["Stratagems", "Warbonds"]);
    await source.page("Stratagems");
    await source.page("TD-110 Maelstrom");
    expect(calls).toEqual([
      ["/wiki/Stratagems", { fresh: true }],
      ["/wiki/TD-110_Maelstrom", { fresh: false }],
    ]);
  });
});
