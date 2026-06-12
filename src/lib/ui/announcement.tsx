import { Show } from 'solid-js';
import { announcement } from '../globals';

export default function Announcement() {
  return (
    <Show when={announcement()}>
      <div class='fixed z-100 inset-0 flex justify-center'>
        <div class='text-7xl text-shadow' style='margin-top: 30lvh'>
          {announcement()}
        </div>
        <div />
      </div>
    </Show>
  );
}
