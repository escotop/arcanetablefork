import { createMemo, createSignal, Show } from 'solid-js';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '~/components/ui/dialog';
import { TextField, TextFieldInput, TextFieldLabel } from '~/components/ui/text-field';

export interface CustomCardModalProps {
  onClose(): void;
  onConfirm(frontUrl: string, backUrl?: string): void;
}

export default function CustomCardModal(props: CustomCardModalProps) {
  const [frontUrl, setFrontUrl] = createSignal('');
  const [backUrl, setBackUrl] = createSignal('');
  const [frontPreviewError, setFrontPreviewError] = createSignal(false);
  const [backPreviewError, setBackPreviewError] = createSignal(false);

  const trimmedFront = createMemo(() => frontUrl().trim());
  const trimmedBack = createMemo(() => backUrl().trim());
  const canConfirm = createMemo(() => trimmedFront().length > 0 && !frontPreviewError());

  function handleConfirm() {
    if (!canConfirm()) return;
    props.onConfirm(trimmedFront(), trimmedBack() || undefined);
    props.onClose();
  }

  return (
    <Dialog open onOpenChange={isOpen => !isOpen && props.onClose()}>
      <DialogContent class='max-w-lg'>
        <DialogHeader>Add custom card</DialogHeader>

        <div class='space-y-4'>
          <TextField>
            <TextFieldLabel>Card front</TextFieldLabel>
            <TextFieldInput
              type='url'
              placeholder='https://example.com/front.jpg'
              value={frontUrl()}
              onInput={event => {
                setFrontUrl(event.currentTarget.value);
                setFrontPreviewError(false);
              }}
            />
          </TextField>

          <Show when={trimmedFront()}>
            <div class='flex justify-center'>
              <Show
                when={!frontPreviewError()}
                fallback={
                  <p class='text-sm text-destructive'>Could not load front image.</p>
                }>
                <img
                  src={trimmedFront()}
                  alt='Card front preview'
                  class='max-h-56 max-w-full rounded-md border border-border object-contain'
                  onError={() => setFrontPreviewError(true)}
                />
              </Show>
            </div>
          </Show>

          <TextField>
            <TextFieldLabel>Card back (optional)</TextFieldLabel>
            <TextFieldInput
              type='url'
              placeholder='https://example.com/back.jpg'
              value={backUrl()}
              onInput={event => {
                setBackUrl(event.currentTarget.value);
                setBackPreviewError(false);
              }}
            />
          </TextField>

          <Show when={trimmedBack()}>
            <div class='flex justify-center'>
              <Show
                when={!backPreviewError()}
                fallback={
                  <p class='text-sm text-destructive'>Could not load back image.</p>
                }>
                <img
                  src={trimmedBack()}
                  alt='Card back preview'
                  class='max-h-56 max-w-full rounded-md border border-border object-contain'
                  onError={() => setBackPreviewError(true)}
                />
              </Show>
            </div>
          </Show>
        </div>

        <DialogFooter>
          <Button type='button' variant='ghost' onClick={() => props.onClose()}>
            Cancel
          </Button>
          <Button type='button' disabled={!canConfirm()} onClick={handleConfirm}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
