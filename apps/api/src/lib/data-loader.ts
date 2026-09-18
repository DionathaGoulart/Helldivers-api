import type { Collection, CollectionEntity, Meta } from "@hd2/schemas";
import type { SearchIndex } from "../search-index.ts";

// The Worker reads the data of its own deployment through the ASSETS binding (arch §8.1, ADR-008).
// Files are validated before the build, so they are trusted here: parsing 800 KB with zod
// would cost more CPU than the whole request budget.

export interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

export interface ListFile<T> {
  meta: Meta;
  data: T[];
}

export class AssetError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
  ) {
    super(`asset ${path} answered HTTP ${status}`);
    this.name = "AssetError";
  }
}

/** Parsed files memoized per isolate; one loader per app, and one app per `dataVersion`. */
export class DataLoader {
  readonly #memo = new Map<string, Promise<unknown>>();

  constructor(readonly dataVersion: string) {}

  collection<C extends Collection>(
    assets: AssetFetcher,
    origin: string,
    collection: C,
  ): Promise<ListFile<CollectionEntity<C>>> {
    return this.#load(assets, origin, `/v1/${collection}.json`) as Promise<
      ListFile<CollectionEntity<C>>
    >;
  }

  searchIndex(assets: AssetFetcher, origin: string): Promise<SearchIndex> {
    return this.#load(assets, origin, "/v1/search-index.json") as Promise<SearchIndex>;
  }

  #load(assets: AssetFetcher, origin: string, path: string): Promise<unknown> {
    const key = `${this.dataVersion}:${path}`;
    let pending = this.#memo.get(key);
    if (!pending) {
      pending = assets.fetch(new Request(new URL(path, origin))).then((response) => {
        if (!response.ok) throw new AssetError(path, response.status);
        return response.json();
      });
      // A failed load is retried by the next request instead of being memoized.
      pending.catch(() => this.#memo.delete(key));
      this.#memo.set(key, pending);
    }
    return pending;
  }
}
