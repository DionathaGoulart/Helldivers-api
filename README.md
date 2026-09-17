# Helldivers-api

[![scrape](https://github.com/DionathaGoulart/Helldivers-api/actions/workflows/scrape.yml/badge.svg)](https://github.com/DionathaGoulart/Helldivers-api/actions/workflows/scrape.yml)
[![ci](https://github.com/DionathaGoulart/Helldivers-api/actions/workflows/ci.yml/badge.svg)](https://github.com/DionathaGoulart/Helldivers-api/actions/workflows/ci.yml)
[![data](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fhelldivers-api.pages.dev%2Fv1%2Fmeta.json&query=%24.dataVersion&label=data&color=blue)](https://helldivers-api.pages.dev/v1/meta.json)

Free, public, read-only JSON API with the Helldivers 2 item catalog, fed by a daily scraper of
[The Helldivers Wiki](https://helldivers.wiki.gg).

> **Work in progress.** Nothing is published yet; endpoints and data shapes may change.

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

Source of all data: <https://helldivers.wiki.gg>
