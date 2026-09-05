import { nanoid } from 'nanoid';
import { createRoot } from 'solid-js';
import { createStore, SetStoreFunction } from 'solid-js/store';
import {
  BoxGeometry,
  CatmullRomCurve3,
  EdgesGeometry,
  Euler,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import { animateObject } from './animations';
import { cleanupCard, getSerializableCard, setCardData } from './card';
import { onStackCardAdded } from './cardLoading';
import {
  Card,
  CARD_HEIGHT,
  CARD_THICKNESS,
  CARD_WIDTH,
  CardZone,
  ZONE_OUTLINE_COLOR,
} from './constants';
import {
  cardsById,
  getProjectionVec,
  setHoverSignal,
  zonesById,
} from './globals';
import { cleanupMesh, getGlobalRotation } from './utils';

export class CardStack implements CardZone {
  public mesh: Mesh;
  public cards: Card[] = [];
  public observable: CardZone['observable'];
  private setObservable: SetStoreFunction<CardZone['observable']>;
  private destroyReactivity(): void;

  constructor(
    public zone: string,
    public id: string = nanoid(),
  ) {
    let geometry = new BoxGeometry(CARD_WIDTH, CARD_HEIGHT, CARD_THICKNESS);
    let material = new MeshStandardMaterial({ color: 0x000000 });
    let edges = new EdgesGeometry(geometry);
    let lineSegments = new LineSegments(
      edges,
      new LineBasicMaterial({ color: ZONE_OUTLINE_COLOR }),
    );
    lineSegments.scale.set(1.1, 1.1, 1);
    lineSegments.userData.isOrnament = true;
    material.opacity = 0;
    material.transparent = true;
    this.mesh = new Mesh(geometry, material);
    this.mesh.add(lineSegments);
    this.mesh.userData.zone = zone;
    this.mesh.userData.zoneId = id;
    this.mesh.userData.id = id;

    const hitBox = new Mesh(
      new BoxGeometry(CARD_WIDTH * 1.15, CARD_HEIGHT * 1.15, CARD_THICKNESS * 4),
      new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    hitBox.userData.zoneId = id;
    hitBox.userData.location = zone;
    hitBox.userData.isOrnament = true;
    this.mesh.add(hitBox);

    createRoot(destroy => {
      this.destroyReactivity = destroy;

      [this.observable, this.setObservable] = createStore<CardZone['observable']>({
        cardCount: this.cards.length,
      });
   });

    zonesById.set(id, this);
  }

  private updateUiTether() {
    const vertex = 6;
    const point = new Vector3().fromArray(
      this.mesh.geometry.attributes.position.array.slice(vertex * 3),
    );
    this.mesh.localToWorld(point);
    const projection = getProjectionVec(point);
    if (!projection) return;

    this.setObservable('uiTether', {
      x: projection.x,
      y: projection.y,
      offset: { y: '50%', },
    });
  }

  getSerializable() {
    return {
      id: this.id,
      cards: this.mesh.children
        .filter(child => !child.userData.isOrnament)
        .map(getSerializableCard),
    };
  }

  updateCardPositions() {
    let cummulativeZ = 0;
    this.mesh.children.forEach(child => {
      if (child.userData.isOrnament) return;
      child.position.setZ(cummulativeZ);
      cummulativeZ += CARD_THICKNESS;
    });
  }

  updatePositions() {
    this.updateUiTether();
  }

  addCard(card: Card, { skipAnimation = false, destroy = false } = {}) {
    if (!card) return;
    let initialPosition = new Vector3();
    card.mesh.getWorldPosition(initialPosition);
    this.mesh.worldToLocal(initialPosition);
    setCardData(card.mesh, 'isInteractive', true);
    setCardData(card.mesh, 'zoneId', this.id);
    setCardData(card.mesh, 'location', this.zone);
    setCardData(card.mesh, 'isPublic', true);

    this.mesh.add(card.mesh);
    this.cards.push(card);
    this.setObservable('cardCount', this.cards.length);

    let initialRotation = card.mesh.rotation;
    if (card.mesh.parent) {
      initialRotation = new Euler().setFromQuaternion(card.mesh.parent.quaternion.clone().invert());
    }

    animateObject(card.mesh, {
      completeOnCancel: true,
      duration: 0.2,
      path: new CatmullRomCurve3([
        initialPosition,
        new Vector3(0, 0, CARD_THICKNESS * this.cards.length),
      ]),
      from: {
        rotation: initialRotation,
      },
      to: {
        rotation: new Euler(),
      },
      onComplete: () => {
        if (destroy) {
          this.removeCard(card.mesh!);
          cleanupCard(card);
          setHoverSignal();
        } else {
          onStackCardAdded(this);
        }
      },
    });
  }

  removeCard(cardMesh: Mesh) {
    let worldPosition = cardMesh.getWorldPosition(new Vector3());
    let globalRotation = getGlobalRotation(cardMesh);
    cardMesh.position.copy(worldPosition);
    cardMesh.rotation.copy(globalRotation);
    this.mesh.remove(cardMesh);

    let index = this.cards.findIndex(c => c.id === cardMesh.userData.id);
    this.cards.splice(index, 1);
    this.setObservable('cardCount', this.cards.length);
    this.updateCardPositions();
  }

  destroy() {
    this.cards.map(card => {
      cardsById.delete(card.id);
    });
    this.destroyReactivity();
    zonesById.delete(this.id);
    cleanupMesh(this.mesh);
    this.cards = [];
  }
}
