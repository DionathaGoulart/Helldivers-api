import { Collection, Id, ImageUrl, Meta } from "@hd2/schemas";
import { z } from "zod";

// `/v1/search-index.json` (arch §8.2): one compact row per entity, read by `/v1/search`.
// Rows are sorted by collection (arch order) and id; terms are the normalized name and aliases.

export const SearchIndexRow = z.tuple([
  Collection,
  Id,
  z.string().min(1), // name
  ImageUrl.nullable(),
  z.array(z.string().min(1)).min(1), // terms
]);

export const SearchIndex = z.object({ meta: Meta, data: z.array(SearchIndexRow) });

export type SearchIndexRow = z.infer<typeof SearchIndexRow>;
export type SearchIndex = z.infer<typeof SearchIndex>;
