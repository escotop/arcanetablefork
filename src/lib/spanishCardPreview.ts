import { createSignal } from 'solid-js';
import { Card } from './constants';
import { createCardFrontMaterial } from './card';
import { fetchCardPrintings, getPrintingPreviewUrl, supportsCardPrintings } from './deck';
import { cardsById, textureLoaderWorker } from './globals';

export const SPANISH_PREVIEW_NOT_FOUND_MESSAGE = 'No esta en spanish. Haber estudiao';

export type SpanishPreviewUiState =
  | { cardId: string; phase: 'loading' }
  | { cardId: string; phase: 'not-found' };

export const [spanishPreviewUi, setSpanishPreviewUi] = createSignal<SpanishPreviewUiState>();

let activeCardId: string | undefined;
let applyGeneration = 0;

function getCardSet(card: Card) {
  return (card.detail as { set?: string }).set;
}

export async function fetchSpanishPrintingImageUrl(card: Card): Promise<string | undefined> {
  if (!supportsCardPrintings() || !card.detail?.name) return;

  const name = card.detail.name;
  const set = getCardSet(card);
  const result = await fetchCardPrintings(
    name,
    1,
    `lang:es !"${name.replace(/"/g, '\\"')}" unique:prints`,
  );
  const prints = result.data.filter(entry => entry.name === name);
  const match =
    (set ? prints.find(entry => entry.set?.toLowerCase() === set.toLowerCase()) : undefined) ??
    prints[0];

  return match ? getPrintingPreviewUrl(match) : undefined;
}

async function loadFrontMaterial(url: string) {
  const image = await textureLoaderWorker.loadTexture(url);
  return createCardFrontMaterial(image);
}

export function clearSpanishPreviewForCard(cardId?: string) {
  if (cardId && activeCardId === cardId) {
    clearSpanishPreview();
  }
}

export function clearSpanishPreview() {
  setSpanishPreviewUi(undefined);

  if (!activeCardId) return;

  const card = cardsById.get(activeCardId);
  const mesh = card?.mesh;
  if (mesh?.userData.spanishPreviewSavedMat) {
    const previewMat = mesh.material[4];
    mesh.material[4] = mesh.userData.spanishPreviewSavedMat;
    mesh.material[4].needsUpdate = true;
    if (previewMat && previewMat !== mesh.userData.spanishPreviewSavedMat) {
      previewMat.dispose();
    }
    mesh.userData.card_face_urls[0] = mesh.userData.spanishPreviewSavedUrl;
    delete mesh.userData.spanishPreviewSavedMat;
    delete mesh.userData.spanishPreviewSavedUrl;
  }

  activeCardId = undefined;
  applyGeneration++;
}

export async function activateSpanishPreview(cardId: string) {
  if (!supportsCardPrintings()) return;

  const card = cardsById.get(cardId);
  if (!card?.mesh) return;

  const ui = spanishPreviewUi();
  if (activeCardId === cardId && ui?.phase === 'loading') return;

  clearSpanishPreview();
  activeCardId = cardId;
  const generation = ++applyGeneration;
  setSpanishPreviewUi({ cardId, phase: 'loading' });

  const imageUrl = await fetchSpanishPrintingImageUrl(card);
  if (generation !== applyGeneration || activeCardId !== cardId) return;

  if (!imageUrl) {
    setSpanishPreviewUi({ cardId, phase: 'not-found' });
    return;
  }

  setSpanishPreviewUi(undefined);

  const mesh = card.mesh;
  if (!mesh.userData.spanishPreviewSavedMat) {
    mesh.userData.spanishPreviewSavedMat = mesh.material[4];
    mesh.userData.spanishPreviewSavedUrl = mesh.userData.card_face_urls[0];
  }

  const mat = await loadFrontMaterial(imageUrl);
  if (generation !== applyGeneration || activeCardId !== cardId) {
    mat.dispose();
    return;
  }

  mesh.material[4] = mat;
  mesh.material[4].needsUpdate = true;
}

export function isSpanishPreviewUiForCard(cardId?: string) {
  const ui = spanishPreviewUi();
  return !!cardId && ui?.cardId === cardId;
}
