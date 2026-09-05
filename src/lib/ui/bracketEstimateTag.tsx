import { Component, Show } from 'solid-js';
import { getBracketColor, getBracketTagLabel } from '~/lib/commanderBracket';
import { cn } from '~/lib/cnUtil';

interface Props {
  bracket: number | undefined;
  class?: string;
}

const BracketEstimateTag: Component<Props> = props => (
  <Show when={props.bracket != null && getBracketTagLabel(props.bracket)}>
    <span
      class={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium leading-none text-white',
        props.class,
      )}
      style={{ 'background-color': getBracketColor(props.bracket) }}>
      {getBracketTagLabel(props.bracket)}
    </span>
  </Show>
);

export default BracketEstimateTag;
