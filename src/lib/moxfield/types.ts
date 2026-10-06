export interface MoxfieldCardInfo {
  name?: string;
  set?: string;
  collector_number?: string;
  scryfall_id?: string;
  scryfallId?: string;
  imageCardId?: string;
  imageCardIdIsCardFace?: boolean;
  type_line?: string;
}

export interface MoxfieldCardEntry {
  quantity?: number;
  boardType?: string;
  card?: MoxfieldCardInfo;
}

export interface MoxfieldDeckSummary {
  publicId: string;
  name?: string;
  format?: string;
  publicUrl?: string;
  viewCount?: number;
  likeCount?: number;
  bracket?: number | null;
  userBracket?: number | null;
  autoBracket?: number | null;
  ignoreBrackets?: boolean;
  mainCardId?: string;
  commanders?: MoxfieldCardEntry[] | Record<string, MoxfieldCardEntry>;
  deckCommanders?: MoxfieldCardEntry[] | Record<string, MoxfieldCardEntry>;
  createdByUser?: {
    userName?: string;
    displayName?: string;
    badges?: string[];
  };
  authors?: Array<{
    userName?: string;
    displayName?: string;
    badges?: string[];
  }>;
}

export interface MoxfieldUserDecksResponse {
  pageNumber?: number;
  pageSize?: number;
  totalResults?: number;
  totalPages?: number;
  data?: MoxfieldDeckSummary[];
}

export interface MoxfieldUserSearchResponse {
  pageNumber?: number;
  pageSize?: number;
  totalResults?: number;
  totalPages?: number;
  data?: Array<{
    userName?: string;
    displayName?: string;
    badges?: string[];
  }>;
}

export interface MoxfieldDeck {
  publicId?: string;
  name?: string;
  format?: string;
  bracket?: number | null;
  userBracket?: number | null;
  autoBracket?: number | null;
  ignoreBrackets?: boolean;
  mainboard?: Record<string, MoxfieldCardEntry>;
  sideboard?: Record<string, MoxfieldCardEntry>;
  commanders?: Record<string, MoxfieldCardEntry>;
  maybeboard?: Record<string, MoxfieldCardEntry>;
}

export interface MoxfieldDeckListItem {
  publicId: string;
  name: string;
  format?: string;
  bracketEstimate?: number;
  commanderName?: string;
  commanderImageUrl?: string;
  selected: boolean;
}
