# Helldivers-api

[![scrape](https://github.com/DionathaGoulart/Helldivers-api/actions/workflows/scrape.yml/badge.svg)](https://github.com/DionathaGoulart/Helldivers-api/actions/workflows/scrape.yml)
[![ci](https://github.com/DionathaGoulart/Helldivers-api/actions/workflows/ci.yml/badge.svg)](https://github.com/DionathaGoulart/Helldivers-api/actions/workflows/ci.yml)
[![data](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fhelldivers-api.pages.dev%2Fv1%2Fmeta.json&query=%24.dataVersion&label=data&color=blue)](https://helldivers-api.pages.dev/v1/meta.json)

Free, public, read-only JSON API with the Helldivers 2 item catalog, fed by a daily scraper of
[The Helldivers Wiki](https://helldivers.wiki.gg). Every piece of data here is the work of the
wiki's editors — see [Credits and license](#credits-and-license).

944 entities across 14 collections: weapons, stratagems, armors, helmets, capes, armor sets,
boosters, armor passives, equipment traits, player cards, emotes, patterns, titles and warbonds.
Every item carries its name, description, cost, source (which warbond or store page unlocks it),
stats, an image and the wiki URL it came from.

- **Base URL:** <https://helldivers-api.pages.dev>
- **Docs:** [/docs/](https://helldivers-api.pages.dev/docs/) · errors at
  [/docs/errors](https://helldivers-api.pages.dev/docs/errors) · OpenAPI 3.1 at
  [/v1/openapi.json](https://helldivers-api.pages.dev/v1/openapi.json)
- **No key, no signup, no per-client rate limit.** CORS is open to every origin.

> **Work in progress.** The data is live and the scraper runs daily, but v1 is not announced yet;
> shapes can still change until the launch checks are green.

## Why

The wiki is the community's source of truth and it is HTML. Bots, overlays, build planners and
spreadsheets all end up scraping the same pages badly. This does it once, politely, and publishes
the result as static JSON on a CDN.

## Quickstart

```sh
curl https://helldivers-api.pages.dev/v1/weapons/ar-23-liberator.json
```

JavaScript, the way a Discord bot would use it:

```js
const res = await fetch(
  "https://helldivers-api.pages.dev/v1/query/weapons?category=primary&trait=light-armor-penetrating",
);
const { meta, data } = await res.json();
console.log(meta.total, data[0].name); // 29 'AR-23 Liberator'
```

Google Sheets — every collection is also a CSV:

```
=IMPORTDATA("https://helldivers-api.pages.dev/v1/stratagems.csv")
```

[**Fetch in Bruno**](https://fetch.usebruno.com?url=https://helldivers-api.pages.dev/v1/openapi.json&type=openapi)
opens the whole API in the client with one folder per tag.

## Endpoints

Static files, served straight off the CDN. These are free, unlimited and what you should reach for
first.

| Route | Returns |
| --- | --- |
| `GET /v1/meta.json` | dataset manifest: `dataVersion`, `generatedAt`, per-collection counts and source |
| `GET /v1/{collection}.json` | the full list |
| `GET /v1/{collection}/{id}.json` | one item |
| `GET /v1/{collection}.csv` | the same list flattened for spreadsheets |
| `GET /v1/{collection}/by-warbond/{warbondId}.json` | items unlocked by one warbond |
| `GET /v1/{collection}/by-source/{sourceType}.json` | `warbond`, `superstore`, `default`, `requisition`, `progression`, `pre_order`, `twitch_drop`, `edition`, `event`, `other` |
| `GET /v1/weapons/by-category/{primary\|secondary\|throwable\|civilian}.json` | facet |
| `GET /v1/stratagems/by-category/{department}.json` | e.g. `orbital-cannons`, `hangar`, `bridge` |
| `GET /v1/armors/by-weight/{light\|medium\|heavy}.json` | facet |
| `GET /v1/patterns/by-scope/{vehicle\|weapon}.json` | facet |
| `GET /v1/titles/by-kind/{rank\|acquirable}.json` | facet |
| `GET /v1/emotes/by-kind/{emote\|victory-pose}.json` | facet |
| `GET /v1/changelog.json` | the last 90 data changes, per collection and field |
| `GET /v1/reports/conflicts.json` | wiki contradictions and how each was resolved |
| `GET /v1/schemas/{entity}.json` | JSON Schema for one entity |
| `GET /v1/openapi.json` | OpenAPI 3.1 for everything |

Computed at the edge. Same data, for the filters the static facets do not cover.

| Route | Returns |
| --- | --- |
| `GET /v1/query/{collection}?…` | multi-filter + `sort` + `page`/`limit` + sparse `fields` |
| `GET /v1/search?q=&collections=&limit=` | name and alias search across collections |
| `GET /images/v1/{collection}/{id}.{hash}.webp` | the item image, content-hashed and immutable |

`query` filters depend on the collection — `warbond`, `category`, `source`, `trait`, `passive`,
`weight`, `permit`, `kind`, `type`, `scope` and `q` (name contains). `page` is 1-based, `limit` is
1–100 (default 50). An unknown filter or value answers `400 application/problem+json` listing the
values it would have accepted, so you can discover them by asking wrong:

```sh
curl 'https://helldivers-api.pages.dev/v1/query/stratagems?category=nope'
```

## Response shape

Every JSON response is the same envelope: `meta` describes the dataset, `data` carries the payload
— an array for lists and facets, the item itself for a single item. `query` adds `links` and
pagination fields to `meta`.

```json
{
  "meta": {
    "apiVersion": "v1",
    "dataVersion": "2026-09-17.2d3c0c72",
    "generatedAt": "2026-09-17T15:14:26Z",
    "count": 104,
    "source": { "name": "The Helldivers Wiki", "url": "https://helldivers.wiki.gg" }
  },
  "data": [{ "id": "ar-23-liberator", "name": "AR-23 Liberator" }]
}
```

Departments and kinds are hyphenated in a path (`by-category/orbital-cannons`,
`by-kind/victory-pose`) while `by-source` keeps the enum spelling (`by-source/pre_order`); the
field values themselves are always the enum (`orbital_cannons`, `victory_pose`, `pre_order`).

## Examples

```sh
# every heavy armor, no compute
curl https://helldivers-api.pages.dev/v1/armors/by-weight/heavy.json

# what Steeled Veterans unlocks
curl https://helldivers-api.pages.dev/v1/armors/by-warbond/steeled-veterans.json

# orbital cannons from the ship department facet
curl https://helldivers-api.pages.dev/v1/stratagems/by-category/orbital-cannons.json

# name search
curl 'https://helldivers-api.pages.dev/v1/search?q=liberator&limit=5'

# heaviest-hitting primaries, two fields only
curl 'https://helldivers-api.pages.dev/v1/query/weapons?category=primary&fields=name,stats&limit=5'
```

## Caching and limits

- **Prefer the static facets.** `/v1/*.json`, the `by-*` files and the CSVs are static objects on
  the CDN: no quota, no cold start, p95 under 100 ms.
- `/v1/query/*`, `/v1/search` and `/images/*` run a Worker. There is no per-client limit, but they
  share one Workers Free quota of 100,000 requests/day for everybody (resets 00:00 UTC). Hammering
  them hurts other clients; the static files cannot run out.
- **Cache image URLs — they never change.** The hash is part of the name, so
  `Cache-Control: public, max-age=31536000, immutable`. A new image means a new URL.
- `/v1/*` sends `ETag` and `Cache-Control: public, max-age=300, stale-while-revalidate=3600`. Send
  `If-None-Match` and you get `304` most of the time.
- Every `/v1/*` response carries `X-Data-Version`, the same value as `meta.json` `dataVersion`
  (`YYYY-MM-DD.<hash>`). Poll `meta.json` to know whether anything moved — it is the cheapest
  request in the API.

## Versioning

The version is in the path. Inside `/v1` only additive changes happen: new optional fields, new
collections, new enum values. **Treat every enum as open** — the wiki adds weapon categories and
source labels whenever a warbond ships, and a new value is not a breaking change.

A breaking change means `/v2` served in parallel, with `/v1` kept for at least 6 months and
answering `Deprecation` and `Sunset` headers the whole time.

## Data, and how wrong it can be

Everything is parsed from the wiki, so the data is as good as the wiki plus the parser. Every item
has a `wiki.url` — check it before filing a bug. Some items also carry
`wiki.flags: ["potentially_outdated"]`, copied from the wiki's own banner.

When two wiki tables disagree (an infobox says recoil 14, the stats table says 10.5), the scraper
picks the item page over the index, writes both into
[`/v1/reports/conflicts.json`](https://helldivers-api.pages.dev/v1/reports/conflicts.json) and
keeps the raw strings in `statsRaw`.

Found a field that is wrong? Open a
[data error issue](https://github.com/DionathaGoulart/Helldivers-api/issues/new?template=data-error.yml)
with the item URL, the field and what the wiki says.

## Daily scrape

`scrape.yml` runs at 18:07 America/Sao_Paulo, Sundays with a full refresh. A run that changes
anything commits `data/` and deploys; a run that changes nothing commits nothing. Any failure
leaves `data/v1` untouched and opens a `scraper-alert` issue, which the next green run closes.

Run it by hand from the Actions tab (`full_refresh`, `allow_drop`, `only`, `drill`).

### Manual fallback

If GitHub Actions cannot reach the wiki, the same run works from a machine with the write key in
`.env`:

```sh
pnpm install
pnpm scrape                 # add --only boosters to try one collection first
pnpm validate:data
git add data/ && git commit -F .reports/commit-message.txt && git push
```

The push to `main` starts `deploy.yml`, which builds, deploys and smokes the site.

## Contributing

Parser fixes, new overrides and data reports are welcome — see
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the fixtures-first workflow and how to run the whole thing
offline. Security reports go through [`SECURITY.md`](SECURITY.md).

## Credits and license

**Thank you to [The Helldivers Wiki](https://helldivers.wiki.gg) and everyone who edits it.** Every
name, stat, cost and description in this API was written, checked and kept current by the wiki's
community, patch after patch. This project only reads their pages once a day and reshapes them into
JSON — the hard part is theirs. Thanks as well to the editors of the original Helldivers Fandom wiki,
where the older pages started.

If the data helps you, give back where it comes from: when a page is wrong or missing, fix it on
the wiki, and the next daily run picks it up.

Made by [Dionatha Goulart](https://github.com/DionathaGoulart). The whole project, code and data,
is [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) ([`LICENSE`](LICENSE)),
the same license as the wiki:

- **Free for any non-commercial use.** Bots, overlays, build planners, spreadsheets: copy it, fork
  it, change it. No need to ask.
- **No commercial use.** No selling the data, reselling the API or putting it behind a paywall.
- **Credit both** Dionatha Goulart and The Helldivers Wiki, with links. Every item carries its
  `wiki.url`, so the attribution travels with the record. For example:

  > Data from the [Helldivers 2 Data API](https://github.com/DionathaGoulart/Helldivers-api) by
  > Dionatha Goulart, adapted from [The Helldivers Wiki](https://helldivers.wiki.gg),
  > CC BY-NC-SA 4.0.

- **Share alike.** Adaptations you share (a modified dataset, a fork) keep this license.

Pages from before February 2024 are adapted from the Fandom wiki and stay CC BY-SA. Images are the
game's, served for identification only, and not covered by the license.

Helldivers 2 is Arrowhead Game Studios'; this project is unofficial and not affiliated with
Arrowhead, Sony or wiki.gg.
