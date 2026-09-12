import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const MOXFIELD_API = 'https://api.moxfield.com';

async function fetchMoxfield(path) {
  const url = `${MOXFIELD_API}${path}`;
  
  try {
    const { stdout, stderr } = await execAsync(
      `curl -s "${url}" -H "Accept: application/json" -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" -H "Accept-Language: en-US,en;q=0.9" -H "Referer: https://www.moxfield.com/"`,
      { maxBuffer: 10 * 1024 * 1024 } // 10MB buffer
    );
    
    if (stderr) {
      return {
        status: 500,
        body: { error: 'curl_error', detail: stderr },
      };
    }

    let body;
    try {
      body = stdout ? JSON.parse(stdout) : null;
    } catch {
      body = { error: 'invalid_json', detail: stdout.slice(0, 200) };
    }

    return {
      status: 200,
      body,
    };
  } catch (error) {
    return {
      status: 500,
      body: { error: 'exec_failed', detail: error.message },
    };
  }
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
