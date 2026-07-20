import { Button } from '@kobalte/core/button';
import { ParentProps } from 'solid-js';
import { Dialog, DialogContent, DialogHeader, DialogTrigger } from '~/components/ui/dialog';
import { TextField, TextFieldInput } from '~/components/ui/text-field';

export interface CardQtyDialogProps {
  onClose(): void;
  onSubmit(count: number): void;
  trigger: ReturnType<typeof DialogTrigger>;
  header: string;
}

export default function CardQtyDialog(props: CardQtyDialogProps & ParentProps) {
  return (
    <Dialog>
      {props.trigger}
      <DialogContent>
        <DialogHeader>{props.header}</DialogHeader>

        <TextField>
          <TextFieldInput type='number' />
        </TextField>
        <div class='flex gap-4'>
          <Button variant='ghost'>+5</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
