import { Currency } from "@hd2/schemas";
import { z } from "zod";

// Raw records: what the page says, as strings, before normalization (arch §6.1 step 4).

export const RawLink = z.object({
  label: z.string().min(1),
  title: z.string().min(1),
  anchor: z.string().nullable(),
});

export const RawCost = z.object({
  text: z.string(),
  currency: Currency.nullable(), // from the icon in the cell
});

// An acquisition cell: `Source` rows, index `Source` columns and item box captions.
export const RawSourceCell = z.object({
  label: z.string().min(1), // "Python Commandos P1", "Starter Equipment"
  link: RawLink.nullable(),
  pageMarker: z.string().nullable(), // `small .explain[title]`, "Page 1"
});

export const RawImage = z.object({
  file: z.string().min(1),
  src: z.string().min(1),
  width: z.number().int().positive().nullable(), // original file size
  height: z.number().int().positive().nullable(),
});

export type RawLink = z.infer<typeof RawLink>;
export type RawCost = z.infer<typeof RawCost>;
export type RawSourceCell = z.infer<typeof RawSourceCell>;
export type RawImage = z.infer<typeof RawImage>;
