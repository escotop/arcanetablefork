import { nanoid } from 'nanoid';
import { CatmullRomCurve3, Euler, Group, Object3D, Vector3 } from 'three';
import { animateObject, cancelAnimation } from './animations';
import { cleanupCard, getSerializableCard, setCardData } from './card';
import { Card, CARD_HEIGHT, CardZone } from './constants';
import { cardsById, getProjectionVec, isEventCatchUpComplete, setHoverSignal, settings, zonesById } from './globals';
import { getGlobalRotation } from './utils';
import { devLog } from './devLog';
import { createStore, SetStoreFunction } from 'solid-js/store';
import { createRoot } from 'solid-js';

const HAND_ROTATION = new Euler(Math.PI * 0.2, 0, 0);
const HAND_ARC_RADIUS = 140;
const HAND_ARC_MAX_SPREAD_DEG = 42;
const HAND_ARC_LIFT = 0.12;
const HAND_FAN_ROTATION = 0.35;

function applyHandRenderOrder(cards: Card[], focusedIndex?: number) {
  for (let i = 0; i < cards.length; i++) {
    const mesh = cards[i]?.mesh;
    if (!mesh || mesh.userData.location !== 'hand') continue;

    // Above left neighbors (j < i), below right neighbors (j > i).
    mesh.renderOrder = focusedIndex === i ? i - 0.5 : i;
  }
}

function getHandCardLayout(index: number, count: number) {
  if (count <= 0) {
    return { position: new Vector3(), rotation: new Euler() };
  }
  if (count === 1) {
    return { position: new Vector3(0, 0, 0), rotation: new Euler() };
  }

  const center = (count - 1) / 2;
  const offset = index - center;
  const spreadRad = (Math.min(HAND_ARC_MAX_SPREAD_DEG, count * 3.5) * Math.PI) / 180;
  const angle = (offset / (count - 1)) * spreadRad;

  const x = HAND_ARC_RADIUS * Math.sin(angle);
  const y = HAND_ARC_RADIUS * (1 - Math.cos(angle)) * HAND_ARC_LIFT;
  const z = index * -0.125;

  return {
    position: new Vector3(x, y, z),
    rotation: new Euler(0, 0, -angle * HAND_FAN_ROTATION),
  };
}

export class Hand implements CardZone {
  public mesh: Group;
  public cards: Card[] = [];
  private cardMap: Map<string, Card>;
  public isInteractive: boolean = true;
  public zone;
  public observable: CardZone['observable'];
  private setObservable: SetStoreFunction<CardZone['observable']>;
  private destroyReactivity(): void;

  constructor(
    public id = nanoid(),
    public isLocalHand: boolean,
  ) {
    this.mesh = new Group();
    this.mesh.userData.isInteractive = true;
    this.mesh.userData.zone = 'hand';
    this.mesh.setRotationFromEuler(HAND_ROTATION.clone());
    this.mesh.position.set(0, -105, 10);
    this.mesh.userData.id = id;
    this.mesh.userData.resting = this.mesh.position.clone();
    this.zone = 'hand';

    createRoot(destroy => {
      this.destroyReactivity = destroy;
      [this.observable, this.setObservable] = createStore({ cardCount: this.cards.length });
    });

    zonesById.set(this.id, this);

    this.cardMap = new Map<string, Card>();
  }

  updatePositions() {
    this.updateUiTether();
  }

  private get cardSpacing() {
    let max = 5;
    let min = 1;
    let value = Math.min(this.cards.length / 100, 1);
    return lerp(max, min, value);
  }

  private updateUiTether() {
    const point = new Vector3(0, CARD_HEIGHT/2, 0);
    this.mesh.localToWorld(point);
    const projection = getProjectionVec(point);
    if (!projection) return;

    this.setObservable('uiTether', {
      x: projection.x,
      y: projection.y,
      offset: { y: '-100%'}
    });
  }

  adjustHandPosition() {
    this.mesh.userData.resting = {
      position: new Vector3(0, this.mesh.position.y, this.mesh.position.z),
      rotation: HAND_ROTATION.clone(),
    };

    animateObject(this.mesh, {
      to: this.mesh.userData.resting,
      duration: 0.2,
    });
  }

  private relayoutCards(options: { animate?: boolean; skipIndex?: number } = {}) {
    const { animate = true, skipIndex } = options;
    const count = this.cards.length;

    for (let i = 0; i < count; i++) {
      const cardMesh = this.cards[i]?.mesh;
      if (!cardMesh || cardMesh.userData.location !== 'hand') continue;

      const layout = getHandCardLayout(i, count);
      cardMesh.userData.resting = layout;

      if (i === skipIndex || i === this.focusedIndex) continue;

      if (animate) {
        animateObject(cardMesh, {
          to: layout,
          duration: 0.15,
        });
      } else {
        cardMesh.position.copy(layout.position);
        cardMesh.rotation.copy(layout.rotation);
      }
    }

    applyHandRenderOrder(this.cards, this.focusedIndex);
  }

  getSerializable() {
    return {
      id: this.id,
      cards: this.cards.map(card => getSerializableCard(card.mesh)),
    };
  }

  private focusedIndex?: number;
  private keyboardFocusedIndex?: number;

  focusCardAtIndex(index: number, { keyboard = false } = {}) {
    if (index < 0 || index >= this.cards.length) return;
    if (this.focusedIndex !== undefined && this.focusedIndex !== index) {
      animateUnfocusCard(this.mesh, this.cards, this.focusedIndex, index);
    }
    this.focusedIndex = index;
    if (keyboard) {
      this.keyboardFocusedIndex = index;
    }
    animateFocusCard(this.mesh, this.cards, index);
  }

  clearFocus() {
    if (this.focusedIndex === undefined) return;
    animateUnfocusCard(this.mesh, this.cards, this.focusedIndex, undefined);
    this.focusedIndex = undefined;
    this.keyboardFocusedIndex = undefined;
  }

  isKeyboardFocused(index: number) {
    return this.keyboardFocusedIndex === index;
  }

  enableLocalHand() {
    this.isLocalHand = true;
    this.resetInteractivity();
    for (const card of this.cards) {
      card.mesh.removeEventListener('mousein', this.cardMouseIn);
      card.mesh.removeEventListener('mouseout', this.cardMouseOut);
      card.mesh.addEventListener('mousein', this.cardMouseIn);
      card.mesh.addEventListener('mouseout', this.cardMouseOut);
    }
  }

  resetInteractivity() {
    this.isInteractive = true;
    for (const card of this.cards) {
      if (card.mesh) card.mesh.userData.isAnimating = false;
    }
  }

  addCard(card: Card, { skipAnimation = false, destroy = false } = {}) {
    let initialPosition = new Vector3();
    card.mesh.getWorldPosition(initialPosition);
    this.mesh.worldToLocal(initialPosition);
    setCardData(card.mesh, 'zoneId', this.id);
    setCardData(card.mesh, 'isDragging', false);
    setCardData(card.mesh, 'isPublic', false);
    setCardData(card.mesh, 'location', 'hand');

    this.mesh.add(card.mesh);
    this.cards.push(card);
    this.cardMap.set(card.id, card);
    this.setObservable('cardCount', this.cards.length);

    let index = this.cards.length - 1;

    this.adjustHandPosition();

    if (this.isLocalHand) {
      card.mesh.addEventListener('mousein', this.cardMouseIn);
      card.mesh.addEventListener('mouseout', this.cardMouseOut);
    }

    const layout = getHandCardLayout(index, this.cards.length);
    const restingPosition = layout.position;

    setCardData(card.mesh, 'resting', layout);
    card.mesh.renderOrder = index;

    this.relayoutCards({ animate: true, skipIndex: index });

    let initialRotation = getGlobalRotation(card.mesh);
    const animateEntry = !skipAnimation && isEventCatchUpComplete();

    if (!animateEntry) {
      card.mesh.position.copy(layout.position);
      card.mesh.rotation.copy(layout.rotation);
      if (destroy) {
        this.removeCard(card.mesh);
        cleanupCard(card);
        setHoverSignal();
      }
    } else {
      this.isInteractive = false;
      animateObject(card.mesh, {
        completeOnCancel: true,
        path: new CatmullRomCurve3([initialPosition, layout.position]),
        to: {
          rotation: layout.rotation,
        },
        from: {
          rotation: initialRotation,
        },
        duration: 0.25,
        onComplete: () => {
          if (destroy) {
            this.removeCard(card.mesh);
            cleanupCard(card);
            setHoverSignal();
          }
          this.isInteractive = true;
        },
      });
    }
  }

  cardMouseIn = event => {
    if (!this.isInteractive) return;
    if (event.mesh.userData.location !== 'hand') return;
    if (event.mesh.userData.isDragging) return;

    let card = cardsById.get(event.mesh.userData.id)!;
    let index = this.cards.indexOf(card);
    this.focusedIndex = index;
    if (this.keyboardFocusedIndex !== undefined && this.keyboardFocusedIndex !== index) {
      this.keyboardFocusedIndex = undefined;
    }
    animateFocusCard(this.mesh, this.cards, index);
  };

  cardMouseOut = event => {
    if (!this.isInteractive) return;
    if (event.mesh.userData.location !== 'hand') return;
    if (event.mesh.userData.isDragging) return;

    let card = cardsById.get(event.mesh.userData.id)!;
    let index = this.cards.indexOf(card);
    if (this.keyboardFocusedIndex === index) return;
    animateUnfocusCard(this.mesh, this.cards, index, undefined);
    if (this.focusedIndex === index) {
      this.focusedIndex = undefined;
    }
  };

  removeCard(cardMesh: Object3D) {
    cancelAnimation(cardMesh);
    cardMesh.renderOrder = 0;

    let worldPosition = new Vector3();
    cardMesh.getWorldPosition(worldPosition);
    let cardIndex = this.cards.findIndex(c => c.id === cardMesh.userData.id);
    let globalRotation = getGlobalRotation(cardMesh);

    cardMesh.position.set(worldPosition.x, worldPosition.y, worldPosition.z);
    cardMesh.rotation.set(globalRotation.x, globalRotation.y, globalRotation.z);

    cardMesh.removeEventListener('mousein', this.cardMouseIn);
    cardMesh.removeEventListener('mouseout', this.cardMouseOut);
    setCardData(cardMesh, 'resting', undefined);
    this.mesh.remove(cardMesh);
    this.cards.splice(cardIndex, 1);
    this.cardMap.delete(cardMesh.userData.id);
    this.setObservable('cardCount', this.cards.length);

    this.adjustHandPosition();
    this.relayoutCards({ animate: true, skipIndex: this.focusedIndex });
    if (this.focusedIndex === cardIndex) {
      this.focusedIndex = undefined;
      this.keyboardFocusedIndex = undefined;
    } else if (this.focusedIndex !== undefined && this.focusedIndex > cardIndex) {
      this.focusedIndex--;
      if (this.keyboardFocusedIndex !== undefined) {
        this.keyboardFocusedIndex--;
      }
    }
  }

  destroy() {
    this.cards.forEach(card => {
      card.mesh.removeEventListener('mousein', this.cardMouseIn);
      card.mesh.removeEventListener('mouseout', this.cardMouseOut);
      cardsById.delete(card.id);
    });
    zonesById.delete(this.id);
    this.destroyReactivity();
    this.cards = [];
  }
}

function animateFocusCard(_handMesh: Group, cards: Card[], index: number) {
  const hoverHeight = settings.enableCameraTilt ? 4 : 6;
  const card = cards[index];
  const resting = card.mesh.userData.resting;

  applyHandRenderOrder(cards, index);

  animateObject(card.mesh, {
    to: {
      position: resting.position.clone().add(new Vector3(0, hoverHeight, 0)),
      rotation: resting.rotation,
    },
    duration: 0.15,
  });
}

function animateUnfocusCard(
  _handMesh: Group,
  cards: Card[],
  index: number,
  nextFocusedIndex?: number,
) {
  const card = cards[index];
  applyHandRenderOrder(cards, nextFocusedIndex);

  animateObject(card.mesh, {
    to: card.mesh.userData.resting,
    duration: 0.15,
  });
}
