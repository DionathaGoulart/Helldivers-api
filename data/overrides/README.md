# Overrides

Hand-maintained inputs of `pnpm scrape` (plus the generated id lock). Every file is
validated when the scraper starts.

| File | Shape | Purpose |
| --- | --- | --- |
| `ids.lock.json` | `{ <collection>: { <wiki title, or Title#Anchor for index-only rows>: <id> } }` | Written by the scraper on publish. Published ids never change, even when the wiki renames a page. Do not edit by hand unless an id must be re-pointed. |
| `warbond-aliases.json` | `{ <label as written on the wiki>: <warbond id> }` | Warbond names that do not match their page title, e.g. `Helldivers Mobilize!`. Curly apostrophes and trailing page markers (`P1`) are normalized before lookup. An unknown warbond label fails the run. |
| `source-labels.json` | `{ <source label>: <source type> }` | Non-warbond acquisition labels (`Starter Equipment` → `default`, `Liberty Day` → `event`, campaign rewards such as `Census Thunder` → `event`, ship departments → `requisition`, `N/A` → `other`). Matched after the same normalization as warbond aliases. An unknown label fails the run, forcing a mapping. Mission stratagems have no source label at all and always get `other`. |
| `warbond-stubs.json` | `[<warbond id>, …]` | **Temporary.** Warbond ids referenced by the scraped collections (boosters, weapons, stratagems) until the warbonds collection is scraped; `pnpm validate:data` accepts references to these ids while `warbonds.json` does not exist. |
