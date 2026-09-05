import * as Comlink from 'comlink';

function getNearestPowerOfTwo(value: number) {
  return Math.pow(2, Math.round(Math.log2(value)));
}

async function decodeTextureBlob(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'flipY' });
  } catch {
    const bitmap = await createImageBitmap(blob);
    const offscreenCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = offscreenCanvas.getContext('2d');
    if (!ctx) return bitmap;

    ctx.translate(0, bitmap.height);
    ctx.scale(1, -1);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return createImageBitmap(offscreenCanvas);
  }
}

const TextureLoaderWorkerObj = {
  async loadTexture(url: string) {
    const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!response.ok) {
      throw new Error(`Failed to fetch texture: ${response.status}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType && !contentType.startsWith('image/')) {
      throw new Error(`Unexpected content type: ${contentType}`);
    }

    const image = await decodeTextureBlob(await response.blob());

    const width = getNearestPowerOfTwo(image.width);
    const height = getNearestPowerOfTwo(image.height);

    const offscreenCanvas = new OffscreenCanvas(width, height);

    const ctx = offscreenCanvas.getContext('2d');
    ctx?.drawImage(image, 0, 0, width, height);
    image.close();

    const blob = await offscreenCanvas.convertToBlob({ type: 'image/png' });
    return createImageBitmap(blob);
  },
};

export type TextureLoaderWorkerType = typeof TextureLoaderWorkerObj;

Comlink.expose(TextureLoaderWorkerObj);
