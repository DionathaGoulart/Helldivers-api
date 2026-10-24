import { describe, expect, it } from "vitest";
import type { GetOptions, HttpClient } from "../src/http/client.ts";
import { MemoSource, OnlineSource, type WikiPage, type WikiSource } from "../src/source.ts";

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
      ["/wiki/Stratagems", { fresh: true, staleIfError: false }],
      ["/wiki/TD-110_Maelstrom", { fresh: false, staleIfError: true }],
    ]);
  });

  it("lets a targeted fresh request bypass the normal stale fallback", async () => {
    const { http, calls } = recordingHttp();
    const source = new OnlineSource(http);
    await source.page("SA-7 Headfirst", { fresh: true });
    expect(calls).toEqual([["/wiki/SA-7_Headfirst", { fresh: true, staleIfError: false }]]);
  });
});

describe("MemoSource", () => {
  it("replaces a memoized page with the explicitly refreshed response", async () => {
    let calls = 0;
    const inner: WikiSource = {
      offline: false,
      robotsTxt: async () => "",
      page: async (title, options) =>
        ({
          title,
          url: `https://helldivers.wiki.gg/wiki/${title}`,
          html: options?.fresh ? "live" : "cached",
          fromCache: !options?.fresh,
          lastModified: null,
        }) satisfies WikiPage,
    };
    const memo = new MemoSource({
      ...inner,
      page: async (title, options) => {
        calls++;
        return inner.page(title, options);
      },
    });
    expect((await memo.page("SA-7 Headfirst")).html).toBe("cached");
    expect((await memo.page("SA-7 Headfirst", { fresh: true })).html).toBe("live");
    expect((await memo.page("SA-7 Headfirst")).html).toBe("live");
    expect(calls).toBe(2);
  });
});
