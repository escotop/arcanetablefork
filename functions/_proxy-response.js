export function textResponse(result, extraHeaders = {}) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    ...extraHeaders,
  };

  if (result.headers) {
    for (const [key, value] of Object.entries(result.headers)) {
      headers[key] = value;
    }
  } else if (result.contentType) {
    headers['Content-Type'] = result.contentType;
  }

  return new Response(result.body ?? '', {
    status: result.status,
    headers,
  });
}

export function jsonResponse(result, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    ...extraHeaders,
  };

  if (result.headers) {
    for (const [key, value] of Object.entries(result.headers)) {
      headers[key] = value;
    }
  }

  const body =
    typeof result.body === 'string' ? result.body : JSON.stringify(result.body ?? {});

  return new Response(body, {
    status: result.status,
    headers,
  });
}

export function binaryResponse(result, extraHeaders = {}) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    ...extraHeaders,
  };

  if (result.headers) {
    for (const [key, value] of Object.entries(result.headers)) {
      headers[key] = value;
    }
  }

  return new Response(result.body, {
    status: result.status,
    headers,
  });
}

export async function readRequestBody(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const text = await request.text();
  return text.length ? text : undefined;
}
