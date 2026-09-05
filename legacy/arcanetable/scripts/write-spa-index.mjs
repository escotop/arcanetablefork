import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const publicDir = join(process.cwd(), '.output/public');
const assetsDir = join(publicDir, '_build/assets');

function pickAsset(prefix, extension) {
  return readdirSync(assetsDir).find(
    file =>
      file.startsWith(prefix) &&
      file.endsWith(extension) &&
      !file.endsWith(`${extension}.br`) &&
      !file.endsWith(`${extension}.gz`),
  );
}

const entryJs = pickAsset('entry-client-', '.js');
const entryCss = pickAsset('entry-client-', '.css');

if (!entryJs) {
  console.error('[write-spa-index] No entry-client bundle found in', assetsDir);
  process.exit(1);
}

const cssLink = entryCss
  ? `  <link rel="stylesheet" href="/_build/assets/${entryCss}" />\n`
  : '';

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="manifest" href="/site.webmanifest" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <meta name="msapplication-TileColor" content="#da532c" />
    <meta name="theme-color" content="#ffffff" />
${cssLink}    <title>Arcanetable</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/_build/assets/${entryJs}"></script>
  </body>
</html>
`;

writeFileSync(join(publicDir, 'index.html'), html);
console.log('[write-spa-index] Wrote', join(publicDir, 'index.html'));
