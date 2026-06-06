import { createEffect, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import MetaTags from '~/lib/meta-tags';
import { createRecordsFromGlob } from '~/lib/spark/routes';

export default function Changes() {
  const [changes] = createRecordsFromGlob(import.meta.glob(`~/../content/changes/*`), {
    sort: '-date,-target',
  });

  createEffect(() => {
    console.log({ changes: changes() });
  });

  return (
    <div class='bg-gray-900 text-white font-sans'>
      <div class='max-w-7xl mx-auto px-6 lg:px-8 flex flex-col gap-8'>
        <MetaTags />
        <div class='mx-auto flex flex-col'>
          <For each={changes()}>{change => <ChangeEntry change={change} />}</For>
        </div>
      </div>
    </div>
  );
}

function ChangeEntry(props: { change: any }) {
  return (
    <article class='flex flex-col gap-4 py-10 border-b border-gray-800 last:border-0'>
      {/* Header */}
      <div class='flex items-start justify-between gap-4 flex-wrap'>
        <div class='flex flex-col gap-2'>
          <div class='flex items-center gap-3 flex-wrap'>
            <span
              class={`text-s font-semibold px-2 py-1 rounded-full ${
                props.change.target === 'stable'
                  ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-600/30'
                  : 'bg-amber-600/20 text-amber-400 border border-amber-600/30'
              }`}>
              {props.change.target}
            </span>
            <Show when={props.change.version !== 'unknown'}>
              <code class='text-xs text-gray-400 font-mono'>{props.change.version}</code>
            </Show>
            <time class='text-sm text-gray-400'>{props.change.date}</time>
          </div>
          <h2 class='text-xl font-bold text-white'>{props.change.title}</h2>
          <p class='text-gray-400 text-sm max-w-2xl'>{props.change.description}</p>
        </div>
        {/* Change count badges */}
        <div class='flex gap-3 shrink-0'>
          <Show when={props.change.changeCount?.features > 0}>
            <span class='flex items-center gap-1.5 text-sm text-emerald-400'>
              <span class='w-2 h-2 rounded-full bg-emerald-400' />
              {props.change.changeCount.features}{' '}
              {props.change.changeCount.features === 1 ? 'feature' : 'features'}
            </span>
          </Show>
          <Show when={props.change.changeCount?.bugfixes > 0}>
            <span class='flex items-center gap-1.5 text-sm text-rose-400'>
              <span class='w-2 h-2 rounded-full bg-rose-400' />
              {props.change.changeCount.bugfixes}{' '}
              {props.change.changeCount.bugfixes === 1 ? 'fix' : 'fixes'}
            </span>
          </Show>
        </div>
      </div>
      {/* MDX body */}
      <Show when={props.change.Content}>
        {/*<div
          class='prose prose-invert prose-sm max-w-none
          prose-headings:text-white prose-headings:font-semibold
          prose-h2:text-base prose-h2:mt-6 prose-h2:mb-2
          prose-h3:text-sm prose-h3:text-gray-300
          prose-p:text-gray-400 prose-p:leading-relaxed
          prose-li:text-gray-400
          prose-code:text-indigo-300 prose-code:bg-gray-800 prose-code:px-1 prose-code:rounded
          prose-a:text-indigo-400 prose-a:no-underline hover:prose-a:underline'>*/}
          <Dynamic component={props.change.Content} />
        {/*</div>*/}
      </Show>
      {/* Commit range link */}
      <Show when={props.change.commitRange}>
        <a
          href={props.change.commitRange}
          target='_blank'
          rel='noopener noreferrer'
          class='text-xs text-gray-400 hover:text-gray-100 transition font-mono'>
          view commits →
        </a>
      </Show>
    </article>
  );
}
