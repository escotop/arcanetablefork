import { Component, createMemo, For, Show } from 'solid-js';

import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover';

import {

  cardSystem,

  getActiveGameId,

  getLocalPlayerClientId,

  isSpectating,

  playAreas,

  players,

  provider,

} from '../globals';

import { isMagicCardSystem } from '../constants';

import { updateGameMetaLife } from '../gameMeta';

import {

  getCommanderHealthTargets,

  getRemotePlayerCommanderHealthTargets,

  setTrackedOpponentCommanderLife,

} from '../commanderTracking';

import {
  getLifeBarPlayersInTurnOrder,
  getPlayAreaPlayerEntry,
  type LifeBarPlayer,
} from '../playAreaNameTag';

import { getRoundNumber, turnOrderState } from '../turnOrder';

import { getCameraViewIndexForClientId, getOrderedPlayAreas, setCameraViewByPlayerIndex } from '../cameraView';

import { LifeReadoutWithDelta } from './lifeChangeFlash';
import { LifeField } from './playerMenu';

import PlayingCardsFanIcon from '~/lib/icons/playing-cards-fan.svg';

import styles from './playerListPanel.module.css';



function switchToCameraView(clientId: number, playerSessionId?: string) {

  const viewIndex = getCameraViewIndexForClientId(clientId, playerSessionId);

  if (viewIndex === null) return;

  if (viewIndex === 3 && getOrderedPlayAreas().length < 3) return;

  setCameraViewByPlayerIndex(viewIndex);

}



const stopPropagation = (e: MouseEvent) => {

  e.stopPropagation();

};



const stopPointer = (e: PointerEvent) => {

  e.stopPropagation();

};

function playerHandCount(clientId: number) {
  Object.values(playAreas);
  const area = playAreas[clientId];
  if (!area) return 0;
  area.hand.observable.cardCount;
  area.hand.observable.revision;
  return area.hand.observable.cardCount ?? area.hand.cards.length;
}



const CommanderHealthPopover: Component<{

  editable?: boolean;

  owner?: LifeBarPlayer;

}> = props => {

  const commanderHealthTargets = createMemo(() => {

    players();

    turnOrderState();

    Object.values(playAreas);

    if (props.editable) {

      return getCommanderHealthTargets(turnOrderState());

    }

    const area = props.owner ? playAreas[props.owner.clientId] : undefined;

    return getRemotePlayerCommanderHealthTargets(area, turnOrderState());

  });



  return (

    <Popover>

      <PopoverTrigger

        class={styles.cmButton}

        onClick={stopPropagation}

        onPointerDown={stopPointer}>

        CM

      </PopoverTrigger>

      <PopoverContent

        class={`${styles.cmPopoverContent} text-left`}

        onClick={stopPropagation}

        onPointerDown={stopPointer}>

        <Show

          when={commanderHealthTargets().length > 0}

          fallback={

            <p class='px-1 py-0.5 text-xs text-muted-foreground'>Sin valores CM</p>

          }>

          <div class='flex flex-col'>

            <For each={commanderHealthTargets()}>

              {target => (

                <div class={styles.cmPopoverRow}>

                  <span

                    class={styles.cmPopoverName}

                    title={target.name}

                    classList={{ 'opacity-60': !target.isOnline }}>

                    {target.name}

                  </span>

                  <Show

                    when={props.editable}

                    fallback={

                      <div class={styles.lifeReadout} title={`${target.name} commander health`}>

                        {target.life}

                      </div>

                    }>

                    <div onClick={stopPropagation} onPointerDown={stopPointer}>

                      <LifeField
                        compact
                        life={target.life}
                        lifeFeedback={false}
                        title={`${target.name} commander health`}
                        onLifeChange={life =>

                          setTrackedOpponentCommanderLife(target.sessionId, life)

                        }

                      />

                    </div>

                  </Show>

                </div>

              )}

            </For>

          </div>

        </Show>

      </PopoverContent>

    </Popover>

  );

};



const PlayerListRow: Component<{ player: LifeBarPlayer }> = props => {

  const rowClass = () =>

    [

      styles.playerRow,

      props.player.isActiveTurn ? styles.playerRowActiveTurn : '',

      !props.player.isOnline ? styles.playerRowOffline : '',

    ]

      .filter(Boolean)

      .join(' ');



  const displayName = () => (props.player.isLocal ? 'You' : props.player.name);

  const viewTitle = () =>

    props.player.isLocal

      ? 'View from your perspective'

      : `View from ${props.player.name}'s perspective`;

  const handCount = createMemo(() => playerHandCount(props.player.clientId));

  const life = createMemo(() => {
    players();
    const area = playAreas[props.player.clientId];
    const entry = area ? getPlayAreaPlayerEntry(area) : undefined;
    if (typeof entry?.life === 'number') return entry.life;
    return props.player.life ?? 0;
  });

  return (

    <div

      class={rowClass()}

      title={viewTitle()}

      onClick={() => switchToCameraView(props.player.clientId, props.player.playerSessionId)}>

      <div class={styles.playerName}>

        <span

          class={styles.playerColorDot}

          style={{ 'background-color': props.player.color }}

        />

        <span class={styles.playerNameText}>{displayName()}</span>

        <span class={styles.handCount} title={`${handCount()} cards in hand`}>
          <PlayingCardsFanIcon class={styles.handCountIcon} aria-hidden='true' />
          {handCount()}
        </span>

      </div>



      <LifeReadoutWithDelta
        class={styles.lifeReadout}
        title='Life'
        value={life()}
        playSound={false}
        showDeltaFlash={!props.player.isLocal}
        seatClientId={props.player.clientId}
      />



      <Show when={isMagicCardSystem(cardSystem) && !props.player.isLocal}>

        <div onClick={stopPropagation} onPointerDown={stopPointer}>

          <CommanderHealthPopover owner={props.player} />

        </div>

      </Show>

    </div>

  );

};



export function LocalPlayerPanel() {

  const localPlayer = createMemo(() => {

    players();

    turnOrderState();

    Object.values(playAreas);

    return getLifeBarPlayersInTurnOrder(turnOrderState()).find(player => player.isLocal);

  });



  const localLife = () =>

    players().find(player => player.id === provider?.awareness?.clientID)?.entry?.life ?? 0;



  const rowClass = () =>
    [
      styles.playerRow,
      styles.localPlayerRow,
      localPlayer()?.isActiveTurn ? styles.playerRowActiveTurn : '',
    ]
      .filter(Boolean)
      .join(' ');



  return (

    <Show when={!isSpectating() && localPlayer()}>

      <div class={styles.localPlayerPanel}>

        <div

          class={rowClass()}

          title='View from your perspective'

          onClick={() => switchToCameraView(getLocalPlayerClientId())}>

          <div class={styles.playerName}>

            <span

              class={styles.playerColorDot}

              style={{ 'background-color': localPlayer()!.color }}

            />

            <span class={styles.playerNameText}>You</span>

          </div>



          <div
            class={styles.localPlayerControls}
            onClick={stopPropagation}
            onPointerDown={stopPointer}>
            <LifeField
              compact
              life={localLife()}
              onLifeChange={life => {
                const localState = provider.awareness.getLocalState();
                provider.awareness.setLocalState({
                  ...localState,
                  life,
                });
                const gameId = getActiveGameId();
                if (gameId) updateGameMetaLife(gameId, life, localState.commanderLife);
              }}
            />

            <Show when={isMagicCardSystem(cardSystem)}>
              <CommanderHealthPopover editable />
            </Show>
          </div>

        </div>

      </div>

    </Show>

  );

}



export default function PlayerListPanel() {
  const tablePlayers = createMemo(() => {
    players();
    turnOrderState();
    Object.values(playAreas);
    return getLifeBarPlayersInTurnOrder(turnOrderState());
  });

  const roundNumber = createMemo(() => {
    turnOrderState();
    return getRoundNumber();
  });

  return (
    <Show when={tablePlayers().length > 0}>
      <div class={styles.playerListPanel}>
        <div class={styles.roundHeader}>Round {roundNumber()}</div>
        <For each={tablePlayers()} by={player => player.clientId}>
          {player => <PlayerListRow player={player} />}
        </For>
      </div>
    </Show>
  );
}


