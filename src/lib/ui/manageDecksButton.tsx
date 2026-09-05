import { Component, createSignal } from 'solid-js';
import { toast } from 'solid-sonner';
import ChevronDownIcon from 'lucide-solid/icons/chevron-down';
import { Button } from '~/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { exportAllDecksZip, mergeImportedDecks, parseDecksZip } from '~/lib/deckBulkTransfer';
import { createDeckStore } from '~/lib/deckStore';

export const ManageDecksDropdown: Component<{ onNewDeck: () => void }> = props => {
  const [deckStore, setDeckStore] = createDeckStore();
  const [importing, setImporting] = createSignal(false);
  let importInput: HTMLInputElement | undefined;

  function onExportAll() {
    try {
      exportAllDecksZip(deckStore.decks);
      toast.success('Decks exported');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Export failed');
    }
  }

  async function onImportFile(file: File) {
    setImporting(true);
    try {
      const imported = parseDecksZip(await file.arrayBuffer());
      if (!imported.length) {
        toast.error('No deck JSON files found in zip');
        return;
      }

      const merged = mergeImportedDecks(imported, {
        decks: deckStore.decks,
        systems: deckStore.systems,
      });
      setDeckStore(merged);
      toast.success(`Imported ${imported.length} deck${imported.length === 1 ? '' : 's'}`);
    } catch {
      toast.error('Import failed');
    } finally {
      setImporting(false);
      if (importInput) importInput.value = '';
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger as={Button<'button'>} variant='outline' size='sm' class='gap-1.5'>
          Manage Decks
          <ChevronDownIcon class='size-4 opacity-60' />
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem onSelect={() => props.onNewDeck()}>New deck</DropdownMenuItem>
          <DropdownMenuItem disabled={importing()} onSelect={() => importInput?.click()}>
            {importing() ? 'Importing…' : 'Import decks'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onExportAll}>Export decks</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={importInput}
        type='file'
        accept='.zip,application/zip'
        class='hidden'
        onChange={e => {
          const file = e.currentTarget.files?.[0];
          if (file) void onImportFile(file);
        }}
      />
    </>
  );
};
