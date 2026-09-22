# Helldivers-api

[![scrape](https://github.com/DionathaGoulart/Helldivers-api/actions/workflows/scrape.yml/badge.svg)](https://github.com/DionathaGoulart/Helldivers-api/actions/workflows/scrape.yml)
[![ci](https://github.com/DionathaGoulart/Helldivers-api/actions/workflows/ci.yml/badge.svg)](https://github.com/DionathaGoulart/Helldivers-api/actions/workflows/ci.yml)
[![data](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fhelldivers-api.dionatha.com.br%2Fv1%2Fmeta.json&query=%24.dataVersion&label=data&color=blue)](https://helldivers-api.dionatha.com.br/v1/meta.json)

Free, public, read-only JSON API with the Helldivers 2 item catalog, fed by a daily scraper of
[The Helldivers Wiki](https://helldivers.wiki.gg). Every piece of data here is the work of the
wiki's editors — see [Credits and license](#credits-and-license).

944 entities across 14 collections: weapons, stratagems, armors, helmets, capes, armor sets,
boosters, armor passives, equipment traits, player cards, emotes, patterns, titles and warbonds.
Every item carries its name, description, cost, source (which warbond or store page unlocks it),
stats, an image and the wiki URL it came from.

- **Base URL:** <https://helldivers-api.dionatha.com.br>
- **Docs:** [/docs/](https://helldivers-api.dionatha.com.br/docs/) · errors at
  [/docs/errors](https://helldivers-api.dionatha.com.br/docs/errors) · OpenAPI 3.1 at
  [/v1/openapi.json](https://helldivers-api.dionatha.com.br/v1/openapi.json)
- **Examples:** [/examples](https://helldivers-api.dionatha.com.br/examples) — armor sets,
  weapons, stratagems and the rest laid out like a normal site, with a button that reveals the
  code, every request and the JSON behind each section
- **What's new:** [/new](https://helldivers-api.dionatha.com.br/new) — the last 30 days: announced
  items, warbonds released with everything they sell, and what the daily run added
- **No key, no signup to start.** Static files are free and unlimited; query and search have a
  small anonymous limit and more on request — see [Limits and access](#limits-and-access). CORS is
  open to every origin.

> **Work in progress.** The data is live and the scraper runs daily, but v1 is not announced yet;
> shapes can still change until the launch checks are green.
>
> **A personal project.** One person runs this on Cloudflare's free plan: it is sized for a handful
> of bots, sites and scripts, not for thousands of users. For heavy use, run your own copy — see
> [A personal project, on a free plan](#a-personal-project-on-a-free-plan).

## Why

The wiki is the community's source of truth and it is HTML. Bots, overlays, build planners and
spreadsheets all end up scraping the same pages badly. This does it once, politely, and publishes
the result as static JSON on a CDN.

## Quickstart

```sh
curl https://helldivers-api.dionatha.com.br/v1/weapons/ar-23-liberator.json
```

JavaScript, the way a Discord bot would use it:

```js
const res = await fetch(
  "https://helldivers-api.dionatha.com.br/v1/query/weapons?category=primary&trait=light-armor-penetrating",
);
const { meta, data } = await res.json();
console.log(meta.total, data[0].name); // 29 'AR-23 Liberator'
```

Google Sheets — every collection is also a CSV:

```
=IMPORTDATA("https://helldivers-api.dionatha.com.br/v1/stratagems.csv")
```

[**Fetch in Bruno**](https://fetch.usebruno.com?url=https://helldivers-api.dionatha.com.br/v1/openapi.json&type=openapi)
opens the whole API in the client with one folder per tag.

## Endpoints

Static files, served straight off the CDN. These are free, unlimited and what you should reach for
first.

| Route | Returns |
| --- | --- |
| `GET /v1/meta.json` | dataset manifest: `dataVersion`, `generatedAt`, per-collection counts and source |
| `GET /v1/{collection}.json` | the full list |
| `GET /v1/all.json` | the whole catalog in one file (1.4 MB, ~120 KB compressed), for a daily sync |
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
| `GET /images/v1/{collection}/{id}.{hash}.webp` | the item image, content-hashed and immutable |

Computed at the edge. Same data, for the filters the static facets do not cover; rate limited per
client ([Limits and access](#limits-and-access)).


| Route | Returns |
| --- | --- |
| `GET /v1/query/{collection}?…` | multi-filter + `sort` + `page`/`limit` + sparse `fields` |
| `GET /v1/search?q=&collections=&limit=` | name and alias search across collections |

`query` filters depend on the collection — `warbond`, `category`, `source`, `trait`, `passive`,
`weight`, `permit`, `kind`, `type`, `scope` and `q` (name contains). Every collection also takes
`upcoming`: `true` is what the wiki has announced but the game has not shipped yet. `page` is
1-based, `limit` is 1–100 (default 50). An unknown filter or value answers
`400 application/problem+json` listing the values it would have accepted, so you can discover them
by asking wrong:

```sh
curl 'https://helldivers-api.dionatha.com.br/v1/query/stratagems?category=nope'
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
curl https://helldivers-api.dionatha.com.br/v1/armors/by-weight/heavy.json

# what Steeled Veterans unlocks
curl https://helldivers-api.dionatha.com.br/v1/armors/by-warbond/steeled-veterans.json

# orbital cannons from the ship department facet
curl https://helldivers-api.dionatha.com.br/v1/stratagems/by-category/orbital-cannons.json

# name search
curl 'https://helldivers-api.dionatha.com.br/v1/search?q=liberator&limit=5'

# heaviest-hitting primaries, two fields only
curl 'https://helldivers-api.dionatha.com.br/v1/query/weapons?category=primary&fields=name,stats&limit=5'
```

## Limits and access

Everything static — lists, items, facets, CSVs, images, schemas and `/v1/all.json` — is free and
never limited. Only `/v1/query/*` and `/v1/search` run code, and they count requests per client:

| Tier | Who | Limit |
| --- | --- | --- |
| `anon` | no key, per IP | 10 requests / 60 s |
| `origin` | browser requests from an allowlisted site, per visitor | 10 requests / 10 s |
| `key` | `Authorization: Bearer hd2_…`, per key | 20 requests / 10 s |

Past the limit the answer is `429` with `Retry-After`; every query and search response names its
tier in `X-API-Tier`, its limit in `RateLimit-Policy` and what is left in `RateLimit`
(`"anon";r=7;t=42`: 7 requests left, the window starts over in 42 s).

On top of the tiers, query and search share one budget a day across every client: 80,000
requests for these tiers, then `503` (`daily-budget-spent`) until 00:00 UTC. The `"daily"` item of
`RateLimit` shows what is left, and `X-API-Warning` appears when it runs low.

- **Keep a local copy instead.** The data changes at most once a day: poll `/v1/meta.json`,
  download `/v1/all.json` when `dataVersion` moves, filter in memory. No limit applies.
- **A site** that needs more: open an
  [access request](https://github.com/DionathaGoulart/Helldivers-api/issues/new?template=api-access.yml)
  with the domain; approved domains join the allowlist in
  [`src/spec/access.ts`](apps/api/src/spec/access.ts).
- **A server, bot or script**: email [api@dionatha.com.br](mailto:api@dionatha.com.br) for a key.
  Keys stay on the server — one in browser code is public.

Details and a sync example on [/docs/access](https://helldivers-api.dionatha.com.br/docs/access).

## A personal project, on a free plan

This API is a personal project, run by one person on Cloudflare's free plan. It is sized for a
handful of bots, sites and scripts, not for thousands of users, and nothing here comes with an
SLA. What that means in numbers:

- **Static files have no ceiling.** They never run code and Cloudflare serves them for free, so
  lists, items, facets, CSVs, images and `/v1/all.json` hold up whatever the traffic.
- **Query and search share 100,000 requests a day** across every client together — the daily
  quota of Workers Free, about 70 a minute on average. Every request that reaches the Worker
  counts, a `429` included. Past 80,000 the public tiers get `503` until 00:00 UTC; the rest is
  kept for the maintainer's own apps, and past 95,000 every client gets `503`.
- **One client can spend the day.** A key at its full 20 requests / 10 s uses the public 80,000
  in about 11 hours; a handful of addresses sending just under the flood rule, in under an hour.
- **Every query and search makes one more round trip**, to the single counter that keeps the
  day's count, and it takes longer the farther you are from where Cloudflare placed it.

Most bots and sites need no query at all: a daily copy of `/v1/all.json` filtered in memory has no
limit (see [Limits and access](#limits-and-access)). If you do need query or search at a volume
like that, run your own copy: the license allows it for any non-commercial use, and it fits in a
free Cloudflare account of your own.

### Running your own copy

Everything — data, scraper, API and docs — is in this repo, and `data/` gets a commit every day
the wiki changes, so a copy needs only Node 24, pnpm and a Cloudflare account:

```sh
git clone https://github.com/DionathaGoulart/Helldivers-api && cd Helldivers-api
pnpm install
pnpm build                                  # dist/ (site and data) + build/worker.js
cd apps/api && pnpm exec wrangler deploy
```

Before the deploy:

- In [`apps/api/wrangler.toml`](apps/api/wrangler.toml), point `routes` at a domain of yours on
  Cloudflare (or drop `routes` and set `workers_dev = true` for a `*.workers.dev` URL, which a
  zone's WAF rule cannot protect) and empty `UNLIMITED_KEYS`. `SITE_URL` in
  [`apps/api/src/site.ts`](apps/api/src/site.ts) is the URL the errors and OpenAPI point at.
- Set the limits in [`apps/api/src/spec/access.ts`](apps/api/src/spec/access.ts): `TIERS` per
  client, `DAILY_BUDGET` per day. On Workers Paid, raise the budget to match the plan.
- Keys need a secret of your own: `pnpm exec wrangler secret put API_KEY_SECRET`, then
  `pnpm key:issue` with the same value in `apps/api/.dev.vars`.

Images come from a private bucket at deploy, so your build ships without them. Every image `url`
is a static file here too: prefix it with `https://helldivers-api.dionatha.com.br`. To stay
current, pull `main` and deploy again.

## Caching

- **Prefer the static files.** `/v1/*.json`, the `by-*` files and the CSVs are static objects on
  the CDN: no quota, no cold start, p95 under 100 ms.
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
[`/v1/reports/conflicts.json`](https://helldivers-api.dionatha.com.br/v1/reports/conflicts.json) and
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
