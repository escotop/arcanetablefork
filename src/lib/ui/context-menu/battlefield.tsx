import { PlayArea } from '~/lib/playArea';
import { useMenuContext } from './context';
import MoveSubMenu from './move-submenu';
import { Mesh } from 'three';
import { doXTimes, selection } from '~/lib/globals';
import { resolveInteractiveCard } from '~/lib/card';
import { Dynamic, For, Show } from 'solid-js/web';
import { CoreCounters } from '../cardBattlefieldMenu';
import { localCustomCounters, openCounterDialog } from '../counterDialog';
import { isLoyaltyCounter, isPlaneswalkerFaceVisible } from '../../loyaltyCounter';
import { Button } from '~/components/ui/button';
import { createSignal, Match, Switch } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import CardQtyDialog from '../card-qty-dialog';

export default function BattlefieldContextMenu(props: { targetMesh: Mesh; playArea: PlayArea }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [modifierTick, setModifierTick] = createSignal(0);
  const ctx = useMenuContext();
  let meshes = () =>
    selection.selectedItems.length > 0 ? selection.selectedItems : [props.targetMesh];

  function selectedCards() {
    return meshes()
      .map(mesh => resolveInteractiveCard(mesh))
      .filter(Boolean);
  }

  function getCustomCounterValue(counterId: string) {
    modifierTick();
    return props.targetMesh?.userData.modifiers?.counters?.[counterId];
  }

  function updateCardModifiers(fn) {
    for (const card of selectedCards()) {
      props.playArea.modifyCard(card, fn);
    }
    setModifierTick(tick => tick + 1);
  }

  function adjustCustomCounter(counterId: string, fn: (current: number) => number) {
    updateCardModifiers(modifiers => {
      const previous = modifiers.counters?.[counterId];
      const nextValue = fn(previous ?? 0);
      if (nextValue < 0) {
        const { [counterId]: _removed, ...rest } = modifiers.counters ?? {};
        return { ...modifiers, counters: rest };
      }
      return {
        ...modifiers,
        counters: {
          ...modifiers.counters,
          [counterId]: previous === undefined ? Math.max(1, nextValue) : nextValue,
        },
      };
    });
  }

  function visibleCustomCounters() {
    const cards = selectedCards();
    return localCustomCounters().filter(
      counter =>
        !isLoyaltyCounter(counter) || cards.some(card => isPlaneswalkerFaceVisible(card)),
    );
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
            <CoreCounters cardMeshes={meshes()} playArea={props.playArea} />
          </Dynamic>
          <Show when={visibleCustomCounters().length}>
            <Dynamic component={ctx.separator} />
          </Show>
          <For each={visibleCustomCounters()}>
            {counter => (
              <Dynamic component={ctx.item} closeOnSelect={false}>
                <div
                  style={`--color: ${counter.color}; width: 1rem; height: 1rem; background: var(--color); margin: 0 0.25rem;`}></div>
                <div style='margin: 0 0.25rem;'>{counter.name}</div>
                <Dynamic component={ctx.shortcut}>
                  <Button
                    class='rounded align-middle px-2'
                    style={`color: black; min-width: 2rem; height: 2rem; line-height: 2rem; background-color: ${counter.color}`}
                    onClick={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      adjustCustomCounter(counter.id, value => value + 1);
                    }}
                    onContextMenu={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      adjustCustomCounter(counter.id, value => value - 1);
                    }}>
                    {getCustomCounterValue(counter.id) ?? 0}
                  </Button>
                </Dynamic>
              </Dynamic>
            )}
          </For>
          <Show when={visibleCustomCounters().length > 0}>
            <Dynamic component={ctx.separator} />
          </Show>
          <Dynamic
            component={ctx.item}
            onClick={() => {
              openCounterDialog({ cardIds: selectedCards().map(card => card.id) });
            }}>
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
          <Dynamic
            component={ctx.item}
            onClick={() => {
              meshes().forEach(mesh => props.playArea.clone(mesh.userData.id));
            }}>
            Once
            <Dynamic
              component={ctx.shortcut}
              >
              C
            </Dynamic>
          </Dynamic>
          <Dynamic
            component={ctx.item}
            onClick={() => {
              const selected = meshes();
              setSearchParams({
                dialog: 'battlefield-context-clone',
                cardIds: selected.map(mesh => mesh.userData.id).join(','),
                cardName:
                  selected.length > 1
                    ? `${selected.length} cards`
                    : props.targetMesh.userData.card.detail.name,
              });
            }}>
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
            const cardIds =
              (searchParams.cardIds as string | undefined)?.split(',').filter(Boolean) ??
              (searchParams.cardId ? [searchParams.cardId as string] : []);
            doXTimes(value, () => {
              cardIds.forEach(cardId => props.playArea.clone(cardId));
            });
          }}
          verb='Clone'
          item={['Cards', 'Card', 'Cards'] as const}
          header={`Clone "${searchParams.cardName}"`}
          onClose={() =>
            setSearchParams({
              dialog: undefined,
              cardId: undefined,
              cardIds: undefined,
              cardName: undefined,
            })
          }
        />
      </Match>
    </Switch>
  );
}
