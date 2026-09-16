// Armory pages (armors, helmets, capes): the DRUID title is the in-game name, but a few carry a
// disambiguation suffix the game does not show (`CPH-26 Commandant (Armor)`).

const KIND_SUFFIX = /\s+\((?:Armor|Body Armor|Helmet|Cape|Player Card)\)$/;

/** `CPH-26 Commandant (Armor)` → `CPH-26 Commandant`. */
export function armoryName(druidTitle: string): string {
  return druidTitle.replace(KIND_SUFFIX, "");
}
