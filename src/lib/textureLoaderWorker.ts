import * as Comlink from 'comlink';

const MAX_CARD_TEXTURE_DIMENSION = 2048;

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

function clampTextureBitmap(bitmap: ImageBitmap): ImageBitmap {
  const { width, height } = bitmap;
  const maxDim = Math.max(width, height);
  if (maxDim <= MAX_CARD_TEXTURE_DIMENSION) return bitmap;

  const scale = MAX_CARD_TEXTURE_DIMENSION / maxDim;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const offscreenCanvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = offscreenCanvas.getContext('2d');
  if (!ctx) return bitmap;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();
  return createImageBitmap(offscreenCanvas);
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
    return clampTextureBitmap(image);
  },
};

export type TextureLoaderWorkerType = typeof TextureLoaderWorkerObj;

Comlink.expose(TextureLoaderWorkerObj);
