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

import { getLifeBarPlayersInTurnOrder, type LifeBarPlayer } from '../playAreaNameTag';

import { turnOrderState } from '../turnOrder';

import { getCameraViewIndexForClientId, getOrderedPlayAreas, setCameraViewByPlayerIndex } from '../cameraView';

import { LifeField } from './playerMenu';

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

      </div>



      <div class={styles.lifeReadout} title='Life'>

        {props.player.life ?? 0}

      </div>



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



          <div onClick={stopPropagation} onPointerDown={stopPointer}>

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

          </div>



          <Show when={isMagicCardSystem(cardSystem)}>

            <div onClick={stopPropagation} onPointerDown={stopPointer}>

              <CommanderHealthPopover editable />

            </div>

          </Show>

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



  return (

    <Show when={tablePlayers().length > 0}>

      <div class={styles.playerListPanel}>

        <For each={tablePlayers()}>{player => <PlayerListRow player={player} />}</For>

      </div>

    </Show>

  );

}


