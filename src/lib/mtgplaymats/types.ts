export type MtgplaymatsProduct = {
  id: number;
  title: string;
  handle: string;
  imageUrl: string;
  productUrl: string;
};

export type MtgplaymatsProductsResponse = {
  products: Array<{
    id: number;
    title: string;
    handle: string;
    images?: Array<{ src: string }>;
  }>;
};

export type MtgplaymatsSearchResponse = MtgplaymatsProductsResponse & {
  page: number;
  limit: number;
  total: number;
  hasNext: boolean;
  lastPage: number;
};
