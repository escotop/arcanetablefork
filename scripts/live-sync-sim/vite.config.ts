import path from 'node:path';
import type { Plugin } from 'vite';
import solid from 'vite-plugin-solid';
import { defineConfig } from 'vite';

const root = path.resolve(import.meta.dirname, '../..');
const soundsStub = path.resolve(import.meta.dirname, './recordingSounds.ts');

/** Replace the real sound module with one that records every call, so the sim can tell "heard" from "seen". */
function recordSoundsPlugin(): Plugin {
  return {
    name: 'record-sounds-for-live-sim',
    enforce: 'pre',
    resolveId(source) {
      if (
        source === './sounds' ||
        source === '../sounds' ||
        source === './lib/sounds' ||
        source.endsWith('/lib/sounds') ||
        source.endsWith('/lib/sounds.ts')
      ) {
        return soundsStub;
      }
      return null;
    },
  };
}

export default defineConfig({
  root,
  plugins: [recordSoundsPlugin(), solid({ ssr: true })],
  resolve: {
    alias: {
      '~': path.resolve(root, './src'),
      '@sentry/solidstart': path.resolve(root, './src/lib/sentry-stub.ts'),
      '@solid-refresh': path.resolve(root, './src/lib/testing-solid-refresh-stub.ts'),
      [path.resolve(root, './src/main3d.ts')]: path.resolve(
        root,
        './src/lib/testing-main3d-stub.ts',
      ),
    },
    dedupe: ['yjs'],
  },
});
