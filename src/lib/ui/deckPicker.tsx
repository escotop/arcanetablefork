import { createSignal, Match, Switch } from 'solid-js';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import {
  NumberField,
  NumberFieldDecrementTrigger,
  NumberFieldIncrementTrigger,
  NumberFieldInput,
  NumberFieldLabel,
} from '~/components/ui/number-field';
import {
  TextField,
  TextFieldInput,
  TextFieldLabel,
} from '~/components/ui/text-field';
import { createDeckStore } from '../deckStore';
import { useCardSystemContext } from '../cardSystemContext';
import { setIsSpectating } from '../globals';
import { DeckManagerDialog } from './deckManager';
import CopyLinkButton from '~/components/ui/copy-link-button';
import { DEFAULT_COMMANDER_LIFE, LoadSettings } from '../constants';

interface Props {
  onStart(settings: LoadSettings): void;
}

export default function DeckPicker(props: Props) {
  const [deckStore] = createDeckStore();
  const [cardSystemStore] = useCardSystemContext();
  const [selectedDeckId, setSelectedDeckId] = createSignal<string>(
    deckStore?.systems[cardSystemStore.system]?.[0],
  );
  const [sessionOptions, setSessionOptions] = createSignal();

  async function onSubmit(e: SubmitEvent & { currentTarget: HTMLFormElement }) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());

    e.currentTarget.reset();

    const startOptions = { ...(sessionOptions() ?? {}), ...data };

    props.onStart(startOptions);
  }

  return (
    <Switch>
      <Match when={!sessionOptions()}>
        <SessionOptions
          onSubmit={session => {
            setSessionOptions(session);
          }}
          onSpectate={() => setIsSpectating(true)}
        />
      </Match>
      <Match when>
        <form class='contents' onSubmit={onSubmit}>
          <input type='hidden' name='deckId' value={selectedDeckId()} />
          <DeckManagerDialog
            open
            hideClose
            title='Select A Deck'
            selectedDeckId={selectedDeckId()}
            onSelectDeck={setSelectedDeckId}
            footerStart={
              <Button variant='ghost' type='button' onClick={() => setSessionOptions()}>
                Back
              </Button>
            }
            footer={
              <Button type='submit' disabled={!selectedDeckId()}>
                Start Playtest
              </Button>
            }
          />
        </form>
      </Match>
    </Switch>
  );
}

interface SessionOptionsProps {
  onSubmit(data: any): void;
  onSpectate(): void;
}

function SessionOptions(props: SessionOptionsProps) {
  async function onSubmit(e: SubmitEvent & { currentTarget: HTMLFormElement }) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());

    e.currentTarget.reset();

    props.onSubmit({
      ...data,
      startingLife: parseInt(data.startingLife as string, 10),
      startingCommanderLife: parseInt(data.startingCommanderLife as string, 10),
    });
  }

  return (
    <Dialog open>
      <DialogContent class='max-w-3xl' hideClose>
        <DialogHeader>
          <DialogTitle>Start Session</DialogTitle>
        </DialogHeader>
        <form class='flex flex-col gap-5' onSubmit={onSubmit}>
          <TextField
            defaultValue={localStorage.getItem('arcanetable-name') ?? ''}
            onChange={value => localStorage.setItem('arcanetable-name', value)}>
            <TextFieldLabel for='name'>Name</TextFieldLabel>
            <TextFieldInput required type='text' id='name' name='name' />
          </TextField>
          <div class='flex gap-4 items-end'>
            <NumberField value={40}>
              <NumberFieldLabel>Starting Life</NumberFieldLabel>
              <div class='relative'>
                <NumberFieldInput name='startingLife' />
                <NumberFieldIncrementTrigger />
                <NumberFieldDecrementTrigger />
              </div>
            </NumberField>
            <NumberField value={DEFAULT_COMMANDER_LIFE}>
              <NumberFieldLabel>Commander Health</NumberFieldLabel>
              <div class='relative'>
                <NumberFieldInput name='startingCommanderLife' />
                <NumberFieldIncrementTrigger />
                <NumberFieldDecrementTrigger />
              </div>
            </NumberField>
          </div>

          <DialogFooter>
            <CopyLinkButton variant='ghost' class='mr-auto' />
            <Button onClick={props.onSpectate} variant='ghost'>
              Spectate
            </Button>
            <Button type='submit'>Next</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
