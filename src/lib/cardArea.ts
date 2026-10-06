import { nanoid } from 'nanoid';
import { createRoot } from 'solid-js';
import { createStore, SetStoreFunction } from 'solid-js/store';
import {
  BoxGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  Vector3,
} from 'three';
import { animateObject, cancelAnimation } from './animations';
import { isEventCatchUpComplete, isHistoricalLogReplayInProgress } from './globals';
import { applyCardOrientation, getRotationFromCardState, getSerializableCard, setCardData } from './card';
import {
  Card,
  CARD_HEIGHT,
  CARD_STACK_OFFSET,
  CARD_THICKNESS,
  ACTIVE_TURN_BATTLEFIELD_OUTLINE_COLOR,
  ACTIVE_TURN_BATTLEFIELD_OUTLINE_Z,
  BATTLEFIELD_OUTLINE_LAYERS,
  BATTLEFIELD_OUTLINE_Z,
  BATTLEFIELD_OUTLINE_Z_DEPTH,
  BATTLEFIELD_ZONE_Z,
  CARD_ZONE_COLOR,
  CardZone,
  ZONE_OUTLINE_COLOR,
} from './constants';
import { cardsById, zonesById } from './globals';
import { cleanupMesh, getGlobalRotation } from './utils';

export class CardArea implements CardZone<{ positionArray?: [number, number, number] }> {
  public mesh: Mesh;
  public cards: Card[];
  public observable: CardZone['observable'];
  private setObservable: SetStoreFunction<CardZone['observable']>;
  private destroyReactivity(): void;
  private outlineMaterial: LineBasicMaterial;
  private outlineLine?: LineSegments;
  private edgesGeometry?: EdgesGeometry;
  private outlineLines: LineSegments[] = [];
  private outlineGroup?: Group;
  private turnOutlineActive = false;

  constructor(
    public zone: string,
    public id: string = nanoid(),
  ) {
    let geometry = new BoxGeometry(200, 100, CARD_THICKNESS / 2);
    let material = new MeshStandardMaterial({ color: CARD_ZONE_COLOR });
    this.mesh = new Mesh(geometry, material);
    this.mesh.userData.zone = zone;
    this.mesh.userData.zoneId = id;
    this.mesh.userData.id = id;
    this.cards = [];
    this.mesh.position.setY(-50);
    this.mesh.receiveShadow = true;
    let edges = new EdgesGeometry(geometry);
    this.outlineMaterial = new LineBasicMaterial({ color: ZONE_OUTLINE_COLOR });
    if (zone === 'battlefield') {
      this.edgesGeometry = edges;
      this.outlineGroup = new Group();
      this.outlineGroup.userData.isOrnament = true;
      this.mesh.add(this.outlineGroup);
      this.rebuildBattlefieldOutlineLayers();
    } else {
      this.outlineLine = new LineSegments(edges, this.outlineMaterial);
      this.outlineLine.userData.isOrnament = true;
      this.outlineLine.position.setZ(BATTLEFIELD_OUTLINE_Z);
      this.mesh.add(this.outlineLine);
    }
    zonesById.set(id, this);

    createRoot(destroy => {
      this.destroyReactivity = destroy;
      [this.observable, this.setObservable] = createStore<CardZone['observable']>({
        cardCount: this.cards.length,
      });
    });

    this.mesh.position.setZ(BATTLEFIELD_ZONE_Z);
  }

  addCard(card: Card, { skipAnimation = false, positionArray } = {}) {
    const initialPosition = card.mesh.getWorldPosition(new Vector3());
    this.mesh.worldToLocal(initialPosition);
    let position: Vector3;

    if (positionArray) {
      position = new Vector3().fromArray(positionArray);
    } else if (card.mesh.userData?.zone?.[this.id]?.position) {
      position = new Vector3().fromArray(card.mesh.userData.zone[this.id].position);
    } else {
      let rayOrigin = this.mesh.localToWorld(new Vector3(25, 50 - CARD_HEIGHT - 2, 10));
      let direction = this.mesh.getWorldDirection(new Vector3(0, -1, 0)).multiplyScalar(-1);
      let raycaster = new Raycaster(rayOrigin, direction);

      let intersections = raycaster.intersectObject(this.mesh);
      if (intersections[0]?.object?.userData?.card) {
        position = intersections[0].object.position
          .clone()
          .add(new Vector3(CARD_STACK_OFFSET, -CARD_STACK_OFFSET, CARD_THICKNESS));
      } else {
        position = this.mesh.worldToLocal(intersections[0].point);
      }
    }

    setCardData(card.mesh, 'zoneId', this.id);
    setCardData(card.mesh, 'location', this.zone);
    if (!card.mesh.userData.isFlipped) {
      setCardData(card.mesh, 'isPublic', true);
    }
    setCardData(card.mesh, 'isInteractive', true);
    setCardData(card.mesh, 'isInGrid', false);

    this.mesh.add(card.mesh);
    this.cards.push(card);
    this.setObservable('cardCount', this.cards.length);

    const instant =
      skipAnimation || !isEventCatchUpComplete() || isHistoricalLogReplayInProgress();
    const targetQuaternion = getRotationFromCardState(card.mesh.userData);
    setCardData(card.mesh, `zone.${this.id}.position`, position.toArray());
    cancelAnimation(card.mesh);
    applyCardOrientation(card.mesh, this.id);

    if (instant) {
      card.mesh.position.copy(position);
      card.mesh.quaternion.copy(targetQuaternion);
      card.mesh.rotation.setFromQuaternion(card.mesh.quaternion);
    } else {
      animateObject(card.mesh, {
        completeOnCancel: true,
        duration: 0.2,
        from: {
          position: initialPosition,
        },
        to: {
          quarternion: targetQuaternion,
          position,
        },
      });
    }
  }

  removeCard(cardMesh: Mesh) {
    let worldPosition = new Vector3();
    cardMesh.getWorldPosition(worldPosition);

    let globalRotation = getGlobalRotation(cardMesh);

    setCardData(cardMesh, `zone.${this.id}.position`, cardMesh.position.toArray());
    setCardData(cardMesh, `zone.${this.id}.rotation`, cardMesh.rotation.toArray());

    cardMesh.position.copy(worldPosition);
    cardMesh.rotation.copy(globalRotation);

    this.mesh.remove(cardMesh);
    const index = this.cards.findIndex(c => c.id === cardMesh.userData.id);
    if (index >= 0) {
      this.cards.splice(index, 1);
      this.setObservable('cardCount', this.cards.length);
    }
  }

  /** Battlefield clones are parented directly; keep `cards` in sync for transfers. */
  trackExistingCard(card: Card) {
    if (this.cards.some(entry => entry.id === card.id)) return;
    this.cards.push(card);
    this.setObservable('cardCount', this.cards.length);
  }

  rebuildBattlefieldOutlineLayers() {
    if (this.zone !== 'battlefield' || !this.outlineGroup || !this.edgesGeometry) return;

    for (const line of this.outlineLines) {
      this.outlineGroup.remove(line);
      line.geometry.dispose();
    }
    this.outlineLines = [];

    const layers = Math.max(1, Math.round(BATTLEFIELD_OUTLINE_LAYERS));
    for (let i = 0; i < layers; i++) {
      const line = new LineSegments(this.edgesGeometry, this.outlineMaterial);
      line.userData.isOrnament = true;
      this.outlineGroup.add(line);
      this.outlineLines.push(line);
    }
    this.applyBattlefieldOutlineLayout();
  }

  applyBattlefieldOutlineLayout() {
    if (this.zone !== 'battlefield' || !this.outlineLines.length) return;

    const baseZ = this.turnOutlineActive
      ? ACTIVE_TURN_BATTLEFIELD_OUTLINE_Z
      : BATTLEFIELD_OUTLINE_Z;
    const depth = Math.max(0, BATTLEFIELD_OUTLINE_Z_DEPTH);
    const layers = this.outlineLines.length;
    const renderOrder = this.turnOutlineActive ? 2 : 0;

    for (let i = 0; i < layers; i++) {
      const t = layers === 1 ? 0 : i / (layers - 1);
      const line = this.outlineLines[i];
      line.position.z = baseZ + t * depth;
      line.renderOrder = renderOrder;
    }
  }

  setTurnOutlineHighlight(active: boolean) {
    if (this.zone !== 'battlefield') return;
    this.turnOutlineActive = active;
    this.outlineMaterial.color.setHex(
      active ? ACTIVE_TURN_BATTLEFIELD_OUTLINE_COLOR : ZONE_OUTLINE_COLOR,
    );
    this.applyBattlefieldOutlineLayout();
  }

  getSerializable() {
    return {
      id: this.id,
      cards: this.mesh.children
        .filter(child => !child.userData.isOrnament)
        .map(getSerializableCard),
    };
  }

  destroy() {
    this.cards.map(card => cardsById.delete(card.id));
    zonesById.delete(this.id);
    cleanupMesh(this.mesh);
    this.destroyReactivity();
    this.cards = [];
  }
}
