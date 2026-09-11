/** Material Design "dice-d20-outline" silhouette (Apache 2.0), without face numerals. */
export default function D20Icon(props: { class?: string; 'aria-hidden'?: boolean }) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      stroke-width='1.5'
      stroke-linecap='round'
      stroke-linejoin='round'
      class={props.class}
      aria-hidden={props['aria-hidden'] ?? true}>
      <path d='M21 16.5V7.5a1 1 0 0 0-.53-.88L12.57 2.18a1 1 0 0 0-1.14 0L3.53 6.62A1 1 0 0 0 3 7.5v9a1 1 0 0 0 .53.88l7.9 4.44a1 1 0 0 0 1.14 0l7.9-4.44a1 1 0 0 0 .53-.88Z' />
      <path d='M12 4.15 5 8.09v7.82L12 19.85l7-3.94V8.09Z' />
      <path d='M12 4.15V19.85M5 8.09l7 3.94 7-3.94M5 15.91l7-3.94 7 3.94' />
    </svg>
  );
}
