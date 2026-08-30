import uniqBy from 'lodash-es/uniqBy';
import { nanoid } from 'nanoid';
import { CatmullRomCurve3, Euler, Group, Mesh, MeshStandardMaterial, Object3D, Quaternion, Vector3 } from 'three';
import { CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { getPlayAreaPlayerColor, textColorOnBackground } from './playerColor';
import { animateObject } from './animations';
import {
  applyCardOrientation,
  cloneCard,
  getRotationFromCardState,
  initializeCardMesh,
  loadCardTextures,
  setCardData,
  updateModifiers,
} from './card';
import { CardArea } from './cardArea';
import { CardGrid } from './cardGrid';
import { CardStack } from './cardStack';
import { Card, CARD_HEIGHT, CARD_THICKNESS, CARD_WIDTH, CardZone, SerializableCard } from './constants';
import { Deck, expandCardEntries } from './deck';
import { cameraViewPlayerIndex } from './cameraView';
import {
  camera,
  cardsById,
  dispatchGameEvent,
  doXTimes,
  expect,
  flushDispatchEventQueue,
  getLocalPlayerClientId,
  isEventCatchUpComplete,
  setPeekFilterText,
  sendEvent,
  zonesById,
} from './globals';
import { Hand } from './hand';
import { transferCard } from './transferCard';
import { getCardKey, hydrateDeck } from './deckStore';
import { cardFromDeckEntry, preloadStackTextures } from './cardLoading';
import { Deck as DeckData } from './constants';
import {
  createDismissZoneEvent,
  createFlipEvent,
  createPeekCardsEvent,
  createTransferEntireZoneEvent,
  createTransferCardEvent,
  SKIP_REPLAY,
} from './createEvents';
import { playCounterSoundForModifierChange, playShuffleDeckSound } from './sounds';

/** Battlefield mesh uses BoxGeometry(200, 100) centered at the origin. */
const BATTLEFIELD_HALF_W = 100;
const BATTLEFIELD_HALF_H = 50;
const BATTLEFIELD_TAG_INSET = 10;
const BATTLEFIELD_TAG_REMOTE_X_OFFSET = -12;
const BATTLEFIELD_TAG_SURFACE_Z = CARD_THICKNESS / 4 + 0.1;
const BATTLEFIELD_TAG_Z_LIFT = 2;
/** CSS3DRenderer centers elements on the pivot; keep scale modest on top of px sizing. */
const BATTLEFIELD_TAG_SCALE = 0.17 * 1.3;

interface RemoteZoneState {
  id: string;
  cards: SerializableCard[];
}

interface CardReference {
  id: string;
  clientId: number;
  detail: any;
}

interface State {
  isLocalPlayer?: boolean;
  clientId?: number;
  playerSessionId?: string;
  graveyard?: RemoteZoneState;
  exile?: RemoteZoneState;
  battlefield?: RemoteZoneState;
  peekZone?: RemoteZoneState;
  tokenSearchZone?: RemoteZoneState;
  hand?: RemoteZoneState;
  deck?: RemoteZoneState;
  cards: CardReference[];
}

export class PlayArea {
  public deck: Deck;
  public hand: Hand;
  public mesh: Group;
  public exileZone: CardStack;
  public graveyardZone: CardStack;
  private listeners: (() => void)[] = [];
  public battlefieldZone: CardArea;
  public peekZone;
  public isLocalPlayArea: boolean;
  public revealZone: CardGrid;
  public tokenSearchZone;
  public availableTokens?: CardReference[];
  private inProgressActions = new Set<string>();
  private peekSessionId = 0;
  public index: number;
  public playerSessionId?: string;
  private nameTagElement: HTMLDivElement;
  private nameTagWrapper: HTMLDivElement;
  private nameTagPivot: Object3D;
  private nameTagObject: CSS3DObject;

  constructor(
    public clientId: number,
    public cards: CardReference[],
    cardsInDeck: Card[],
    state: State,
  ) {
    this.mesh = new Group();
    this.isLocalPlayArea = !!state.isLocalPlayer;
    this.index = state.index ?? 0;
    this.playerSessionId = state.playerSessionId;

    this.battlefieldZone = new CardArea('battlefield', state.battlefield?.id);

    this.peekZone = new CardGrid(this.isLocalPlayArea, 'peek', state.peekZone?.id);
    this.revealZone = new CardGrid(this.isLocalPlayArea, 'reveal');
    this.tokenSearchZone = new CardGrid(
      this.isLocalPlayArea,
      'tokenSearch',
      state.tokenSearchZone?.id,
    );
    this.graveyardZone = new CardStack('graveyard', state.graveyard?.id);
    this.exileZone = new CardStack('exile', state.exile?.id);

    this.exileZone.mesh.position.set(88, -55, 2.5);
    this.graveyardZone.mesh.position.set(70, -82, 2.5);

    this.cards = cards.map(card => {
      card.id = card.id || nanoid();
      card.clientId = clientId;
      return card;
    });

    this.mesh.add(this.revealZone.mesh);
    this.mesh.add(this.peekZone.mesh);
    this.mesh.add(this.tokenSearchZone.mesh);
    this.mesh.add(this.exileZone.mesh);
    this.mesh.add(this.graveyardZone.mesh);

    let deckEntries = state?.deck?.cards?.length ? state.deck.cards : cardsInDeck;
    let deckCards = deckEntries.map(entry => cardFromDeckEntry(entry, clientId));

    this.deck = new Deck(deckCards, state?.deck?.id, clientId);
    this.hand = new Hand(state?.hand?.id, this.isLocalPlayArea);

    if (this.isLocalPlayArea) {
      this.deck.mesh.addEventListener('click', e => {
        this.draw();
      });
    }

    this.mesh.add(this.deck.mesh);
    this.mesh.add(this.hand.mesh);
    this.mesh.add(this.battlefieldZone.mesh);

    this.nameTagElement = document.createElement('div');
    this.nameTagElement.style.display = 'inline-block';
    this.nameTagElement.style.boxSizing = 'border-box';
    this.nameTagElement.style.width = 'max-content';
    this.nameTagElement.style.padding = '3px 8px';
    this.nameTagElement.style.borderRadius = '4px';
    this.nameTagElement.style.fontSize = '14px';
    this.nameTagElement.style.fontWeight = '600';
    this.nameTagElement.style.lineHeight = '1.1';
    this.nameTagElement.style.color = 'white';
    this.nameTagElement.style.whiteSpace = 'nowrap';
    this.nameTagElement.style.pointerEvents = 'none';
    this.nameTagElement.style.textAlign = 'right';
    this.nameTagElement.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.45)';
    this.nameTagElement.style.transform = 'translate(-100%, 0)';
    this.nameTagElement.style.transformOrigin = '100% 0%';

    // CSS3DObject applies translate(-50%, -50%) — zero-size wrapper keeps the pivot on the corner.
    this.nameTagWrapper = document.createElement('div');
    this.nameTagWrapper.style.width = '0';
    this.nameTagWrapper.style.height = '0';
    this.nameTagWrapper.style.overflow = 'visible';
    this.nameTagWrapper.style.pointerEvents = 'none';
    this.nameTagWrapper.appendChild(this.nameTagElement);

    this.nameTagPivot = new Object3D();
    this.mesh.add(this.nameTagPivot);
    this.updateNameTagPivotPosition();

    this.nameTagObject = new CSS3DObject(this.nameTagWrapper);
    this.nameTagWrapper.style.pointerEvents = 'none';
    this.nameTagElement.style.pointerEvents = 'none';
    this.nameTagObject.scale.setScalar(BATTLEFIELD_TAG_SCALE);
    this.nameTagObject.userData.isNameTag = true;
    this.nameTagPivot.add(this.nameTagObject);
    this.applyNameTagOrientation();

    if (state?.battlefield?.cards) {
      state.battlefield.cards.forEach(serialized => {
        let card = initializeCardMesh(serialized.userData.card, clientId);
        setCardData(card.mesh, 'isTapped', serialized.userData.isTapped ?? false);
        setCardData(card.mesh, 'isFlipped', serialized.userData.isFlipped ?? false);
        setCardData(card.mesh, 'isPublic', true);
        this.battlefieldZone.addCard(card, {
          skipAnimation: true,
          positionArray: serialized.position,
        });
      });
    }
  }

  updatePositions() {
    this.exileZone.updatePositions?.();
    this.graveyardZone.updatePositions?.();
    this.hand.updatePositions?.();
    this.deck.updatePositions?.();
    this.battlefieldZone.updatePositions?.();
  }

  reapplyBattlefieldOrientations() {
    for (const card of this.battlefieldZone.cards) {
      if (card.mesh) {
        applyCardOrientation(card.mesh);
      }
    }
  }

  updateNameTag(name: string, color = getPlayAreaPlayerColor(this)) {
    this.nameTagElement.textContent = name;
    this.nameTagElement.style.backgroundColor = color;
    this.nameTagElement.style.color = textColorOnBackground(color);

    if (!camera) return;

    const mesh = this.battlefieldZone.mesh;
    const worldNormal = new Vector3(0, 0, 1).applyQuaternion(
      mesh.getWorldQuaternion(new Quaternion()),
    );
    const meshPosition = new Vector3();
    mesh.getWorldPosition(meshPosition);
    const toCamera = camera.position.clone().sub(meshPosition).normalize();
    this.nameTagObject.visible = worldNormal.dot(toCamera) > 0;
  }

  private nameTagUsesLocalTextOrientation(): boolean {
    const fromRemoteSeat = cameraViewPlayerIndex() !== 0;
    return fromRemoteSeat ? !this.isLocalPlayArea : this.isLocalPlayArea;
  }

  refreshNameTagOrientation() {
    this.applyNameTagOrientation();
  }

  private updateNameTagPivotPosition() {
    const battlefieldMesh = this.battlefieldZone.mesh;
    const usesLocalCorner = this.nameTagUsesLocalTextOrientation();
    const remoteXOffset = usesLocalCorner ? 0 : BATTLEFIELD_TAG_REMOTE_X_OFFSET;
    this.nameTagPivot.position.set(
      BATTLEFIELD_HALF_W - BATTLEFIELD_TAG_INSET + remoteXOffset,
      battlefieldMesh.position.y + BATTLEFIELD_HALF_H - BATTLEFIELD_TAG_INSET,
      battlefieldMesh.position.z + BATTLEFIELD_TAG_SURFACE_Z + BATTLEFIELD_TAG_Z_LIFT,
    );
  }

  private applyNameTagOrientation() {
    this.updateNameTagPivotPosition();
    // Rotate text in place at the corner anchor — not the 3D object (that shifts position).
    this.nameTagObject.rotation.z = 0;
    this.nameTagElement.style.transform = this.nameTagUsesLocalTextOrientation()
      ? 'translate(-100%, 0)'
      : 'translate(-100%, 0) rotate(180deg)';
    this.nameTagElement.style.transformOrigin = '100% 0%';
  }

  async dismissAllCardGrids() {
    const zones = ['peekZone', 'tokenSearchZone'] as const;
    await Promise.all(
      zones.map(name => {
        if (this[name].cards.length > 0) return this.dismissFromZone(this[name]);
      }),
    );
  }

  async peekCards(count = 1) {
    const actualCount = Math.min(count, this.deck.cards.length);
    if (actualCount < 1) return;

    const key = `peekCards.${this.peekZone.id}`;
    if (this.inProgressActions.has(key)) return;
    this.inProgressActions.add(key);

    const sessionId = ++this.peekSessionId;
    const skipAnimation = actualCount > 5;
    await this.executePeekCards(this.deck, this.peekZone, actualCount, {
      skipAnimation,
      sessionId,
    });

    if (this.isLocalPlayArea) {
      sendEvent(
        createPeekCardsEvent(this.deck.id, this.peekZone.id, actualCount, { skipAnimation }),
      );
    }

    this.inProgressActions.delete(key);
  }

  async executePeekCards(
    fromZone: CardZone,
    toZone: CardZone,
    count: number,
    options?: { skipAnimation?: boolean; sessionId?: number },
  ) {
    const skipAnimation = options?.skipAnimation ?? count > 5;
    const sessionId = options?.sessionId ?? ++this.peekSessionId;
    const cardsToMove = fromZone.cards.slice(0, count);

    for (const card of cardsToMove) {
      if (toZone.zone === 'peek' && sessionId !== this.peekSessionId) break;
      await transferCard(card, fromZone, toZone, {
        preventTransmit: true,
        addOptions: { skipAnimation },
      });
    }
  }

  async transferEntireZone(
    fromZone: CardZone,
    toZone: CardZone,
    addOptions?: { location?: 'top' | 'bottom' },
  ) {
    if (this.inProgressActions.has(`dismissFromZone.${fromZone.id}`)) return;
    this.inProgressActions.add(`dismissFromZone.${fromZone.id}`);
    const options = {
      skipAnimation: true,
      ...(addOptions ?? (toZone.zone === 'deck' ? { location: 'bottom' as const } : {})),
    };

    await this.executeTransferEntireZone(fromZone, toZone, options);

    if (this.isLocalPlayArea) {
      sendEvent(createTransferEntireZoneEvent(fromZone.id, toZone.id, options));
    }

    this.inProgressActions.delete(`dismissFromZone.${fromZone.id}`);
  }

  async executeTransferEntireZone(
    fromZone: CardZone,
    toZone: CardZone,
    addOptions?: { location?: 'top' | 'bottom'; skipAnimation?: boolean },
  ) {
    const transfers = [...fromZone.cards].map(card => ({ card, toZone }));

    for (const { card, toZone: target } of transfers) {
      await transferCard(card, fromZone, target, {
        preventTransmit: true,
        addOptions,
      });
    }
  }

  async dismissFromZone(zone: CardZone) {
    if (this.inProgressActions.has(`dismissFromZone.${zone.id}`)) return;
    if (zone.zone === 'peek') {
      this.peekSessionId += 1;
    }
    this.inProgressActions.add(`dismissFromZone.${zone.id}`);

    await this.executeDismissZone(zone);

    if (this.isLocalPlayArea) {
      sendEvent(createDismissZoneEvent(zone.id));
    }

    this.inProgressActions.delete(`dismissFromZone.${zone.id}`);
  }

  async executeDismissZone(zone: CardZone) {
    const transfers = [...zone.cards]
      .filter(card => card.mesh)
      .map(card => ({
        card,
        toZone: zonesById.get(card.mesh!.userData.previousZoneId),
      }));

    if (zone.zone === 'peek') {
      setPeekFilterText('');
    }

    await Promise.all(
      transfers.map(({ card, toZone }) =>
        transferCard(card, zone, toZone, {
          preventTransmit: true,
          addOptions: { skipAnimation: true },
        }),
      ),
    );
  }

  async toggleTokenMenu(payload?: { availableTokens: CardReference[]; ids: string[] }) {
    const isOpen = this.tokenSearchZone.cards.length > 0;
    await this.dismissAllCardGrids();
    if (isOpen) return;
    if (payload?.availableTokens) {
      this.availableTokens = payload.availableTokens;
    }

    if (!this.availableTokens) {
      let cardsInPlay = this.cards;
      let allTokens = new Set(
        cardsInPlay
          .map(card => card.detail.all_parts ?? [])
          .flat()
          .map(part => part.uri),
      );

      this.availableTokens = await Promise.all(
        [...allTokens].map(async uri => {
          const payload = await fetch(uri, { cache: 'force-cache' }).then(r => r.json());
          return {
            ...payload,
            clientId: this.clientId,
          };
        }),
      ).then(cards =>
        // TODO: oracle_id, set_type only works for 1 card system
        uniqBy(cards, 'oracle_id')
          .filter(card => card.set_type === 'token')
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    }

    let availableCards = this.availableTokens.map((detail, i) => {
      let card = cloneCard({ detail }, payload?.ids?.[i] ?? nanoid());
      setCardData(card.mesh, 'isPublic', true);
      setCardData(card.mesh, 'isInteractive', true);
      setCardData(card.mesh, 'location', 'tokenSearch');
      setCardData(card.mesh, 'clientId', this.clientId);
      setCardData(card.mesh, 'isToken', true);
      return card;
    });

    this.emitEvent({
      type: 'toggleTokenMenu',
      payload: {
        availableTokens: this.availableTokens,
        ids: availableCards.map(card => card.id),
      },
    });

    for (let i = 0; i < availableCards.length; i++) {
      setTimeout(() => {
        this.tokenSearchZone.addCard(availableCards[i]);
      }, i * 50);
    }
  }

  modifyCard(card: Card, update = x => x) {
    const prev = structuredClone(
      card.mesh.userData.modifiers ?? { power: 0, toughness: 0, counters: {} },
    );
    const next = update(prev);
    if (this.isLocalPlayArea) {
      playCounterSoundForModifierChange(prev, next);
    }
    card.mesh.userData.modifiers = next;
    this.emitEvent({ type: 'modifyCard', payload: { userData: card.mesh.userData } });

    updateModifiers(card);
  }

  draw() {
    let card = this.deck.cards[0];
    if (!card) return;
    this.deck.materializeTopCard();
    const event = createTransferCardEvent(card, this.deck, this.hand);
    dispatchGameEvent(event);
  }

  async executeMulligan(drawCount: number, existingOrder?: number[]) {
    const cardsInHand = this.hand.cards.length;

    await doXTimes(cardsInHand, () => {
      const card = this.hand.cards[0];
      transferCard(card, this.hand, this.deck, { preventTransmit: true });
    });

    const order = await this.deck.shuffle(existingOrder);

    await doXTimes(
      drawCount,
      () => {
        transferCard(this.deck.cards[0], this.deck, this.hand, { preventTransmit: true });
      },
      50,
    );

    return order;
  }

  async mulligan(drawCount: number, existingOrder?: number[]) {
    const order = await this.executeMulligan(drawCount, existingOrder);
    this.emitEvent({ type: 'mulligan', skipReplay: SKIP_REPLAY, payload: { order, drawCount } });
  }

  reveal(card: Card) {
    if (getLocalPlayerClientId() !== card?.mesh.userData.clientId) {
      setCardData(card.mesh, 'isPublic', true);
      this.revealZone.addCard(card);
    } else {
      this.emitEvent({ type: 'reveal', payload: { userData: card.mesh.userData } });
    }
  }

  async peekGraveyard() {
    if (this.inProgressActions.has(`peekGraveyard`)) return;
    this.inProgressActions.add('peekGraveyard');
    if (this.tokenSearchZone.cards.length) {
      this.dismissFromZone(this.tokenSearchZone);
    }
    await Promise.all(
      this.graveyardZone.mesh.children.map((child, i) => {
        if (!child.userData.id) return;
        return new Promise<void>(resolve => {
          let card = cardsById.get(child.userData.id);

          setTimeout(
            () => {
              transferCard(card, this.graveyardZone, this.peekZone);
              resolve();
            },
            (this.graveyardZone.mesh.children.length - i) * 5,
          );
        });
      }),
    );
    this.inProgressActions.delete('peekGraveyard');
  }

  async peekExile() {
    if (this.inProgressActions.has(`peekExile`)) return;
    this.inProgressActions.add('peekExile');
    if (this.tokenSearchZone.cards.length) {
      this.dismissFromZone(this.tokenSearchZone);
    }
    await Promise.all(
      this.exileZone.mesh.children.map((child, i) => {
        if (!child.userData.id) return;
        return new Promise<void>(resolve => {
          let card = cardsById.get(child.userData.id);

          setTimeout(
            () => {
              transferCard(card, this.exileZone, this.peekZone);
              resolve();
            },
            (this.exileZone.mesh.children.length - i) * 5,
          );
        });
      }),
    );
    // this.exileZone.clear();
    this.inProgressActions.delete('peekExile');
  }
  async deckFlipTop(toggle = false) {
    let card = await this.deck.flipTop(toggle);
    this.emitEvent({ type: 'deckFlipTop', payload: { toggle, userData: card.mesh.userData } });
  }

  async executeShuffleDeck(existingOrder?: number[]) {
    return this.deck.shuffle(existingOrder);
  }

  async shuffleDeck(existingOrder?: number[]) {
    const order = await this.executeShuffleDeck(existingOrder);
    if (this.isLocalPlayArea) {
      playShuffleDeckSound();
    }
    this.emitEvent({ type: 'shuffleDeck', payload: { order } });
  }

  flip(cardMesh: Mesh) {
    setCardData(cardMesh, 'isFlipped', !cardMesh.userData.isFlipped);
    if (this.isLocalPlayArea && isEventCatchUpComplete()) {
      dispatchGameEvent(createFlipEvent(cardMesh));
    }
    this.applyFlipVisual(cardMesh);
  }

  applyFlipVisual(cardMesh: Mesh, options: { animate?: boolean } = {}) {
    const zone = zonesById.get(cardMesh.userData.zoneId);
    if (!zone) return;

    const animate = options.animate ?? isEventCatchUpComplete();
    const targetQuaternion = getRotationFromCardState(cardMesh.userData);

    if (!animate) {
      cardMesh.quaternion.copy(targetQuaternion);
      setCardData(cardMesh, `zone.${zone.id}.rotation`, cardMesh.rotation.toArray());
      return;
    }

    animateObject(cardMesh, {
      completeOnCancel: true,
      duration: 0.4,
      path: new CatmullRomCurve3([
        cardMesh.position.clone(),
        cardMesh.position.clone().add(new Vector3(0, 0, 20)),
        new Vector3().fromArray(cardMesh.userData.zone[zone.id].position),
      ]),
      to: {
        quarternion: targetQuaternion,
      },
      onComplete: () => {
        setCardData(cardMesh, `zone.${zone.id}.rotation`, cardMesh.rotation.toArray());
      },
    });
  }

  tap(cardMesh: Mesh, options: { skipAnimation?: boolean } = {}) {
    const zone = zonesById.get(cardMesh.userData.zoneId);
    const targetQuaternion = getRotationFromCardState(cardMesh.userData);
    const skipAnimation = options.skipAnimation ?? !isEventCatchUpComplete();

    if (skipAnimation) {
      cardMesh.quaternion.copy(targetQuaternion);
      if (zone) {
        setCardData(cardMesh, `zone.${zone.id}.rotation`, cardMesh.rotation.toArray());
      }
      return Promise.resolve();
    }

    return new Promise<void>(onComplete => {
      animateObject(cardMesh, {
        completeOnCancel: true,
        to: { quarternion: targetQuaternion },
        duration: 0.2,
        onComplete: () => {
          if (zone) {
            setCardData(cardMesh, `zone.${zone.id}.rotation`, cardMesh.rotation.toArray());
          }
          onComplete();
        },
      });
    });
  }

  clone(id: string, newId = nanoid()) {
    this.emitEvent({ type: 'clone', payload: { id, newId } });
    let card = cardsById.get(id)!;
    let newCard = cloneCard(card, newId);
    card.mesh.parent?.add(newCard.mesh);
  }

  setAsLocalPlayArea() {
    this.isLocalPlayArea = true;
    this.applyNameTagOrientation();
    this.hand.enableLocalHand();
    this.peekZone.enableLocalFeatures();
    this.revealZone.enableLocalFeatures();
    this.tokenSearchZone.enableLocalFeatures();

    if (!this.deck.mesh.userData.hasLocalDeckListener) {
      this.deck.mesh.addEventListener('click', () => this.draw());
      this.deck.mesh.userData.hasLocalDeckListener = true;
    }
  }

  getLocalState(): State {
    const localState = {
      playerSessionId: this.playerSessionId,
      graveyard: this.graveyardZone.getSerializable(),
      exile: this.exileZone.getSerializable(),
      battlefield: this.battlefieldZone.getSerializable(),
      peekZone: this.peekZone.getSerializable(),
      tokenSearchZone: this.tokenSearchZone.getSerializable(),
      hand: this.hand.getSerializable(),
      deck: this.deck.getSerializable(),
      cards: this.cards.map(card => ({ ...card, mesh: undefined })),
      index: this.index,
    };

    return localState;
  }

  subscribeEvents(callback) {
    this.listeners.push(callback);
  }

  private emitEvent(event = {}) {
    if (!this.isLocalPlayArea || !isEventCatchUpComplete()) return;
    this.listeners.forEach(callback => {
      callback(event);
    });
  }

  static async FromDeck(clientId: number, deck: DeckData) {
    const hydratedDeck = await hydrateDeck(deck);
    let cardsInDeck = expandCardEntries(
      Object.values(hydratedDeck.cards).filter(card => !hydratedDeck.inPlay[getCardKey(card)]),
    );
    let cardsInPlay = expandCardEntries(Object.values(hydratedDeck.inPlay));

    let cards = cardsInDeck.concat(cardsInPlay);
    const playArea = new PlayArea(clientId, cards, cardsInDeck, { isLocalPlayer: true });

    if (hydratedDeck?.inPlay) {
      cardsInPlay.forEach((card, i) => {
        card.id = card.id || nanoid();
        let initializedCard = initializeCardMesh(card, clientId);
        setCardData(initializedCard.mesh, 'isPublic', true);
        playArea.battlefieldZone.addCard(initializedCard, {
          skipAnimation: true,
          positionArray: [100 - (CARD_WIDTH + 2) * (i + 1), 50 - CARD_HEIGHT - 2, 0.125],
        });
      });
    }

    
    playArea.updatePositions();
    playArea.deck.shuffle();
    playArea.loadTextures();
    return playArea;
  }

  loadTextures() {
    const cache = new Map<string, Promise<import('three').MeshStandardMaterial>>();
    const jobs = [
      ...this.battlefieldZone.cards.filter(card => card.mesh).map(card => loadCardTextures(card, cache)),
      ...this.hand.cards.filter(card => card.mesh).map(card => loadCardTextures(card, cache)),
      preloadStackTextures(this.graveyardZone, cache),
      preloadStackTextures(this.exileZone, cache),
    ];
    void Promise.all(jobs).finally(() => cache.clear());
  }

  destroy() {
    this.mesh.remove(this.revealZone.mesh);
    this.mesh.remove(this.peekZone.mesh);
    this.mesh.remove(this.tokenSearchZone.mesh);
    this.mesh.remove(this.exileZone.mesh);
    this.mesh.remove(this.graveyardZone.mesh);
    this.mesh.remove(this.deck.mesh);
    this.mesh.remove(this.hand.mesh);
    this.mesh.remove(this.battlefieldZone.mesh);
    this.peekZone.destroy();
    this.revealZone.destroy();
    this.tokenSearchZone.destroy();
    this.graveyardZone.destroy();
    this.exileZone.destroy();
    this.battlefieldZone.destroy();
    this.deck.destroy();
    this.hand.destroy();
    this.nameTagPivot.remove(this.nameTagObject);
    this.mesh.remove(this.nameTagPivot);
    this.nameTagWrapper.remove();
    this.cards = [];
  }

  static FromNetworkState(state: State & { clientID?: number }) {
    const clientId = state.clientId ?? state.clientID!;
    let playArea = new PlayArea(clientId, state.cards ?? [], state.deck?.cards ?? [], state);
    playArea.updatePositions();
    playArea.loadTextures();
    return playArea;
  }
}
