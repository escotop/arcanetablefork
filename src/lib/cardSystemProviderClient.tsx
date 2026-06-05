import { ParentProps, createSignal, onMount, Show, useContext } from 'solid-js';
import { CardSystemContext, CardSystemStoreContextType } from './cardSystemContext';
import { Dynamic } from 'solid-js/web';

export function CardSystemProviderClient(props: ParentProps) {
  const [Provider, setProvider] = createSignal<any>(null);

  onMount(async () => {
    const { CardSystemProvider } = await import('./deckStore');
    setProvider(() => CardSystemProvider);
  });

  return (
    <Dynamic component={Provider() ?? ((p: ParentProps) => <>{p.children}</>)}>
      {props.children}
    </Dynamic>
  );
}

export function useClientCardSystemContext() {
  const ctx = useContext(CardSystemContext);
  if (!ctx) return null; // SSR / pre-mount
  return ctx as CardSystemStoreContextType;
}
