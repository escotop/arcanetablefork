const MPCFILL_API_BASE = 'https://mpcfill.com';
const EXPLORE_PAGE_SIZE_MAX = 60;

const FETCH_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'User-Agent': 'UntappedTable/1.0 (mpcfill cardback picker)',
};

let cachedSources = null;
let cachedSourcesAt = 0;
const SOURCES_CACHE_MS = 10 * 60 * 1000;

async function fetchMpcfillSources() {
  const now = Date.now();
  if (cachedSources && now - cachedSourcesAt < SOURCES_CACHE_MS) {
    return { status: 200, sources: cachedSources };
  }

  const response = await fetch(`${MPCFILL_API_BASE}/2/sources/`, {
    headers: { Accept: 'application/json', 'User-Agent': FETCH_HEADERS['User-Agent'] },
  });
  const body = await response.json();
  if (!response.ok) {
    return { status: response.status, body };
  }

  const sources = Object.values(body.results ?? {}).map(source => [source.pk, true]);
  cachedSources = sources;
  cachedSourcesAt = now;
  return { status: 200, sources };
}

function buildExploreSearchBody({ query, pageStart, pageSize }) {
  return {
    sortBy: 'dateCreatedDescending',
    query: query ?? '',
    cardTypes: ['CARDBACK'],
    pageStart,
    pageSize,
    searchSettings: {
      searchTypeSettings: { fuzzySearch: true, filterCardbacks: false },
      filterSettings: {
        minimumDPI: 0,
        maximumDPI: 1500,
        maximumSize: 30,
        languages: [],
        includesTags: [],
        excludesTags: ['NSFW'],
      },
      sourceSettings: { sources: [] },
    },
  };
}

export async function handleMpcfillExploreRequest({ query, page, limit }) {
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(
    EXPLORE_PAGE_SIZE_MAX,
    Math.max(1, Number(limit) || 24),
  );
  const pageStart = (pageNum - 1) * limitNum;

  try {
    const sourcesResult = await fetchMpcfillSources();
    if (sourcesResult.status !== 200) {
      return sourcesResult;
    }

    const exploreBody = buildExploreSearchBody({
      query: (query ?? '').trim(),
      pageStart,
      pageSize: limitNum,
    });
    exploreBody.searchSettings.sourceSettings.sources = sourcesResult.sources;

    const response = await fetch(`${MPCFILL_API_BASE}/2/exploreSearch/`, {
      method: 'POST',
      headers: FETCH_HEADERS,
      body: JSON.stringify(exploreBody),
    });

    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return { status: 502, body: { error: 'invalid_json', detail: text.slice(0, 200) } };
    }

    if (!response.ok) {
      return { status: response.status, body };
    }

    const total = body.count ?? 0;
    const lastPage = Math.max(1, Math.ceil(total / limitNum) || 1);

    return {
      status: 200,
      body: {
        cards: body.cards ?? [],
        page: pageNum,
        limit: limitNum,
        total,
        hasNext: pageStart + (body.cards?.length ?? 0) < total,
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

export async function handleMpcfillProxyRequest(url) {
  if (!url) {
    return { status: 400, body: { error: 'missing_url' } };
  }

  const requestUrl = new URL(url, 'http://localhost');
  const pathname = requestUrl.pathname.replace(/^\/api\/mpcfill\/?/, '');

  if (pathname === 'explore' || pathname.startsWith('explore')) {
    return handleMpcfillExploreRequest({
      query: requestUrl.searchParams.get('q') ?? '',
      page: requestUrl.searchParams.get('page'),
      limit: requestUrl.searchParams.get('limit'),
    });
  }

  return { status: 404, body: { error: 'not_found' } };
}
