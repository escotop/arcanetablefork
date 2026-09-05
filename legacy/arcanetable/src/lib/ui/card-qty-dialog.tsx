import { createSignal } from 'solid-js';
import { Button } from '~/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '~/components/ui/dialog';
import { TextField, TextFieldInput } from '~/components/ui/text-field';

export interface CardQtyDialogProps {
  onClose(): void;
  onSubmit(count: number): void;
  header: string;
  item: [string, string, string];
  verb: string;
  allowNegative?: true;
}

export default function CardQtyDialog(props: CardQtyDialogProps) {
  const [sign, setSign] = createSignal('+');
  const [value, setValue] = createSignal(0);

  function onSubmit() {
    props.onSubmit(value());
    props.onClose();
  }

  function updateValue(delta: number) {
    setValue(v => {
      let update;
      if (sign() === '-') {
        update = v - delta;
      } else {
        update = v + delta;
      }

      if (!props.allowNegative) {
        update = Math.max(0, update);
      }
      return update;
    });
  }

  return (
    <Dialog open onOpenChange={isOpen => !isOpen && props.onClose()}>
      <DialogContent>
        <DialogHeader>{props.header}</DialogHeader>
        <div class='grid grid-cols-3 gap-2'>
          <Button variant='outline' onClick={() => updateValue(1)}>
            {sign()} 1
          </Button>
          <Button variant='outline' onClick={() => updateValue(2)}>
            {sign()} 2
          </Button>
          <Button variant='outline' onClick={() => updateValue(5)}>
            {sign()} 5
          </Button>
          <Button variant='outline' onClick={() => updateValue(10)}>
            {sign()} 10
          </Button>
          <Button variant='outline' onClick={() => updateValue(20)}>
            {sign()} 20
          </Button>
          <Button variant='outline' onClick={() => updateValue(50)}>
            {sign()} 50
          </Button>
          <hr class='col-span-3 my-4' />
          <div class='flex justify-stretch'>
            <Button
              class='w-full rounded-r-none rounded-l-md'
              variant={sign() === '-' ? 'secondary' : 'outline'}
              onClick={() => setSign('-')}>
              -
            </Button>
            <Button
              class='w-full rounded-l-none rounded-r-md'
              variant={sign() === '+' ? 'secondary' : 'outline'}
              onClick={() => setSign('+')}>
              +
            </Button>
          </div>
          <TextField class='col-span-2'>
            <TextFieldInput
              class='mt-0 text-xl'
              type='number'
              value={value()}
              onchange={e => setValue(parseInt(e.currentTarget.value))}
            />
          </TextField>
        </div>
        <DialogFooter>
          <Button variant='ghost' onClick={props.onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit}>
            {props.verb} {value()} {props.item[Math.min(value(), 2)]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
