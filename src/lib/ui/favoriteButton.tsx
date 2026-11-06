import { Component } from 'solid-js';
import BookmarkIcon from 'lucide-solid/icons/bookmark';
import { cn } from '~/lib/cnUtil';

/** Round bookmark toggle meant to sit in the top-right corner of a picker tile. */
export const FavoriteButton: Component<{
  active: boolean;
  onToggle: () => void;
  class?: string;
  addLabel?: string;
  removeLabel?: string;
}> = props => {
  const label = () =>
    props.active
      ? (props.removeLabel ?? 'Remove from favorites')
      : (props.addLabel ?? 'Save as favorite');
  return (
    <button
      type='button'
      class={cn(
        'absolute right-4 top-4 z-10 flex size-8 items-center justify-center rounded-full bg-black/55 text-white shadow-md transition-colors hover:bg-black/75',
        props.active && 'bg-primary text-primary-foreground hover:bg-primary/85',
        props.class,
      )}
      aria-label={label()}
      aria-pressed={props.active}
      title={label()}
      onClick={event => {
        event.stopPropagation();
        props.onToggle();
      }}>
      <BookmarkIcon class='size-4' fill={props.active ? 'currentColor' : 'none'} />
    </button>
  );
};
