import { createSignal, For, Show } from 'solid-js';
import { Button } from '~/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { DetailedCardEntry } from '~/lib/constants';
import { CardPrintingOption, fetchCardPrintings, getPrintingLabel, getPrintingPreviewUrl } from '~/lib/deck';
import LoaderIcon from 'lucide-solid/icons/loader-circle';
import ChevronDownIcon from 'lucide-solid/icons/chevron-down';

interface Props {
  entry: DetailedCardEntry;
  onSelect(printing: CardPrintingOption): void;
}

export default function PrintingSelect(props: Props) {
  const [printings, setPrintings] = createSignal<CardPrintingOption[]>([]);
  const [page, setPage] = createSignal(0);
  const [totalPages, setTotalPages] = createSignal(0);
  const [loading, setLoading] = createSignal(false);

  const currentSet = () =>
    (props.entry.set || (props.entry.detail as { set?: string })?.set || '?').toLowerCase();

  async function loadPage(nextPage: number, append = false) {
    if (loading()) return;
    setLoading(true);
    try {
      const result = await fetchCardPrintings(props.entry.name, nextPage);
      setPrintings(append ? [...printings(), ...result.data] : result.data);
      setPage(result.page);
      setTotalPages(result.total_pages);
    } finally {
      setLoading(false);
    }
  }

  function onOpenChange(open: boolean) {
    if (open && printings().length === 0) {
      void loadPage(1);
    }
  }

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        as={Button<'button'>}
        size='sm'
        variant='secondary'
        class='h-7 gap-0.5 px-1.5 text-[10px] font-bold uppercase shadow-md'
        onClick={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}>
        {currentSet()}
        <ChevronDownIcon class='size-3 opacity-70' />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        class='max-h-72 w-72 overflow-y-auto slim-scroll p-1'
        onClick={e => e.stopPropagation()}>
        <Show
          when={!loading() || printings().length > 0}
          fallback={
            <div class='flex items-center justify-center gap-2 p-3 text-sm text-muted-foreground'>
              <LoaderIcon class='size-4 animate-spin' />
              Cargando…
            </div>
          }>
          <For each={printings()}>
            {printing => (
              <DropdownMenuItem
                class='flex items-center gap-2 p-1.5'
                onSelect={() => props.onSelect(printing)}>
                <img
                  src={getPrintingPreviewUrl(printing)}
                  alt=''
                  class='h-14 w-10 shrink-0 rounded-sm object-cover bg-muted'
                  loading='lazy'
                />
                <div class='min-w-0 flex-1'>
                  <div class='font-mono text-xs font-bold uppercase'>{getPrintingLabel(printing)}</div>
                  <Show when={printing.set_name || printing.collector_number}>
                    <div class='truncate text-xs text-muted-foreground'>
                      {printing.set_name}
                      {printing.collector_number ? ` · #${printing.collector_number}` : ''}
                    </div>
                  </Show>
                </div>
              </DropdownMenuItem>
            )}
          </For>
          <Show when={page() < totalPages()}>
            <DropdownMenuItem
              class='justify-center text-center text-xs text-muted-foreground'
              onSelect={e => {
                e.preventDefault();
                void loadPage(page() + 1, true);
              }}>
              {loading() ? 'Cargando…' : 'Cargar más impresiones…'}
            </DropdownMenuItem>
          </Show>
          <Show when={!loading() && printings().length === 0}>
            <div class='p-3 text-center text-xs text-muted-foreground'>Sin impresiones</div>
          </Show>
        </Show>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
