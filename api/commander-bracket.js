const UPSTREAM = 'https://mtg-assistant.up.railway.app/decks/analyze-complete';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ error: 'Invalid JSON body' });
      return;
    }
  }

  try {
    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'untapped-table/0.1',
      },
      body: JSON.stringify(body ?? {}),
    });

    const text = await upstream.text();
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
    res.status(upstream.status).send(text);
  } catch (error) {
    res.status(502).json({
      error: 'upstream_error',
      detail: error instanceof Error ? error.message : 'Failed to reach CommanderBracket.',
    });
  }
}
