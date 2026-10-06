/** Fields present on Moxfield deck search items and full deck payloads (see moxfield-api deck-search-item). */
export interface MoxfieldBracketFields {
  bracket?: number | null;
  userBracket?: number | null;
  autoBracket?: number | null;
  ignoreBrackets?: boolean;
}

/** Effective Commander bracket (1–5) from Moxfield metadata, when the deck uses brackets. */
export function getMoxfieldDeckBracket(deck: MoxfieldBracketFields | undefined): number | undefined {
  if (!deck || deck.ignoreBrackets) return undefined;

  const value = deck.bracket ?? deck.userBracket ?? deck.autoBracket;
  if (value == null || !Number.isFinite(value)) return undefined;

  const rounded = Math.round(value);
  if (rounded < 1 || rounded > 5) return undefined;
  return rounded;
}
