const SHOP_BASE = 'https://mtgplaymats.com/es/collections';
const SHOP_SEARCH_BASE = 'https://mtgplaymats.com/es/search';
const SHOP_SEARCH_SECTION_ID = 'template--32284064809292__main';
const SHOP_SEARCH_PAGE_SIZE = 24;

const SHOP_FETCH_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'UntappedTable/1.0 (playmat picker)',
};

const SHOP_HTML_FETCH_HEADERS = {
  Accept: 'text/html,application/xhtml+xml',
  'User-Agent': 'UntappedTable/1.0 (playmat picker)',
};

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeShopifyImageUrl(url) {
  if (!url) return undefined;
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}

function parseSearchSectionHtml(html) {
  const totalMatch = html.match(/(\d+)\s+resultados/i);
  const total = totalMatch ? Number(totalMatch[1]) : undefined;
  const cardRe = /<li[^>]*class="[^"]*grid__item[^"]*"[^>]*>[\s\S]*?<\/li>/gi;
  const products = [];
  const seenHandles = new Set();

  for (const match of html.matchAll(cardRe)) {
    const block = match[0];
    const handleMatch = block.match(/href="\/es\/products\/([^"?]+)/);
    const handle = handleMatch?.[1];
    if (!handle || seenHandles.has(handle)) continue;
    seenHandles.add(handle);

    const idMatch = block.match(/id="title--(\d+)"/);
    const id = idMatch ? Number(idMatch[1]) : undefined;
    if (!id) continue;

    const titleMatch =
      block.match(/id="title--\d+"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i) ||
      block.match(/class="[^"]*card__heading[^"]*"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
    const title = decodeHtmlEntities(titleMatch?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '');
    if (!title) continue;

    const srcsetMatch = block.match(/srcset="([^"]+)"/);
    const srcMatch = block.match(/\ssrc="([^"]+)"/);
    let imageUrl;
    if (srcsetMatch) {
      const candidates = srcsetMatch[1].split(',').map(part => part.trim().split(/\s+/)[0]);
      imageUrl = normalizeShopifyImageUrl(candidates[candidates.length - 1]);
    } else {
      imageUrl = normalizeShopifyImageUrl(srcMatch?.[1]);
    }
    if (!imageUrl) continue;

    products.push({
      id,
      title,
      handle,
      images: [{ src: imageUrl }],
    });
  }

  return { total, products };
}

async function fetchShopSearchSectionHtml(query, pageNum) {
  const params = new URLSearchParams({
    section_id: SHOP_SEARCH_SECTION_ID,
    q: query,
    'options[prefix]': 'last',
    type: 'product',
    page: String(pageNum),
  });
  const url = `${SHOP_SEARCH_BASE}?${params.toString()}`;
  const response = await fetch(url, { headers: SHOP_HTML_FETCH_HEADERS });
  const html = await response.text();
  if (!response.ok) {
    return { status: response.status, body: { error: 'upstream_error', detail: html.slice(0, 200) } };
  }
  return { status: 200, html };
}

async function fetchCollectionProductsJson(coll, pageNum, limitNum) {
  const url = `${SHOP_BASE}/${encodeURIComponent(coll)}/products.json?limit=${limitNum}&page=${pageNum}`;

  const response = await fetch(url, { headers: SHOP_FETCH_HEADERS });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return {
      status: 502,
      body: { error: 'invalid_json', detail: text.slice(0, 200) },
    };
  }

  if (!response.ok) {
    return { status: response.status, body: body ?? { error: 'upstream_error' } };
  }

  return { status: 200, body };
}

export async function handleMtgplaymatsProductsRequest({ collection, page, limit }) {
  const coll = (collection || 'all').trim() || 'all';
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(50, Math.max(1, Number(limit) || 24));

  try {
    return await fetchCollectionProductsJson(coll, pageNum, limitNum);
  } catch (error) {
    return {
      status: 502,
      body: {
        error: 'fetch_failed',
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export async function handleMtgplaymatsSearchRequest({ query, page }) {
  const q = (query || '').trim();
  if (!q) {
    return { status: 400, body: { error: 'missing_query' } };
  }

  const pageNum = Math.max(1, Number(page) || 1);

  try {
    const upstream = await fetchShopSearchSectionHtml(q, pageNum);
    if (upstream.status !== 200) {
      return upstream;
    }

    const parsed = parseSearchSectionHtml(upstream.html);
    const total = parsed.total ?? parsed.products.length;
    const lastPage = Math.max(1, Math.ceil(total / SHOP_SEARCH_PAGE_SIZE) || 1);

    return {
      status: 200,
      body: {
        products: parsed.products,
        page: pageNum,
        limit: SHOP_SEARCH_PAGE_SIZE,
        total,
        hasNext: pageNum < lastPage,
        lastPage,
      },
    };
  } catch (error) {
    return {
      status: 502,
      body: {
        error: 'fetch_failed',
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export async function handleMtgplaymatsProxyRequest(url) {
  if (!url) {
    return { status: 400, body: { error: 'missing_url' } };
  }

  const requestUrl = new URL(url, 'http://localhost');
  const pathname = requestUrl.pathname.replace(/^\/api\/mtgplaymats\/?/, '');

  if (pathname === 'products' || pathname.startsWith('products')) {
    return handleMtgplaymatsProductsRequest({
      collection: requestUrl.searchParams.get('collection'),
      page: requestUrl.searchParams.get('page'),
      limit: requestUrl.searchParams.get('limit'),
    });
  }

  if (pathname === 'search' || pathname.startsWith('search')) {
    return handleMtgplaymatsSearchRequest({
      collection: requestUrl.searchParams.get('collection'),
      query: requestUrl.searchParams.get('q'),
      page: requestUrl.searchParams.get('page'),
      limit: requestUrl.searchParams.get('limit'),
    });
  }

  return { status: 404, body: { error: 'not_found' } };
}
