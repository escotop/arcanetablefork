import { PlayArea } from '~/lib/playArea';
import { useMenuContext } from './context';
import MoveSubMenu from './move-submenu';
import { Mesh } from 'three';
import { doXTimes, selection } from '~/lib/globals';
import { resolveInteractiveCard } from '~/lib/card';
import { Dynamic, For, Show } from 'solid-js/web';
import { CoreCounters } from '../cardBattlefieldMenu';
import { counters, setIsCounterDialogOpen } from '../counterDialog';
import {
  NumberField,
  NumberFieldDecrementTrigger,
  NumberFieldIncrementTrigger,
  NumberFieldInput,
} from '~/components/ui/number-field';
import { createSignal, Match, Switch } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import CardQtyDialog from '../card-qty-dialog';

export default function BattlefieldContextMenu(props: { targetMesh: Mesh; playArea: PlayArea }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const ctx = useMenuContext();
  let meshes = () =>
    selection.selectedItems.length > 0 ? selection.selectedItems : [props.targetMesh];

  function updateCardModifiers(fn) {
    const card = resolveInteractiveCard(props.targetMesh);
    if (!card) return;
    const prev = card.mesh.userData.modifiers ?? { power: 0, toughness: 0, counters: {} };
    const next = fn(prev);
    props.playArea.modifyCard(card, () => next);
  }
  return (
    <>
      <MoveSubMenu
        onComplete={() => selection.clearSelection()}
        cards={meshes().map(mesh => resolveInteractiveCard(mesh)).filter(Boolean)}
        fromZone={props.playArea.battlefieldZone}
        playArea={props.playArea}
      />
      <Dynamic component={ctx.separator} />
      <Dynamic component={ctx.menu}>
        <Dynamic component={ctx.trigger}>Counters</Dynamic>
        <Dynamic component={ctx.content}>
          <Dynamic component={ctx.item} closeOnSelect={false} style='font-family: monospace;'>
            <CoreCounters cardMesh={props.targetMesh} playArea={props.playArea} />
          </Dynamic>
          <Show when={counters().length}>
            <Dynamic component={ctx.separator} />
          </Show>
          <For each={counters()}>
            {counter => (
              <Dynamic component={ctx.item} closeOnSelect={false}>
                <div
                  style={`--color: ${counter.color}; width: 1rem; height: 1rem; background: var(--color); margin: 0 0.25rem;`}></div>
                <div style='margin: 0 0.25rem;'>{counter.name}</div>
                <Dynamic component={ctx.shortcut}>
                  <NumberField
                    defaultValue={props.targetMesh?.userData.modifiers?.counters?.[counter.id] ?? 0}
                    style='width: 6rem'
                    onChange={value => {
                      updateCardModifiers(modifiers => ({
                        ...modifiers,
                        counters: {
                          ...modifiers.counters,
                          [counter.id]: parseInt(value.replace(/\,/g, ''), 10),
                        },
                      }));
                    }}>
                    <div class='relative'>
                      <NumberFieldInput />
                      <NumberFieldIncrementTrigger />
                      <NumberFieldDecrementTrigger />
                    </div>
                  </NumberField>
                </Dynamic>
              </Dynamic>
            )}
          </For>
          <Show when={counters().length > 0}>
            <Dynamic component={ctx.separator} />
          </Show>
          <Dynamic component={ctx.item} onClick={() => setIsCounterDialogOpen(true)}>
            Create New Counter
          </Dynamic>
        </Dynamic>
      </Dynamic>
      <Show when={meshes().some(mesh => mesh?.userData?.isClone)}>
        <Dynamic component={ctx.separator} />
        <Dynamic
          component={ctx.item}
          onClick={() => {
            meshes()
              .filter(mesh => mesh?.userData?.isClone)
              .forEach(mesh => props.playArea.deleteClone(mesh.userData.id));
            selection.clearSelection();
          }}>
          Delete clone
        </Dynamic>
      </Show>
      <Dynamic component={ctx.menu}>
        <Dynamic component={ctx.trigger}>Clone</Dynamic>
        <Dynamic component={ctx.content}>
          <Dynamic component={ctx.item} onClick={() => props.playArea.clone(props.targetMesh?.userData.id)}>
            Once
            <Dynamic
              component={ctx.shortcut}
              >
              C
            </Dynamic>
          </Dynamic>
          <Dynamic
            component={ctx.item}
            onClick={() =>
              setSearchParams({
                dialog: 'battlefield-context-clone',
                cardId: props.targetMesh.userData.id,
                cardName: props.targetMesh.userData.card.detail.name,
              })
            }>
            X Times
          </Dynamic>
        </Dynamic>
      </Dynamic>
      <Dynamic component={ctx.separator} />
      <Dynamic
        component={ctx.item}
        onClick={() => meshes().forEach(mesh => props.playArea.flip(mesh))}>
        Flip <Dynamic component={ctx.separator}>F</Dynamic>
      </Dynamic>
    </>
  );
}

export function BattlefieldContextDialogs(props: { playArea: PlayArea }) {
  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <Switch>
      <Match when={searchParams.dialog === 'battlefield-context-clone'}>
        <CardQtyDialog
          onSubmit={value => {
            const cardId = searchParams.cardId as string;
            doXTimes(value, () => props.playArea.clone(cardId));
          }}
          verb='Clone'
          item={['Cards', 'Card', 'Cards'] as const}
          header={`Clone "${searchParams.cardName}"`}
          onClose={() =>
            setSearchParams({ dialog: undefined, cardId: undefined, cardName: undefined })
          }
        />
      </Match>
    </Switch>
  );
}
