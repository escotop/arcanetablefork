import { Component, createEffect, createMemo, createSignal, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import {
  Dialog,
  DialogContentExtended,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogTitle,
} from '~/components/ui/dialog';
import { Label } from '~/components/ui/label';
import {
  NumberField,
  NumberFieldDecrementTrigger,
  NumberFieldIncrementTrigger,
  NumberFieldInput,
  NumberFieldLabel,
} from '~/components/ui/number-field';
import {
  Select,
  SelectContent,
  SelectHiddenSelect,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { DetailedCardEntry } from '~/lib/constants';
import {
  buildPrintDeckCardList,
  countPrintableDeckCards,
  estimatePrintDeckLayout,
  generateDeckPdf,
  getDefaultPrintDeckOptions,
  PrintDeckOptions,
  PrintPageSize,
} from '~/lib/deckPrint';
import { toast } from 'solid-sonner';
import LoaderIcon from 'lucide-solid/icons/loader-circle';
import type { SavedCardBack } from '~/lib/savedCardBack';
import CardBackPickerModal from '~/lib/ui/cardBackPickerModal';
import TokenCopiesModal from './tokenCopiesModal';
import { getTokenKey } from '~/lib/deckTokens';

interface Props {
  open: boolean;
  deckName: string;
  cards: DetailedCardEntry[];
  sideboardCards?: DetailedCardEntry[];
  tokenCards?: DetailedCardEntry[];
  onClose(): void;
}

const PAGE_SIZE_OPTIONS: { id: PrintPageSize; label: string }[] = [
  { id: 'a4', label: 'A4' },
  { id: 'letter', label: 'Letter' },
];

const PrintDeckModal: Component<Props> = props => {
  const [options, setOptions] = createSignal<PrintDeckOptions>(getDefaultPrintDeckOptions());
  const [spacingInput, setSpacingInput] = createSignal(String(getDefaultPrintDeckOptions().spacingMm));
  const [printing, setPrinting] = createSignal(false);
  const [progress, setProgress] = createSignal('');
  const [selectedCardBack, setSelectedCardBack] = createSignal<SavedCardBack | undefined>();
  const [cardBackPickerOpen, setCardBackPickerOpen] = createSignal(false);
  const [tokenCopiesOpen, setTokenCopiesOpen] = createSignal(false);
  /** Copies to print per token key (default 1 each). */
  const [tokenCopies, setTokenCopies] = createSignal<Record<string, number>>({});

  const sideboardCards = () => props.sideboardCards ?? [];
  const deckTokenCards = () => props.tokenCards ?? [];
  const tokenCards = createMemo(() =>
    deckTokenCards()
      .map(token => ({ ...token, qty: tokenCopies()[getTokenKey(token.detail)] ?? 1 }))
      .filter(token => token.qty > 0),
  );

  const mainPrintableCount = createMemo(() => countPrintableDeckCards(props.cards));
  const sideboardPrintableCount = createMemo(() => countPrintableDeckCards(sideboardCards()));
  const tokenPrintableCount = createMemo(() => countPrintableDeckCards(tokenCards()));
  const deckTokenPrintableCount = createMemo(() => countPrintableDeckCards(deckTokenCards()));

  const printableCards = createMemo(() =>
    buildPrintDeckCardList(props.cards, sideboardCards(), tokenCards(), options()),
  );
  const printableCount = createMemo(() => countPrintableDeckCards(printableCards()));
  const layout = createMemo(() => estimatePrintDeckLayout(options()));
  const frontPageCount = createMemo(() =>
    printableCount() ? Math.ceil(printableCount() / layout().cardsPerPage) : 0,
  );
  /** Empty slots on the last front page (0 = the last page is full, which is ideal). */
  const lastPageFreeSlots = createMemo(() => {
    const count = printableCount();
    if (!count) return 0;
    const remainder = count % layout().cardsPerPage;
    return remainder ? layout().cardsPerPage - remainder : 0;
  });
  const pageCount = createMemo(() => {
    const fronts = frontPageCount();
    if (!fronts) return 0;
    if (options().addCardBacks && selectedCardBack()) return fronts * 2;
    return fronts;
  });

  function updateOption<Key extends keyof PrintDeckOptions>(key: Key, value: PrintDeckOptions[Key]) {
    setOptions(current => ({ ...current, [key]: value }));
  }

  createEffect(() => {
    if (props.open) {
      setSpacingInput(String(options().spacingMm));
    }
  });

  function commitSpacingInput() {
    const parsed = Number.parseFloat(spacingInput().trim().replace(/,/g, ''));
    if (!Number.isFinite(parsed)) {
      setSpacingInput(String(options().spacingMm));
      return;
    }
    const clamped = Math.min(20, Math.max(0, Math.round(parsed * 10) / 10));
    updateOption('spacingMm', clamped);
    setSpacingInput(String(clamped));
  }

  async function handlePrint() {
    if (!printableCount() || printing()) return;

    commitSpacingInput();

    if (options().addCardBacks && !selectedCardBack()) {
      toast.error('Select a card back first');
      return;
    }

    setPrinting(true);
    setProgress('Preparing PDF...');

    try {
      await generateDeckPdf(
        printableCards(),
        props.deckName,
        {
          ...options(),
          cardBack: selectedCardBack(),
        },
        progressState => {
          const label =
            progressState.phase === 'rendering'
              ? 'Rendering PDF...'
              : `Loading images ${progressState.current}/${progressState.total}`;
          setProgress(progressState.message ? `${label}: ${progressState.message}` : label);
        },
      );
      toast.success('Deck PDF downloaded');
      props.onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to generate PDF');
    } finally {
      setPrinting(false);
      setProgress('');
    }
  }

  return (
    <Dialog modal open={props.open} onOpenChange={open => !open && !printing() && props.onClose()}>
      <Portal>
        <div class='fixed inset-0 z-[70] flex items-start justify-center sm:items-center'>
          <DialogOverlay class='z-[70]' />
          <DialogContentExtended class='z-[70] max-w-lg'>
            <DialogHeader>
              <DialogTitle>Print deck</DialogTitle>
            </DialogHeader>

            <div class='grid gap-4 py-2'>
              <p class='text-sm text-muted-foreground'>
                Generates a PDF with printable card fronts using standard MTG dimensions (63×88 mm).
                Double-faced cards print both faces as separate slots.
              </p>

              <div class='rounded-md border p-3 text-sm'>
                <div>{printableCount()} cards</div>
                <Show when={options().includeSideboard || options().includeTokens}>
                  <div class='text-muted-foreground'>
                    {mainPrintableCount()} main
                    <Show when={options().includeSideboard && sideboardPrintableCount() > 0}>
                      {' '}
                      + {sideboardPrintableCount()} sideboard
                    </Show>
                    <Show when={options().includeTokens && tokenPrintableCount() > 0}>
                      {' '}
                      + {tokenPrintableCount()} tokens
                    </Show>
                  </div>
                </Show>
                <div>
                  {layout().cols} × {layout().rows} per page ({layout().cardsPerPage} cards/page)
                </div>
                <div>
                  {frontPageCount()} front page{frontPageCount() === 1 ? '' : 's'}
                  <Show when={options().addCardBacks && selectedCardBack()}>
                    {' '}
                    ({pageCount()} total with backs)
                  </Show>
                </div>
                <div class='text-muted-foreground'>
                  Card size: {layout().cardWidthMm.toFixed(1)} × {layout().cardHeightMm.toFixed(1)} mm
                </div>
              </div>

              <Show when={printableCount() > 0}>
                <div
                  role='status'
                  class={
                    lastPageFreeSlots() === 0
                      ? 'rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm'
                      : 'rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm'
                  }>
                  <Show
                    when={lastPageFreeSlots() > 0}
                    fallback='The last page is full — no paper wasted.'>
                    The last page has {lastPageFreeSlots()} empty slot
                    {lastPageFreeSlots() === 1 ? '' : 's'} (of {layout().cardsPerPage}).
                    <Show when={options().includeTokens && deckTokenCards().length > 0}>
                      {' '}
                      You can fill them with extra token copies.
                    </Show>
                  </Show>
                </div>
              </Show>

              <div class='grid gap-3'>
                <Label class='flex items-center gap-2 font-normal'>
                  <Checkbox
                    checked={options().includeSideboard}
                    disabled={sideboardPrintableCount() < 1}
                    onChange={checked => updateOption('includeSideboard', checked)}
                  />
                  <span>
                    Include sideboard
                    <Show when={sideboardPrintableCount() > 0}>
                      {' '}
                      ({sideboardPrintableCount()} cards)
                    </Show>
                  </span>
                </Label>
                <Label class='flex items-center gap-2 font-normal'>
                  <Checkbox
                    checked={options().includeTokens}
                    disabled={deckTokenPrintableCount() < 1}
                    onChange={checked => updateOption('includeTokens', checked)}
                  />
                  <span>
                    Include tokens
                    <Show when={tokenPrintableCount() > 0}>
                      {' '}
                      ({tokenPrintableCount()} cards)
                    </Show>
                  </span>
                </Label>
                <Show when={options().includeTokens && deckTokenCards().length > 0}>
                  <div class='pl-6'>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      disabled={printing()}
                      onClick={() => setTokenCopiesOpen(true)}>
                      Extra token copies
                    </Button>
                  </div>
                </Show>
                <Label class='flex items-center gap-2 font-normal'>
                  <Checkbox
                    checked={options().addCardBacks}
                    onChange={checked => updateOption('addCardBacks', checked)}
                  />
                  <span>Add card backs</span>
                </Label>
                <Show when={options().addCardBacks}>
                  <div class='flex flex-wrap items-center gap-2 pl-6'>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      disabled={printing()}
                      onClick={() => setCardBackPickerOpen(true)}>
                      {selectedCardBack() ? 'Change card back' : 'Choose card back'}
                    </Button>
                    <Show when={selectedCardBack()}>
                      <span class='text-sm text-muted-foreground'>{selectedCardBack()!.title}</span>
                    </Show>
                  </div>
                </Show>
                <Label class='flex items-center gap-2 font-normal'>
                  <Checkbox
                    checked={options().blackCorners}
                    onChange={checked => updateOption('blackCorners', checked)}
                  />
                  <span>Black corners</span>
                </Label>
              </div>

              <div class='grid gap-4 sm:grid-cols-2'>
                <div class='grid gap-2'>
                  <Label for='print-spacing-mm'>Spacing (mm)</Label>
                  <input
                    id='print-spacing-mm'
                    type='text'
                    inputMode='decimal'
                    autocomplete='off'
                    class='h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                    value={spacingInput()}
                    onInput={e => setSpacingInput(e.currentTarget.value.replace(/,/g, ''))}
                    onBlur={commitSpacingInput}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        commitSpacingInput();
                        e.currentTarget.blur();
                      }
                    }}
                  />
                </div>

                <NumberField
                  value={options().scale * 100}
                  minValue={50}
                  maxValue={150}
                  step={1}
                  onChange={value => {
                    const parsed = Number(String(value).replace(/,/g, ''));
                    if (Number.isFinite(parsed)) updateOption('scale', parsed / 100);
                  }}>
                  <NumberFieldLabel>Scale (%)</NumberFieldLabel>
                  <div class='relative'>
                    <NumberFieldInput />
                    <NumberFieldIncrementTrigger />
                    <NumberFieldDecrementTrigger />
                  </div>
                </NumberField>

                <NumberField
                  value={options().pageMarginMm}
                  minValue={0}
                  maxValue={30}
                  step={1}
                  onChange={value => {
                    const parsed = Number(String(value).replace(/,/g, ''));
                    if (Number.isFinite(parsed)) updateOption('pageMarginMm', parsed);
                  }}>
                  <NumberFieldLabel>Page margin (mm)</NumberFieldLabel>
                  <div class='relative'>
                    <NumberFieldInput />
                    <NumberFieldIncrementTrigger />
                    <NumberFieldDecrementTrigger />
                  </div>
                </NumberField>

                <div class='grid gap-2'>
                  <Label>Page size</Label>
                  <Select
                    value={PAGE_SIZE_OPTIONS.find(option => option.id === options().pageSize)}
                    optionValue='id'
                    optionTextValue='label'
                    onChange={option => option && updateOption('pageSize', option.id)}
                    options={PAGE_SIZE_OPTIONS}
                    itemComponent={itemProps => (
                      <SelectItem item={itemProps.item}>{itemProps.item.rawValue.label}</SelectItem>
                    )}>
                    <SelectHiddenSelect />
                    <SelectTrigger aria-label='Page size'>
                      <SelectValue<{ id: PrintPageSize; label: string }>>
                        {state => state.selectedOption()?.label ?? 'A4'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent />
                  </Select>
                </div>
              </div>

              <Show when={progress()}>
                <div class='flex items-center gap-2 text-sm text-muted-foreground'>
                  <LoaderIcon class='size-4 animate-spin' />
                  <span>{progress()}</span>
                </div>
              </Show>
            </div>

            <DialogFooter>
              <Button type='button' variant='outline' disabled={printing()} onClick={props.onClose}>
                Cancel
              </Button>
              <Button
                type='button'
                disabled={printing() || printableCount() < 1}
                onClick={handlePrint}>
                <Show when={printing()} fallback='Print'>
                  Generating...
                </Show>
              </Button>
            </DialogFooter>
          </DialogContentExtended>
        </div>
      </Portal>
      <TokenCopiesModal
        open={tokenCopiesOpen()}
        tokens={deckTokenCards()}
        copies={tokenCopies()}
        freeSlots={lastPageFreeSlots()}
        cardsPerPage={layout().cardsPerPage}
        onChange={(key, copies) => setTokenCopies(current => ({ ...current, [key]: copies }))}
        onReset={() => setTokenCopies({})}
        onClose={() => setTokenCopiesOpen(false)}
      />
      <Portal>
        <CardBackPickerModal
          open={cardBackPickerOpen()}
          onOpenChange={setCardBackPickerOpen}
          selected={selectedCardBack()}
          onSelect={setSelectedCardBack}
          stackClass='z-[80]'
        />
      </Portal>
    </Dialog>
  );
};

export default PrintDeckModal;
