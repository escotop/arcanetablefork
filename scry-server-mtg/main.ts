import { cacheMetrics, withCaching } from './caching.ts';
import app from './server.ts';
import { parseArgs } from 'jsr:@std/cli/parse-args';

app.get('/_cache/stats', c => c.json(cacheMetrics.snapshot()));

const args = parseArgs(Deno.args, { default: { port: 8788 } });
const PORT = Number(args.port);

console.log(`\nDev proxy listening on http://localhost:${PORT}`);

Deno.serve({ port: PORT }, withCaching(app, 'mtg-system-v17'));
