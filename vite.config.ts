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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      solidStart(),
      sentryVitePlugin(),
      sitemapPlugin({
        hostname: env.VITE_SITE_URL,
      }),
      nitroV2Plugin({
        preset: 'static',
        prerender: {
          routes: ['/', '/changes'],
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
    build: { target: 'esnext', sourcemap: true },
  };
});
