import { solidStart } from "@solidjs/start/config";
import { defineConfig } from "vite";
import { nitroV2Plugin } from "@solidjs/vite-plugin-nitro-2";
import solidSvg from 'vite-plugin-solid-svg';
import { compression } from 'vite-plugin-compression2';
import path from 'path';

export default defineConfig({
  plugins: [
    solidStart(),
    nitroV2Plugin({
      preset: "static",
      prerender: {
        routes: ['/']
      }
    }),
    solidSvg(),
    compression(),
    compression({ algorithm: 'brotliCompress' }),
  ],
  resolve: {
    alias: { '~': path.resolve(__dirname, './src') },
  },
  server: { port: 3000 },
  build: { target: 'esnext' },
});
