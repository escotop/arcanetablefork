import * as Comlink from 'comlink';
import { textureLoaderWorkerApi, type TextureLoaderWorkerType } from './textureLoaderWorkerApi';

export type { TextureLoaderWorkerType };

Comlink.expose(textureLoaderWorkerApi);
