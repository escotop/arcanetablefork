export type MpcfillExploreCard = {
  identifier: string;
  name: string;
  cardType: string;
  smallThumbnailUrl?: string;
  mediumThumbnailUrl?: string;
  downloadLink?: string;
  sourceName?: string;
  dpi?: number;
};

export type MpcfillExploreResponse = {
  cards: MpcfillExploreCard[];
  page: number;
  limit: number;
  total: number;
  hasNext: boolean;
  lastPage: number;
};
