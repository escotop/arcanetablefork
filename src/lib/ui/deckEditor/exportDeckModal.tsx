import { Component, createEffect, createSignal, Show } from 'solid-js';
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
import { TextField, TextFieldTextArea } from '~/components/ui/text-field';
import { toast } from 'solid-sonner';
import CopyIcon from 'lucide-solid/icons/copy';

interface Props {
  open: boolean;
  content: string;
  onClose(): void;
}

const ExportDeckModal: Component<Props> = props => {
  const [copied, setCopied] = createSignal(false);
  let textareaRef: HTMLTextAreaElement | undefined;

  createEffect(() => {
    if (!props.open || !textareaRef) return;
    textareaRef.focus();
    textareaRef.select();
  });

  async function handleCopy() {
    if (!props.content) return;

    try {
      await navigator.clipboard.writeText(props.content);
      setCopied(true);
      toast.success('Deck list copied');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      textareaRef?.focus();
      textareaRef?.select();
      toast.error('Could not copy to clipboard');
    }
  }

  return (
    <Show when={props.open}>
      <Dialog modal open onOpenChange={open => !open && props.onClose()}>
        <Portal>
          <div class='fixed inset-0 z-[70] flex items-start justify-center sm:items-center'>
            <DialogOverlay class='z-[70]' />
            <DialogContentExtended class='z-[70] max-w-2xl'>
            <DialogHeader>
              <DialogTitle>Export deck</DialogTitle>
            </DialogHeader>

            <div class='grid gap-3 py-2'>
              <p class='text-sm text-muted-foreground'>
                Copy this list to import it into Moxfield, Archidekt, or other deck builders.
              </p>
              <TextField>
                <TextFieldTextArea
                  ref={textareaRef}
                  class='h-96 font-mono text-sm whitespace-pre'
                  readOnly
                  value={props.content}
                />
              </TextField>
            </div>

            <DialogFooter>
              <Button type='button' variant='outline' onClick={props.onClose}>
                Close
              </Button>
              <Button type='button' disabled={!props.content} onClick={handleCopy}>
                <CopyIcon class='mr-2 size-4' />
                {copied() ? 'Copied!' : 'Copy to clipboard'}
              </Button>
            </DialogFooter>
          </DialogContentExtended>
        </div>
      </Portal>
    </Dialog>
    </Show>
  );
};

export default ExportDeckModal;
