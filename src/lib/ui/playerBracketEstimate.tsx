import { Component, createEffect, createSignal, Show } from 'solid-js';
import { resolveInGamePlayerBracket } from '../gamePlayerBracket';
import BracketEstimateTag from './bracketEstimateTag';

const PlayerBracketEstimate: Component<{
  clientId: number;
  gameId: string;
  active: boolean;
}> = props => {
  const [bracket, setBracket] = createSignal<number | undefined>();
  const [loading, setLoading] = createSignal(false);

  createEffect(() => {
    const gameId = props.gameId;
    const clientId = props.clientId;
    if (!props.active || !gameId) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setBracket(undefined);

    void resolveInGamePlayerBracket(clientId, gameId).then(value => {
      if (cancelled) return;
      setBracket(value);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  });

  return (
    <div class='mt-0.5 min-h-[1.125rem]'>
      <Show when={loading()}>
        <span class='text-xs text-muted-foreground'>Estimating bracket…</span>
      </Show>
      <Show when={!loading()}>
        <BracketEstimateTag bracket={bracket()} />
      </Show>
    </div>
  );
};

export default PlayerBracketEstimate;
