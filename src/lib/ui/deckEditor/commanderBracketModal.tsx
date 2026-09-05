import { Component, For, Show } from 'solid-js';
import { Button } from '~/components/ui/button';
import {
  CommanderBracketEstimate,
  getBracketColor,
  getDisplayBracket,
} from '~/lib/commanderBracket';
import LoaderIcon from 'lucide-solid/icons/loader-circle';
import ExternalLinkIcon from 'lucide-solid/icons/external-link';

interface Props {
  open: boolean;
  loading: boolean;
  error?: string;
  result?: CommanderBracketEstimate;
  shareUrl?: string;
  onClose(): void;
}

const CommanderBracketModal: Component<Props> = props => {
  const analysis = () => props.result?.bracket_analysis;
  const bracket = () => getDisplayBracket(analysis());
  const bracketColor = () => getBracketColor(bracket());
  const validationIssues = () => [
    ...(props.result?.validation?.errors ?? []),
    ...(props.result?.validation?.warnings ?? []),
  ];

  return (
    <Show when={props.open}>
      <div class='fixed inset-0 z-[70] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm'>
        <div class='flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border bg-background shadow-xl'>
          <div class='flex items-start justify-between gap-4 border-b px-5 py-4'>
            <div>
              <h2 class='text-lg font-semibold'>Deck estimate</h2>
              <p class='text-sm text-muted-foreground'>
                Powered by{' '}
                <a
                  class='underline underline-offset-2'
                  href='https://commanderbracket.app/bracket'
                  target='_blank'
                  rel='noreferrer'>
                  CommanderBracket
                </a>
              </p>
            </div>
            <Button type='button' variant='ghost' onClick={props.onClose}>
              Close
            </Button>
          </div>

          <div class='min-h-0 flex-1 overflow-y-auto px-5 py-4'>
            <Show
              when={!props.loading}
              fallback={
                <div class='flex flex-col items-center gap-3 py-12 text-muted-foreground'>
                  <LoaderIcon class='size-6 animate-spin' />
                  <p>Analyzing deck…</p>
                </div>
              }>
              <Show
                when={!props.error}
                fallback={
                  <div class='rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive'>
                    {props.error}
                  </div>
                }>
                <Show when={props.result}>
                  <div class='space-y-5'>
                    <div class='grid gap-3 sm:grid-cols-3'>
                      <div class='rounded-lg border bg-card p-4'>
                        <div class='text-xs uppercase tracking-wide text-muted-foreground'>
                          Bracket
                        </div>
                        <div
                          class='mt-1 text-3xl font-bold'
                          style={{ color: bracketColor() ?? undefined }}>
                          {bracket() ?? '—'}
                        </div>
                      </div>
                      <div class='rounded-lg border bg-card p-4'>
                        <div class='text-xs uppercase tracking-wide text-muted-foreground'>
                          Speed
                        </div>
                        <div class='mt-1 text-3xl font-bold'>
                          {analysis()?.speed_bracket ?? '—'}
                        </div>
                      </div>
                      <div class='rounded-lg border bg-card p-4'>
                        <div class='text-xs uppercase tracking-wide text-muted-foreground'>
                          Warp
                        </div>
                        <div class='mt-1 text-3xl font-bold'>
                          {analysis()?.warp_bracket ?? '—'}
                        </div>
                      </div>
                    </div>

                    <Show when={analysis()?.bracket_description}>
                      <div>
                        <h3 class='mb-1 text-sm font-semibold'>Summary</h3>
                        <p class='text-sm text-muted-foreground'>{analysis()?.bracket_description}</p>
                        <Show when={analysis()?.bracket_reason}>
                          <p class='mt-2 text-sm'>{analysis()?.bracket_reason}</p>
                        </Show>
                      </div>
                    </Show>

                    <div class='grid gap-3 sm:grid-cols-2'>
                      <Show when={analysis()?.estimated_win_turn != null}>
                        <div class='rounded-lg border px-4 py-3 text-sm'>
                          <span class='text-muted-foreground'>Estimated win turn: </span>
                          <span class='font-medium'>{analysis()?.estimated_win_turn}</span>
                        </div>
                      </Show>
                      <Show when={props.result?.deck_health?.score != null}>
                        <div class='rounded-lg border px-4 py-3 text-sm'>
                          <span class='text-muted-foreground'>Deck health: </span>
                          <span class='font-medium'>{props.result?.deck_health?.score}</span>
                        </div>
                      </Show>
                      <Show when={analysis()?.total_game_changers != null}>
                        <div class='rounded-lg border px-4 py-3 text-sm'>
                          <span class='text-muted-foreground'>Game changers: </span>
                          <span class='font-medium'>{analysis()?.total_game_changers}</span>
                        </div>
                      </Show>
                      <Show when={props.result?.commander_analysis?.name}>
                        <div class='rounded-lg border px-4 py-3 text-sm'>
                          <span class='text-muted-foreground'>Commander: </span>
                          <span class='font-medium'>{props.result?.commander_analysis?.name}</span>
                        </div>
                      </Show>
                    </div>

                    <Show when={validationIssues().length > 0}>
                      <div>
                        <h3 class='mb-2 text-sm font-semibold text-destructive'>Decklist notes</h3>
                        <ul class='list-disc space-y-1 pl-5 text-sm text-destructive'>
                          <For each={validationIssues()}>{issue => <li>{issue.message}</li>}</For>
                        </ul>
                      </div>
                    </Show>

                    <Show when={props.result?.strengths?.length}>
                      <div>
                        <h3 class='mb-2 text-sm font-semibold'>Strengths</h3>
                        <ul class='list-disc space-y-1 pl-5 text-sm text-muted-foreground'>
                          <For each={props.result!.strengths!.slice(0, 5)}>
                            {item => <li>{item}</li>}
                          </For>
                        </ul>
                      </div>
                    </Show>

                    <Show when={props.result?.weaknesses?.length}>
                      <div>
                        <h3 class='mb-2 text-sm font-semibold'>Weaknesses</h3>
                        <ul class='list-disc space-y-1 pl-5 text-sm text-muted-foreground'>
                          <For each={props.result!.weaknesses!.slice(0, 5)}>
                            {item => <li>{item}</li>}
                          </For>
                        </ul>
                      </div>
                    </Show>
                  </div>
                </Show>
              </Show>
            </Show>
          </div>

          <Show when={props.shareUrl}>
            <div class='border-t px-5 py-4'>
              <Button
                as='a'
                class='w-full'
                href={props.shareUrl}
                target='_blank'
                rel='noreferrer'
                disabled={props.loading}>
                <ExternalLinkIcon class='size-4' />
                View full analysis
              </Button>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
};

export default CommanderBracketModal;
