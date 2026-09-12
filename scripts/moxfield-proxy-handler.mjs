import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const MOXFIELD_API = 'https://api.moxfield.com';

const MOXFIELD_HEADERS = {
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.moxfield.com/',
};

function parseMoxfieldBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: 'invalid_json', detail: text.slice(0, 200) };
  }
}

async function fetchMoxfieldViaCurl(path) {
  const url = `${MOXFIELD_API}${path}`;

  try {
    const { stdout, stderr } = await execAsync(
      `curl -sS "${url}" -H "Accept: application/json" -H "User-Agent: ${MOXFIELD_HEADERS['User-Agent']}" -H "Accept-Language: en-US,en;q=0.9" -H "Referer: https://www.moxfield.com/"`,
      { maxBuffer: 10 * 1024 * 1024 },
    );

    if (stderr) {
      return {
        status: 500,
        body: { error: 'curl_error', detail: stderr },
      };
    }

    return {
      status: 200,
      body: parseMoxfieldBody(stdout),
    };
  } catch (error) {
    return {
      status: 500,
      body: { error: 'exec_failed', detail: error.message },
    };
  }
}

async function fetchMoxfieldViaFetch(path) {
  const url = `${MOXFIELD_API}${path}`;

  try {
    const response = await fetch(url, { headers: MOXFIELD_HEADERS });
    const text = await response.text();

    return {
      status: response.status,
      body: parseMoxfieldBody(text),
    };
  } catch (error) {
    return {
      status: 500,
      body: { error: 'fetch_failed', detail: error.message },
    };
  }
}

async function fetchMoxfield(path) {
  const fetched = await fetchMoxfieldViaFetch(path);
  const body = fetched.body;

  if (
    !process.env.VERCEL &&
    typeof body === 'object' &&
    body &&
    'error' in body &&
    (body.error === 'invalid_json' || body.error === 'fetch_failed')
  ) {
    return fetchMoxfieldViaCurl(path);
  }

  return fetched;
}

export async function handleMoxfieldUserDecksRequest(username, pageNumber = '1', pageSize = '100') {
  const normalized = username?.trim();
  if (!normalized) {
    return { status: 400, body: { error: 'missing_username' } };
  }

  const params = new URLSearchParams({
    pageNumber: String(pageNumber),
    pageSize: String(Math.min(Number(pageSize) || 100, 100)),
  });

  return fetchMoxfield(
    `/v2/users/${encodeURIComponent(normalized)}/decks?${params.toString()}`,
  );
}

export async function handleMoxfieldDeckRequest(publicId) {
  const normalized = publicId?.trim();
  if (!normalized) {
    return { status: 400, body: { error: 'missing_public_id' } };
  }

  return fetchMoxfield(`/v2/decks/all/${encodeURIComponent(normalized)}`);
}

export async function handleMoxfieldProxyRequest(url) {
  if (!url) {
    return { status: 400, body: { error: 'missing_path' } };
  }

  const requestUrl = new URL(url, 'http://localhost');
  const pathname = requestUrl.pathname.replace(/^\/api\/moxfield/, '');
  const search = requestUrl.search || '';

  if (pathname.startsWith('/v2/')) {
    return fetchMoxfield(`${pathname}${search}`);
  }

  if (pathname.startsWith('/users/') && pathname.endsWith('/decks')) {
    const username = decodeURIComponent(pathname.slice('/users/'.length, -'/decks'.length));
    return handleMoxfieldUserDecksRequest(
      username,
      requestUrl.searchParams.get('pageNumber') ?? '1',
      requestUrl.searchParams.get('pageSize') ?? '100',
    );
  }

  if (pathname.startsWith('/decks/')) {
    const publicId = decodeURIComponent(pathname.slice('/decks/'.length));
    return handleMoxfieldDeckRequest(publicId);
  }

  return { status: 404, body: { error: 'not_found' } };
}
