import { solidStart } from '@solidjs/start/config';
import { defineConfig } from 'vite';
import { nitroV2Plugin } from '@solidjs/vite-plugin-nitro-2';
import solidSvg from 'vite-plugin-solid-svg';
import { compression } from 'vite-plugin-compression2';
import path from 'node:path';
import fs from 'node:fs';
import mdx from '@mdx-js/rollup';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMDXFrontmatter from 'remark-mdx-frontmatter';
import yaml from '@modyfi/vite-plugin-yaml';
import remarkHasBody from './src/lib/spark/remark-has-body';

export default defineConfig({
  plugins: [
    solidStart(),
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
});
