# Overrides

Hand-maintained inputs of `pnpm scrape` (plus the generated id lock). Every file is
validated when the scraper starts.

| File | Shape | Purpose |
| --- | --- | --- |
| `ids.lock.json` | `{ <collection>: { <wiki title, or Title#Anchor for index-only rows>: <id> } }` | Written by the scraper on publish. Weapon patterns have neither a page nor a row anchor and are keyed `Cosmetics#Patterns/<name>`. Published ids never change, even when the wiki renames a page. Do not edit by hand unless an id must be re-pointed. |
| `warbond-aliases.json` | `{ <label as written on the wiki>: <warbond id> }` | Warbond names that do not match their page title, e.g. `Helldivers Mobilize!`, or labels whose link goes through a redirect (`Righteous Revenants` → `Helldivers 2 x Killzone Legendary Warbond` on the Cosmetics titles table). Curly apostrophes and trailing page markers (`P1`) are normalized before lookup. An unknown warbond label fails the run. |
| `source-labels.json` | `{ <source label>: <source type> }` | Non-warbond acquisition labels (`Starter Equipment` → `default`, `Liberty Day` → `event`, campaign and Major Order rewards such as `Census Thunder`, `Void Piercer` or `Social Media MO` → `event`, account gifts such as `Anniversary Gift` → `event`, `Downloadable Content` → `edition`, ship departments → `requisition`, `N/A` → `other`, `Minor Places of Interest` → `other`). Civilian weapons have no Source row and take the first Procurement link whose label is mapped here. Matched after the same normalization as warbond aliases. An unknown label fails the run, forcing a mapping. Mission stratagems have no source label at all and always get `other`. |
| `warbond-stubs.json` | `[<warbond id>, …]` | **Temporary.** Warbond ids referenced by the scraped collections (boosters, weapons, stratagems, armors, helmets, capes, player cards, emotes, patterns, titles) until the warbonds collection is scraped; `pnpm validate:data` accepts references to these ids while `warbonds.json` does not exist. |
