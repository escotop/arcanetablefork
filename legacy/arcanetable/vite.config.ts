import { solidStart } from '@solidjs/start/config';
import { defineConfig, loadEnv } from 'vite';
import { nitroV2Plugin } from '@solidjs/vite-plugin-nitro-2';
import solidSvg from 'vite-plugin-solid-svg';
import { compression } from 'vite-plugin-compression2';
import path from 'node:path';
import mdx from '@mdx-js/rollup';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMDXFrontmatter from 'remark-mdx-frontmatter';
import yaml from '@modyfi/vite-plugin-yaml';
import remarkHasBody from './src/lib/spark/remark-has-body';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import sitemapPlugin from 'vite-plugin-sitemap';
import { writeFileSync } from 'node:fs';
import { handleImageProxyRequest } from './scripts/image-proxy-handler.mjs';

function imageProxyDevPlugin() {
  return {
    name: 'image-proxy-dev',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/image-proxy')) {
          next();
          return;
        }

        const requestUrl = new URL(req.url, 'http://localhost');
        const result = await handleImageProxyRequest(requestUrl.searchParams.get('uri'));
        const headers = result.headers ?? { 'Content-Type': 'text/plain; charset=utf-8' };
        res.statusCode = result.status;
        for (const [key, value] of Object.entries(headers)) {
          res.setHeader(key, value);
        }
        res.end(result.body);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const hostname =
    env.VITE_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ||
    'http://localhost:3000';
  let nitro;

  return {
    plugins: [
      solidStart(),
      imageProxyDevPlugin(),
      ...(env.SENTRY_AUTH_TOKEN ? [sentryVitePlugin()] : []),
      sitemapPlugin({ hostname }),
      nitroV2Plugin({
        preset: 'static',
        prerender: {
          crawlLinks: true,
          routes: ['/', '/changes'],
        },
        hooks: {
          'prerender:generate'(_route, _nitro) {
            nitro = _nitro; // main nitro; gives us the output dir
          },
          'prerender:done'({ prerenderedRoutes }) {
            if (!nitro) return;
            const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
            const urls = [
              ...new Set(
                prerenderedRoutes
                  .filter(
                    r =>
                      !r.error &&
                      (r.contentType?.includes('html') || r.fileName?.endsWith('.html')),
                  )
                  .map(r => new URL(r.route, hostname).href),
              ),
            ];

            const xml =
              `<?xml version="1.0" encoding="UTF-8"?>\n` +
              `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
              urls.map(u => `  <url><loc>${esc(u)}</loc></url>`).join('\n') +
              `\n</urlset>\n`;

            writeFileSync(path.join(nitro.options.output.publicDir, 'sitemap.xml'), xml);
          },
        },
      }),
      {
        ...mdx({
          jsxImportSource: 'solid-jsx',
          remarkPlugins: [remarkGfm, remarkFrontmatter, remarkHasBody, remarkMDXFrontmatter],
        }),
        enforce: 'pre',
      },
      yaml(),
      solidSvg(),
      compression(),
      compression({ algorithm: 'brotliCompress' }),
    ],
    resolve: {
      alias: { '~': path.resolve(__dirname, './src') },
    },
    server: { port: 3000, allowedHosts: true },
    build: { target: 'esnext', sourcemap: true, minify: false },
  };
});
