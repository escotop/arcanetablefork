import { createSignal } from 'solid-js';
import uniqBy from 'lodash-es/uniqBy';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { TextField, TextFieldInput, TextFieldLabel } from '~/components/ui/text-field';
import { cardsById, colorHashLight, gameLog, getActiveGameId, getLocalPlayArea, getLocalPlayerClientId, selectedDeckId, sendEvent } from '../globals';
import { iterateGameLogEvents } from '../playerSession';
import { sha1 } from '../utils';
import { getDeckStore } from '../deckStore';
import type { Counter } from '../constants';
import { devLog } from '../devLog';
import { loadGameMeta } from '../gameMeta';

export const [isCounterDialogOpen, setIsCounterDialogOpen] = createSignal(false);
export const [counterDialogTargetCardId, setCounterDialogTargetCardId] = createSignal<
  string | undefined
>();
export const [counters, setCounters] = createSignal<Counter[]>([]);
export const [counterCreatorById, setCounterCreatorById] = createSignal<Record<string, number>>({});

export function localCustomCounters() {
  const localClientId = getLocalPlayerClientId();
  if (localClientId === undefined) return [];

  const creators = counterCreatorById();
  return counters().filter(counter => creators[counter.id] === localClientId);
}

function rememberCounterCreator(counterId: string, clientId: number | undefined) {
  if (clientId === undefined) return;
  setCounterCreatorById(existing => ({ ...existing, [counterId]: clientId }));
}

export function openCounterDialog(options?: { cardId?: string }) {
  setCounterDialogTargetCardId(options?.cardId);
  setIsCounterDialogOpen(true);
}

function clearCounterDialogTarget() {
  setCounterDialogTargetCardId(undefined);
}

function applyCounterToCard(cardId: string, counterId: string) {
  const card = cardsById.get(cardId);
  const playArea = getLocalPlayArea();
  if (!card?.mesh || !playArea) return;

  playArea.modifyCard(card, modifiers => ({
    ...modifiers,
    counters: {
      ...modifiers.counters,
      [counterId]: 1,
    },
  }));
}

function resolveDeckIdForCounters(gameId?: string): string | undefined {
  const fromSelection = selectedDeckId();
  if (fromSelection && fromSelection !== 'reconnected') return fromSelection;

  const activeGameId = gameId ?? getActiveGameId();
  if (!activeGameId) return undefined;

  return loadGameMeta(activeGameId)?.deckId;
}

function refreshCardCounterLabels() {
  void import('../card').then(module => {
    if (module.refreshAllCardCounterLabels) {
      module.refreshAllCardCounterLabels();
    }
  });
}

export function loadCustomCountersFromGameLog() {
  if (!gameLog?.length) return;

  const fromLog: Counter[] = [];
  for (const event of iterateGameLogEvents(gameLog)) {
    if (event.type !== 'createCounter') continue;
    const counter =
      (event.payload as { counter?: Counter } | undefined)?.counter ??
      (event as { counter?: Counter }).counter;
    if (!counter?.id || !counter?.name) continue;
    rememberCounterCreator(counter.id, event.clientID);
    fromLog.push({
      id: counter.id,
      name: counter.name,
      color: counter.color ?? colorHashLight.hex(counter.name),
    });
  }

  if (!fromLog.length) return;

  setCounters(existing => uniqBy([...fromLog, ...existing], 'id'));
}

/** Restore counter type definitions after reload or snapshot import. */
export function restoreCustomCounters(gameId?: string) {
  loadCustomCountersFromDeck(gameId);
  loadCustomCountersFromGameLog();
  refreshCardCounterLabels();
}

export function loadCustomCountersFromDeck(gameId?: string) {
  const deckId = resolveDeckIdForCounters(gameId);
  if (!deckId) return;

  const deckCounters = getDeckStore().decks[deckId]?.counters;
  if (!deckCounters?.length) return;

  const localClientId = getLocalPlayerClientId();
  for (const counter of deckCounters) {
    rememberCounterCreator(counter.id, localClientId);
  }

  setCounters(existing => uniqBy([...deckCounters, ...existing], 'id'));
}

export function resetCustomCountersForSnapshot(gameId?: string) {
  setCounters([]);
  setCounterCreatorById({});
  loadCustomCountersFromDeck(gameId);
  loadCustomCountersFromGameLog();
  refreshCardCounterLabels();
}

function persistCounterToDeckStore(counter: Counter) {
  const deckId = resolveDeckIdForCounters();
  if (!deckId) return;

  const deckStore = getDeckStore();
  const deck = deckStore.decks[deckId];
  if (!deck) {
    devLog.warn('createCounter: deck not found in store', deckId);
    return;
  }

  deck.counters ??= [];
  if (deck.counters.some(existing => existing.id === counter.id)) return;
  deck.counters.push(counter);
  localStorage.setItem('mtgplayer-decks', JSON.stringify(deckStore));
}

export function registerCustomCounter(counter: Counter, creatorClientId?: number) {
  setCounters(existing => uniqBy([...existing, counter], 'id'));
  rememberCounterCreator(counter.id, creatorClientId ?? getLocalPlayerClientId());
  persistCounterToDeckStore(counter);
  refreshCardCounterLabels();
}

function createCounter(counter: Counter, targetCardId?: string) {
  registerCustomCounter(counter);
  sendEvent({ type: 'createCounter', payload: { counter } });
  if (targetCardId) {
    applyCounterToCard(targetCardId, counter.id);
  }
}

export default function CounterDialog() {
  return (
    <Dialog
      open={isCounterDialogOpen()}
      onOpenChange={open => {
        setIsCounterDialogOpen(open);
        if (!open) clearCounterDialogTarget();
      }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create A Counter</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={e => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            void (async () => {
              const name = String(formData.get('name') ?? '').trim();
              if (!name) return;

              const id = await sha1(name);
              const counter: Counter = {
                id,
                name,
                color: colorHashLight.hex(name),
              };
              const targetCardId = counterDialogTargetCardId();
              createCounter(counter, targetCardId);
              e.currentTarget.reset();
              clearCounterDialogTarget();
              setIsCounterDialogOpen(false);
            })();
          }}>
          <TextField>
            <TextFieldLabel for='name'>Name</TextFieldLabel>
            <TextFieldInput type='text' id='name' name='name' />
          </TextField>
          <br />
          <DialogFooter>
            <Button type='submit'>Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
