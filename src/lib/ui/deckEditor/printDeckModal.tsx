import { Component, createMemo, createSignal, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Button } from '~/components/ui/button';
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
  countPrintableDeckCards,
  estimatePrintDeckLayout,
  generateDeckPdf,
  getDefaultPrintDeckOptions,
  PrintDeckOptions,
  PrintPageSize,
} from '~/lib/deckPrint';
import { toast } from 'solid-sonner';
import LoaderIcon from 'lucide-solid/icons/loader-circle';

interface Props {
  open: boolean;
  deckName: string;
  cards: DetailedCardEntry[];
  onClose(): void;
}

const PAGE_SIZE_OPTIONS: { id: PrintPageSize; label: string }[] = [
  { id: 'a4', label: 'A4' },
  { id: 'letter', label: 'Letter' },
];

const PrintDeckModal: Component<Props> = props => {
  const [options, setOptions] = createSignal<PrintDeckOptions>(getDefaultPrintDeckOptions());
  const [printing, setPrinting] = createSignal(false);
  const [progress, setProgress] = createSignal('');

  const printableCount = createMemo(() => countPrintableDeckCards(props.cards));
  const layout = createMemo(() => estimatePrintDeckLayout(options()));
  const pageCount = createMemo(() =>
    printableCount() ? Math.ceil(printableCount() / layout().cardsPerPage) : 0,
  );

  function updateOption<Key extends keyof PrintDeckOptions>(key: Key, value: PrintDeckOptions[Key]) {
    setOptions(current => ({ ...current, [key]: value }));
  }

  async function handlePrint() {
    if (!printableCount() || printing()) return;

    setPrinting(true);
    setProgress('Preparing PDF...');

    try {
      await generateDeckPdf(props.cards, props.deckName, options(), progressState => {
        const label =
          progressState.phase === 'rendering'
            ? 'Rendering PDF...'
            : `Loading card ${progressState.current}/${progressState.total}`;
        setProgress(progressState.message ? `${label}: ${progressState.message}` : label);
      });
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
              </p>

              <div class='rounded-md border p-3 text-sm'>
                <div>{printableCount()} cards</div>
                <div>
                  {layout().cols} × {layout().rows} per page ({layout().cardsPerPage} cards/page)
                </div>
                <div>
                  {pageCount()} page{pageCount() === 1 ? '' : 's'}
                </div>
                <div class='text-muted-foreground'>
                  Card size: {layout().cardWidthMm.toFixed(1)} × {layout().cardHeightMm.toFixed(1)} mm
                </div>
              </div>

              <div class='grid gap-4 sm:grid-cols-2'>
                <NumberField
                  value={options().spacingMm}
                  minValue={0}
                  maxValue={20}
                  step={0.1}
                  onChange={value => {
                    const parsed = Number(String(value).replace(/,/g, ''));
                    if (Number.isFinite(parsed)) updateOption('spacingMm', parsed);
                  }}>
                  <NumberFieldLabel>Spacing (mm)</NumberFieldLabel>
                  <div class='relative'>
                    <NumberFieldInput />
                    <NumberFieldIncrementTrigger />
                    <NumberFieldDecrementTrigger />
                  </div>
                </NumberField>

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
    </Dialog>
  );
};

export default PrintDeckModal;
