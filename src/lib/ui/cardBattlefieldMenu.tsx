import { Component, createEffect, createMemo, createSignal, For } from 'solid-js';
import { Mesh, Raycaster, Vector3 } from 'three';
import { Button } from '~/components/ui/button';
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from '~/components/ui/menubar';
import {
  NumberField,
  NumberFieldDecrementTrigger,
  NumberFieldIncrementTrigger,
  NumberFieldInput,
} from '~/components/ui/number-field';
import NumberFieldMenuItem from '~/components/ui/number-field-menu-item';
import { cardsById, doXTimes, scene, selection } from '../globals';
import { resolveInteractiveCard, setCardData } from '../card';
import { PlayArea } from '../playArea';
import { counters } from './counterDialog';
import { isLoyaltyCounter, isPlaneswalkerFaceVisible } from '../loyaltyCounter';
import MoveMenu from './moveMenu';
import { shuffleItems } from '../utils';

const CardBattlefieldMenu: Component<{ playArea: PlayArea; cardMesh?: Mesh }> = props => {
  let meshes = () =>
    selection.selectedItems.length > 0 ? selection.selectedItems : [props.cardMesh];

  function updateCardModifiers(fn) {
    for (const mesh of meshes()) {
      const card = resolveInteractiveCard(mesh);
      if (card) props.playArea.modifyCard(card, fn);
    }
  }

  let cardText = () => {
    let count = selection.selectedItems.length;
    if (count > 1) return `${count} cards`;
    return `1 card`;
  };

  let cardCounters = createMemo(() => {
    const modifiers = props.cardMesh?.userData.modifiers;
    const card = resolveInteractiveCard(props.cardMesh);
    return counters()
      .map(counter => ({
        ...counter,
        value: modifiers?.counters?.[counter.id],
      }))
      .filter(
        counter =>
          typeof counter.value === 'number' &&
          (!isLoyaltyCounter(counter) || (card && isPlaneswalkerFaceVisible(card))),
      );
  });

  return (
    <div class='flex flex-col items-start'>
      <div class='text-shadow'>{cardText()} selected</div>
      <div>
        <CounterRow
          onChangeCounter={(counterId, fn) => {
            updateCardModifiers(modifiers => {
              const previous = modifiers.counters?.[counterId];
              const nextValue = fn(previous ?? 0);
              return {
                ...modifiers,
                counters: {
                  ...modifiers.counters,
                  [counterId]:
                    previous === undefined ? Math.max(1, nextValue) : nextValue,
                },
              };
            });
          }}
          counters={cardCounters()}
        />
      </div>
    </div>
  );
};

interface CounterRowProps {
  counters: { id: string; value: number; color: string }[];
  onChangeCounter(counterId: string, fn: (x: number) => number): void;
}

function CounterRow(props: CounterRowProps) {
  return (
    <div class='flex gap-2 mt-2'>
      <For each={props.counters}>
        {counter => (
          <Button
            class='rounded align-middle px-2'
            style={`color: black; min-width: 2rem; height: 2rem; line-height: 2rem; background-color: ${counter.color}`}
            onClick={e => {
              e.preventDefault();
              e.stopPropagation();
              props.onChangeCounter(counter.id, x => x + 1);
            }}
            onContextMenu={e => {
              e.preventDefault();
              e.stopPropagation();
              props.onChangeCounter(counter.id, x => x - 1);
            }}>
            {counter.value ?? 0}
          </Button>
        )}
      </For>
    </div>
  );
}

export interface CoreCountersProps {
  cardMesh?: Mesh;
  cardMeshes?: Mesh[];
  playArea: PlayArea;
}

function selectedMeshes(props: CoreCountersProps): Mesh[] {
  if (props.cardMeshes?.length) return props.cardMeshes.filter(Boolean);
  if (props.cardMesh) return [props.cardMesh];
  return [];
}

export function CoreCounters(props: CoreCountersProps) {
  const meshes = () => selectedMeshes(props);
  let [power, setPower] = createSignal(0);
  let [toughness, setToughness] = createSignal(0);

  createEffect(() => {
    const first = meshes()[0];
    setPower(first?.userData.modifiers?.power ?? 0);
    setToughness(first?.userData.modifiers?.toughness ?? 0);
  });

  function modifyAll(fn) {
    for (const mesh of meshes()) {
      const card = resolveInteractiveCard(mesh);
      if (card) props.playArea.modifyCard(card, fn);
    }
  }

  return (
    <>
      <NumberField
        value={power()}
        style='width: 6rem'
        onChange={rawValue => {
          let value = parseInt(rawValue, 10);
          setPower(rawValue);
          modifyAll(modifiers => ({
            ...modifiers,
            power: value,
          }));
        }}>
        <div class='relative'>
          <NumberFieldInput />
          <NumberFieldIncrementTrigger />
          <NumberFieldDecrementTrigger />
        </div>
      </NumberField>

      <div style='display: flex; flex-direction: column;'>
        <Button
          variant='ghost'
          style='width: 1rem; height:  1rem; padding: 0; margin: 0 0.5rem'
          onClick={() => {
            setPower(power => parseInt(power.toString(), 10) + 1);
            setToughness(toughness => parseInt(toughness.toString(), 10) + 1);
            modifyAll(modifiers => ({
              ...modifiers,
              power: (modifiers.power ?? 0) + 1,
              toughness: (modifiers.toughness ?? 0) + 1,
            }));
          }}>
          <svg
            xmlns='http://www.w3.org/2000/svg'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
            stroke-linecap='round'
            stroke-linejoin='round'
            class='size-4'>
            <path d='M6 15l6 -6l6 6'></path>
          </svg>
        </Button>
        <Button
          variant='ghost'
          style='width: 1rem; height:  1rem; padding: 0; margin: 0 0.5rem'
          onClick={() => {
            setPower(power => parseInt(power.toString(), 10) - 1);
            setToughness(toughness => parseInt(toughness.toString(), 10) - 1);
            modifyAll(modifiers => ({
              ...modifiers,
              power: (modifiers.power ?? 0) - 1,
              toughness: (modifiers.toughness ?? 0) - 1,
            }));
          }}>
          <svg
            xmlns='http://www.w3.org/2000/svg'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
            stroke-linecap='round'
            stroke-linejoin='round'
            class='size-4'>
            <path d='M6 9l6 6l6 -6'></path>
          </svg>
        </Button>
      </div>
      <NumberField
        value={toughness()}
        style='width: 6rem'
        onChange={rawValue => {
          let value = parseInt(rawValue, 10);
          setToughness(rawValue);
          modifyAll(modifiers => ({
            ...modifiers,
            toughness: value,
          }));
        }}>
        <div class='relative'>
          <NumberFieldInput />
          <NumberFieldIncrementTrigger />
          <NumberFieldDecrementTrigger />
        </div>
      </NumberField>
    </>
  );
};

export default CardBattlefieldMenu;
