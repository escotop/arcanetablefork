import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import path from 'node:path';
import { handleImageProxyRequest } from './scripts/image-proxy-handler.mjs';

function imageProxyDevPlugin() {
  return {
    name: 'image-proxy-dev',
    enforce: 'pre' as const,
    configureServer(server: { middlewares: { use: (fn: (req: any, res: any, next: () => void) => void) => void } }) {
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

export default defineConfig({
  plugins: [solid(), solidSvg(), imageProxyDevPlugin()],
  publicDir: path.resolve(__dirname, './public'),
  resolve: {
    alias: {
      '~': path.resolve(__dirname, './src'),
      '@sentry/solidstart': path.resolve(__dirname, './src/lib/sentry-stub.ts'),
    },
    dedupe: ['yjs'],
  },
  server: { port: 3001 },
  build: { target: 'esnext' },
});
