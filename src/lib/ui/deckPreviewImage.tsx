import { Component, createEffect, createMemo, createSignal } from 'solid-js';
import { Deck } from '../constants';
import {
  DEFAULT_DECK_PREVIEW,
  fetchDeckPreviewDirectUrl,
  getDeckPreviewImageUrlCandidates,
} from '../deckCoverPreview';

export const DeckPreviewImage: Component<{
  deck: Deck;
  class?: string;
  alt?: string;
  onResolvedCover?: (url: string) => void;
}> = props => {
  const [attempt, setAttempt] = createSignal(0);
  const [fetchedUrl, setFetchedUrl] = createSignal<string | undefined>();

  const candidates = createMemo(() => {
    const list: string[] = [];
    const fetched = fetchedUrl();
    if (fetched) list.push(fetched);
    for (const url of getDeckPreviewImageUrlCandidates(props.deck)) {
      if (!list.includes(url)) list.push(url);
    }
    return list;
  });

  const src = createMemo(() => candidates()[attempt()] ?? DEFAULT_DECK_PREVIEW);

  createEffect(() => {
    props.deck.id;
    props.deck.coverImage;
    setAttempt(0);
    setFetchedUrl(undefined);
    void fetchDeckPreviewDirectUrl(props.deck).then(url => {
      if (url) {
        setFetchedUrl(url);
        props.onResolvedCover?.(url);
      }
    });
  });

  createEffect(() => {
    if (fetchedUrl()) setAttempt(0);
  });

  return (
    <img
      src={src()}
      alt={props.alt ?? ''}
      class={props.class}
      loading='lazy'
      decoding='async'
      referrerPolicy='no-referrer'
      onError={() => {
        const next = attempt() + 1;
        if (next < candidates().length) {
          setAttempt(next);
        }
      }}
    />
  );
};
