import { z } from "zod";
import { Collection, Id } from "./common.ts";

/**
 * Kebab slug of a wiki name (arch §5.1): NFKD, strip diacritics, drop `'` `’` `.` `!`,
 * turn every other non-alphanumeric run into `-`, lowercase, trim.
 */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/['’.!]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!Id.safeParse(slug).success) {
    throw new Error(`cannot slugify ${JSON.stringify(name)}`);
  }
  return slug;
}

// `data/overrides/ids.lock.json`: collection → wiki key (page title, or title#anchor) → id.
export const IdLockFile = z.partialRecord(Collection, z.record(z.string().min(1), Id));

export type IdLockFile = z.infer<typeof IdLockFile>;

export class IdCollisionError extends Error {
  constructor(
    readonly collection: Collection,
    readonly key: string,
    readonly id: Id,
    readonly lockedKey: string,
  ) {
    super(`${collection}: "${key}" slugifies to "${id}", already locked to "${lockedKey}"`);
    this.name = "IdCollisionError";
  }
}

const byKey = <T>([a]: [string, T], [b]: [string, T]) => (a < b ? -1 : a > b ? 1 : 0);

/** Published ids never change (arch §0.8, §5.5 rule 8). */
export class IdLock {
  readonly #collections = new Map<Collection, Map<string, Id>>();

  static from(json: unknown): IdLock {
    const lock = new IdLock();
    for (const [collection, entries] of Object.entries(IdLockFile.parse(json))) {
      lock.#collections.set(Collection.parse(collection), new Map(Object.entries(entries)));
    }
    return lock;
  }

  get(collection: Collection, key: string): Id | undefined {
    return this.#collections.get(collection)?.get(key);
  }

  /** Locked id of `key`, or a new id slugified from `name` and locked to `key`. */
  resolve(collection: Collection, key: string, name: string): Id {
    const locked = this.get(collection, key);
    if (locked) {
      return locked;
    }
    const id = slugify(name);
    const lockedKey = this.#keyOf(collection, id);
    if (lockedKey !== undefined) {
      throw new IdCollisionError(collection, key, id, lockedKey);
    }
    this.#entries(collection).set(key, id);
    return id;
  }

  /** Locks another key (e.g. the new title after a rename) to an existing id. */
  alias(collection: Collection, key: string, id: Id): void {
    const locked = this.get(collection, key);
    if (locked !== undefined && locked !== id) {
      throw new Error(`${collection}: "${key}" is already locked to "${locked}"`);
    }
    this.#entries(collection).set(key, Id.parse(id));
  }

  toJSON(): IdLockFile {
    const json: IdLockFile = {};
    for (const collection of Collection.options) {
      const entries = this.#collections.get(collection);
      if (entries?.size) {
        json[collection] = Object.fromEntries([...entries].sort(byKey));
      }
    }
    return json;
  }

  serialize(): string {
    return `${JSON.stringify(this.toJSON(), null, 2)}\n`;
  }

  #entries(collection: Collection): Map<string, Id> {
    let entries = this.#collections.get(collection);
    if (!entries) {
      entries = new Map();
      this.#collections.set(collection, entries);
    }
    return entries;
  }

  #keyOf(collection: Collection, id: Id): string | undefined {
    for (const [key, locked] of this.#collections.get(collection) ?? []) {
      if (locked === id) {
        return key;
      }
    }
    return undefined;
  }
}
