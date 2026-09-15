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

export const RawImage = z.object({
  file: z.string().min(1),
  src: z.string().min(1),
});

export type RawLink = z.infer<typeof RawLink>;
export type RawCost = z.infer<typeof RawCost>;
export type RawImage = z.infer<typeof RawImage>;
