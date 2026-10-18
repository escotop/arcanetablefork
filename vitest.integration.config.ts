import path from 'node:path';
import type { Plugin } from 'vite';
import solid from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;
const soundsStub = path.resolve(root, './src/lib/testing-sounds-stub.ts');

function stubSoundsPlugin(): Plugin {
  return {
    name: 'stub-sounds-for-headless',
    resolveId(source, importer) {
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

/** Vitest for headless multiplayer / 3D integration tests. */
export default defineConfig({
  plugins: [stubSoundsPlugin(), solid({ ssr: true })],
  test: {
    environment: 'jsdom',
    testTimeout: 180_000,
    deps: {
      optimizer: {
        web: {
          include: ['solid-js', 'solid-js/store'],
        },
      },
    },
  },
  resolve: {
    alias: {
      '~': path.resolve(import.meta.dirname, './src'),
      '@sentry/solidstart': path.resolve(import.meta.dirname, './src/lib/sentry-stub.ts'),
      '@solid-refresh': path.resolve(import.meta.dirname, './src/lib/testing-solid-refresh-stub.ts'),
      [path.resolve(import.meta.dirname, './src/main3d.ts')]: path.resolve(
        import.meta.dirname,
        './src/lib/testing-main3d-stub.ts',
      ),
    },
    dedupe: ['yjs'],
  },
});
