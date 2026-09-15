import { z } from "zod";
import { Base, Source } from "../common.ts";

export const Booster = z.object({ ...Base, effect: z.string(), source: Source });

export type Booster = z.infer<typeof Booster>;
