import { A, useParams } from '@solidjs/router';
import { createEffect, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import BrandingHeader from '~/components/branding/header';
import MetaTags from '~/lib/meta-tags';
import { createRecordFromLoader } from '~/lib/spark/routes';

export default function ChangesPage() {
  const params = useParams();

  const [change] = createRecordFromLoader(
    params.slug,
    () => import(`~/../content/changes/${params.slug}.mdx`),
  );

  return (
    <div class='bg-gray-900 text-white font-sans' style={`min-height: 100dvh;`}>
      <div class='max-w-7xl mx-auto px-6 lg:px-8 flex flex-col gap-8'>
        <BrandingHeader />
        <MetaTags />
        <div class='mx-auto flex flex-col'>
          <Show when={change()}>
            <article class='flex flex-col gap-4 border-b border-gray-800 last:border-0'>
              <A href='/changes'>Changes /</A>
              <h1 class='text-3xl font-bold text-white'>{change().title}</h1>
              {/* Header */}
              <div class='flex items-start justify-between gap-4 flex-wrap'>
                <div class='flex flex-col gap-2'>
                  <div class='flex items-center gap-3 flex-wrap'>
                    <span
                      class={`text-s font-semibold px-2 py-1 rounded-full ${
                        change().target === 'stable'
                          ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-600/30'
                          : 'bg-amber-600/20 text-amber-400 border border-amber-600/30'
                      }`}>
                      {change().target}
                    </span>
                    <Show when={change().version !== 'unknown'}>
                      <code class='text-xs text-gray-400 font-mono'>{change().version}</code>
                    </Show>
                    <time class='text-sm text-gray-400'>{change().date}</time>
                  </div>
                  <p class='text-gray-400 text-sm max-w-2xl'>{change().description}</p>
                </div>
                {/* Change count badges */}
                <div class='flex gap-3 shrink-0'>
                  <Show when={change().changeCount?.features > 0}>
                    <span class='flex items-center gap-1.5 text-sm text-emerald-400'>
                      <span class='w-2 h-2 rounded-full bg-emerald-400' />
                      {change().changeCount.features}{' '}
                      {change().changeCount.features === 1 ? 'feature' : 'features'}
                    </span>
                  </Show>
                  <Show when={change().changeCount?.bugfixes > 0}>
                    <span class='flex items-center gap-1.5 text-sm text-rose-400'>
                      <span class='w-2 h-2 rounded-full bg-rose-400' />
                      {change().changeCount.bugfixes}{' '}
                      {change().changeCount.bugfixes === 1 ? 'fix' : 'fixes'}
                    </span>
                  </Show>
                </div>
              </div>
              <Show when={change().Content}>
                <Dynamic component={change().Content} />
              </Show>
              {/* Commit range link */}
              <Show when={change().commitRange}>
                <a
                  href={change().commitRange}
                  target='_blank'
                  rel='noopener noreferrer'
                  class='text-xs text-gray-400 hover:text-gray-100 transition font-mono'>
                  view commits →
                </a>
              </Show>
            </article>
          </Show>
        </div>
      </div>
    </div>
  );
}
