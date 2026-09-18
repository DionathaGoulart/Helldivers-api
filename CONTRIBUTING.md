# Contributing

Thanks for looking. Three kinds of help are useful here, in descending order of usefulness:

1. **Data errors** — a field that disagrees with the wiki. No code needed, see below.
2. **Parser fixes** — the wiki changed a table and a collection lost a field.
3. **New facets, endpoints or docs.** Open an issue first — the collection list and the endpoint
   surface are frozen for v1, and live Galactic War data, enemies, planets and attachments are out
   of scope.

By contributing, you agree that your contribution is licensed under
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/), like the rest of the project
(see [`LICENSE`](LICENSE)).

## Reporting a data error

Open a [data error issue](../../issues/new?template=data-error.yml) with the item URL, the field,
the wiki URL and what the wiki says. That is enough to reproduce — please do not send a PR that
edits `data/v1` by hand: the scraper owns that directory and the next run would overwrite it.

If the wiki itself is wrong, fix the wiki. This project is a mirror, not a source.

## Ground rules

These are not style preferences; breaking them breaks the build or the wiki's goodwill.

- **Fixtures before parsers.** Save the HTML first, write the parser against the saved file. Never
  guess at markup.
- **Tests never touch the network.** Only `pnpm scrape` (without `--offline`) and
  `pnpm fixtures:update` are allowed out, and both go through the polite client.
- **Politeness is enforced in code.** Minimum 3 s between requests plus jitter, an identifiable
  `User-Agent` with the repo URL, `robots.txt` checked on every run, and the run aborts if the
  wiki's `Content-Signal` policy changes to something unreviewed. Do not lower `SCRAPER_DELAY_MS`;
  the schema rejects anything under 3000.
- **`data/v1` changes only through a scrape.** The commit is
  `chore(data): update YYYY-MM-DD (+a ~c -r)` and the workflow writes it.
- **Conventional Commits**, and CI green (`typecheck`, `lint`, `test`, `validate:data`, an offline
  scrape and the build) before review.

## Setup

Node ≥ 24 and pnpm 11 (`packageManager` pins the exact version — `corepack enable` is enough).

```sh
pnpm install
pnpm test            # ~600 tests, all offline
pnpm typecheck
pnpm lint            # biome ci; pnpm format writes the fixes
```

No `.env` is needed for any of that, nor for an offline scrape:

```sh
pnpm scrape --offline   # rebuilds data/ from the saved fixtures
pnpm validate:data      # every file against its schema, plus cross-collection integrity
pnpm dev                # the API and docs site on wrangler pages dev
```

`.env` only matters for the two things that leave the machine: an **online** scrape and the image
upload. Copy `.env.example` to `.env` and fill the B2 write key if you have one; without it, an
online run fails at the image step (and you almost certainly do not need one — the maintainer's
daily run covers it).

## Fixing a parser

The scraper is split by wiki page type, and each parser is pure: HTML in, plain objects out.

```
packages/scraper/src/
  wiki/        titles, URLs, revision ids
  http/        polite client, cache, robots
  parsers/     one file per wiki page type (weapon-page.ts, warbonds-index.ts, superstore.ts…)
  normalize/   strings, numbers, currencies, costs
  collections/ one file per collection: calls parsers, builds entities, applies overrides
  link/        cross-collection links (armor sets ↔ capes, traits ↔ weapons)
  images/      download, re-encode to webp, upload to B2
  publish/     envelopes, facets, CSV, changelog, id lock
```

The loop:

1. **Save the page.** `pnpm fixtures:update --pages AR-23_Liberator` (comma-separate for more, and
   `--images File.png` for image fixtures). Fixtures land in
   `packages/scraper/test/fixtures/wiki/<Title>.html` with a `manifest.json` recording the URL,
   fetch time and revision id. Commit them with the fix — a parser test without its fixture is not
   reviewable.
2. **Write the test first**, next to the parser it covers
   (`packages/scraper/test/parsers/…`). Assert the fields, not the whole blob.
3. **Fix the parser.** If the wiki added a value an enum does not have, add it to
   `packages/schemas/src/` — new enum values are additive and allowed inside v1.
4. **Run the offline pipeline.** `pnpm test` covers the golden snapshots in
   `packages/scraper/test/__snapshots__`, which hold the published shape of every collection. A
   deliberate change updates them (`pnpm test -u`) **in the same commit**, so review sees exactly
   what moved in the output.
5. **`pnpm scrape --offline && pnpm validate:data`** to prove the whole dataset still builds and
   links up.

Useful flags: `--only weapons,stratagems` for one collection, `--full-refresh` to ignore the HTTP
cache, `--allow-drop` to accept a count drop the guardrail would otherwise refuse,
`--report <dir>` to move `.reports/`.

### When two wiki pages disagree

They often do — an infobox says recoil 14, the stats table says 10.5. The item page wins over an
index or a warbond table, the raw strings are kept in `statsRaw`, and every conflict is recorded in
`reports/conflicts.json` and published at `/v1/reports/conflicts.json`. Do not silently pick a side
inside a parser — record it through `publish/conflicts.ts` (`mergeConflicts`) so the report keeps
both values and the reason.

## Overrides, not special cases

Anything the wiki does not state consistently belongs in `data/overrides/`, not in an `if` inside a
parser. Four files, each documented in [`data/overrides/README.md`](data/overrides/README.md):

| File | For |
| --- | --- |
| `warbond-aliases.json` | warbond labels that do not match a page title |
| `source-labels.json` | acquisition labels → source type (an unknown label fails the run on purpose) |
| `armor-sets.json` | cape↔set links the scraper cannot prove |
| `ids.lock.json` | generated; keeps published ids stable when the wiki renames a page — do not hand-edit |

An unmapped label failing the run is the design: it forces a decision instead of guessing.

## Testing a failure

The scraper rehearses its own alarms. `SCRAPER_DRILL=<kind> pnpm scrape --offline --only boosters`
simulates `parser-broken`, `blocked` (three 429s), `count-drop`, `images` or `robots-changed`. Each
must exit non-zero and leave `data/v1` byte-identical; `pnpm alert --dry-run` then renders the
issue it would open. `packages/scraper/test/drill.test.ts` keeps that honest.

## The API

`apps/api` is a Cloudflare Pages project: static files for everything in `/v1`, a Worker for
`/v1/query/*`, `/v1/search` and `/images/*`. `apps/docs` is the landing page and the reference.

```sh
pnpm build                     # dist/ with the static dataset, the worker and openapi.json
pnpm dev                       # builds, then wrangler pages dev on :8000
pnpm smoke --base http://localhost:8000 --skip-images
```

OpenAPI is generated from the zod schemas — edit the schema or its registry metadata, never
`openapi.json`.

## Why is it like this?

Most of the odd-looking choices — the 3 s floor, overrides failing a run, ids never changing, the
scraper owning `data/v1` — are deliberate and explained in the commit that introduced them. Read
`git log` on the file before proposing a redesign, and ask in an issue if the reason is not obvious.
