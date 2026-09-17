# Schema test data

- `examples/<collection>.<id>.json` — one entity per file: the real wiki examples
  from the architecture doc (§5.4, fetched 2026-09-15), completed into full objects.
  Values the audit did not capture are `null` or `[]`, never guessed. Image hashes
  are placeholders (`sha256("<collection>/<key>")`, first 8 hex).
  The `version` and `bytes` of each `reports/images.json` entry are placeholders too.
- `dataset/` — a synthetic `data/v1` tree (`meta.json`, `changelog.json`,
  `<collection>.json`, `<collection>/<id>.json`, `reports/images.json`) that passes
  `pnpm validate:data`. It holds every example plus filler entities that exist only
  so every reference resolves (Camo Cloak, TG-122 Demo-Trooper, the Helldivers
  Mobilize and Viper Commandos warbonds, the other weapon traits…). **Filler values
  are not wiki data**: stats, codes, dates and medal totals are placeholders.

Each example must equal its item in `dataset/` (`examples.test.ts`). When a schema
changes, update the example, its item file and the matching entry in the list file.
