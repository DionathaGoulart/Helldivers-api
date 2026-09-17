# Security policy

## Scope

This project is a read-only, unauthenticated JSON API and the scraper that fills it. There are no
accounts, no user data, no write endpoints and no API keys to steal. What is worth reporting:

- A way to make the published dataset or the deployed site serve something the scraper did not
  produce (supply-chain or workflow injection, tampering with `data/v1` or the Pages deploy).
- Credential exposure: a Backblaze B2 key, a Cloudflare token or a GitHub secret visible in the
  repo, in a workflow log, in `data/`, or reachable through the API.
- A way to read the private B2 bucket without a signed URL, or to make the image endpoint sign a
  key it should not.
- A request that can take the API down or burn the daily Workers quota far out of proportion to its
  cost (a single request that costs minutes of CPU, an unbounded response).
- Anything in the scraper that could be turned against the wiki — a way to make it ignore
  `robots.txt`, drop its delay, or hammer a page.

Out of scope: wrong item data (that is a
[data error issue](../../issues/new?template=data-error.yml)), missing rate limits on the free
endpoints (deliberate, see the README), open CORS (deliberate), volumetric DDoS against Cloudflare,
and findings from automated scanners with no demonstrated impact.

## Reporting

Use GitHub's private vulnerability reporting: **Security → Report a vulnerability** on
<https://github.com/DionathaGoulart/Helldivers-api>. That keeps the report private until there is a
fix.

Please do not open a public issue for anything in the list above, and do not test against the live
site beyond what is needed to show the problem — a local `pnpm dev` reproduces the whole API.

Include what you did, what happened, and why it matters. A `curl` that shows it is worth more than
a scanner report.

## What to expect

This is a one-maintainer hobby project, not a product with an on-call rotation.

- Acknowledgement within 7 days.
- An assessment and a plan, or a reason it is out of scope, within 14 days.
- Credentials are rotated as soon as exposure is confirmed, before anything else.
- Fixes ship on `main` and deploy within minutes; there are no supported older versions — only the
  live deployment and `/v1` matter.

No bounty, and no CVE unless the impact reaches people other than the maintainer. Credit in the
release notes if you want it.
