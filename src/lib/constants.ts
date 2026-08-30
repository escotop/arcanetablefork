import { EulerTuple, Mesh, Object3D, Vector2, Vector3, Vector3Tuple } from 'three';

export const CARD_WIDTH = 63 / 4;
export const CARD_HEIGHT = 88 / 4;
export const CARD_THICKNESS = 0.3 / 4;
export const CARD_STACK_OFFSET = 2.4;

export const ZONE_OUTLINE_COLOR = 0x000;
export const CARD_ZONE_COLOR = 0x1a1533;
export const TABLE_COLOR = 0x2c1b4e;

// camera
export const LOOK_STRENGTH_X = 0.35;
export const LOOK_STRENGTH_Y = 0.125 / 2;
export const LOOK_EASE = 0.15;

export const SCROLL_SPEED = 0.5;

export const ANNOUNCEMENT_VISIBLE_DURATION = 3500;

export const KEY = {
  Shift: '⇧',
  Mod: navigator?.userAgent?.toLowerCase()?.includes('mac') ? '⌘' : 'Ctrl',
};

export interface GameState {
  turnCount: number;
  currentTurn: string;
  id: string;
}

interface CardDetailPart {
  name: string;
  component: 'token' | unknown;
  uri: string;
}

export interface CardEntryDetail {
  image_uris: Record<string, string>;
  name: string;
  search: string;
  type_line: string;
  popularity: number;
  set?: string;
  collector_number?: string;
  all_parts?: CardDetailPart[];
  card_faces?: CardEntryDetail[];
}

export type HoverSignal = HoverSignalBase | HoverSignalWithTarget | undefined;

export interface HoverSignalBase {
  mouse: Vector2;
}

export interface HoverSignalWithTarget extends HoverSignalBase {
  mesh: Mesh;
  tether: Tether;
  intent?: 'contextMenu';
}

export interface ContextMenuSignal {
  mouse: Vector2;
  target: Mesh;
}

export interface CardEntry {
  id: string;
  name: string;
  qty: number;
  categories: string[];
  set: string;
  collector_number?: string;
  customArtUrl?: string;
}

export interface DetailedCardEntry extends CardEntry {
  detail: CardEntryDetail;
}

export interface Card {
  mesh?: Mesh;
  id: string;
  clientId: number;
  detail: CardEntryDetail;
  customArtUrl?: string;
  modifiers: {
    pt: Mesh;
    [id: string]: Mesh;
  };
}

export interface SerializableCard {
  id: string;
  userData: Record<string, any>;
  position: Vector3Tuple;
  rotation: EulerTuple;
}

export interface Tether {
  x: number;
  y: number;
  offset: {
    x?: string;
    y?: string;
  };
  rotation?: number;
}

export interface CardZone<AddOptions = {} & { skipAnimation?: boolean; destroy?: boolean }> {
  id: string;
  zone: string;
  mesh: Object3D;
  removeCard(cardMesh: Mesh): void;
  addCard(card: Card, opts?: AddOptions): void;
  getSerializable(): { id: string };
  observable: { cardCount: number, uiTether?: Tether };
  cards: Card[];
  updatePositions(): void;
}

export interface Counter {
  id: string;
  name: string;
  color: string;
}

export interface Deck {
  id: string;
  version: number;
  system: string;
  cards: Record<string, DetailedCardEntry>;
  inPlay: Record<string, DetailedCardEntry>;
  tags?: { name: string }[];
  startingLife: number;
  name: string;
  cardList?: string;
  coverImage?: string;
  counters?: Counter[];
}

export interface CardSystem {
  id: string;
  cardDetailEndpoint: string;
  cardSearchEndpoint: string;
  fallbackImage?: string;
  uri?: string;
  name: string;
  cardBack: string;
  searchField: unknown;
  popularity: string;
  imageUriFormat: 'standard' | 'scryfall';
  types: string[];
  /** When true, cardDetailEndpoint accepts set + collector_number for exact print lookup. */
  collectorLookup?: boolean;
}

export interface LoadSettings {
  name: string;
  startingLife: number;
  startingCommanderLife?: number;
  deck: Deck;
  cardSystem: CardSystem;
}

export interface GameOptions extends LoadSettings {
  gameId: string;
}

export const DEFAULT_COMMANDER_LIFE = 21;

export function isMagicCardSystem(
  system: Pick<CardSystem, 'imageUriFormat' | 'id'> | undefined,
): boolean {
  if (!system) return false;
  return system.imageUriFormat === 'scryfall' || system.id === 'scry-server-mtg';
}

export const FORMATS = [
  { name: 'Commander' },
  { name: 'Modern' },
  { name: 'Standard' },
  { name: 'Pauper' },
  { name: 'Alchemy' },
  { name: 'Brawl' },
  { name: 'Historic' },
  { name: 'Legacy' },
  { name: 'Penny Dreadful' },
  { name: 'Pioneer' },
  { name: 'Premodern' },
  { name: 'Vintage' },
  { name: 'Timeless' },
  { name: 'Explorer' },
  { name: 'Oathbreaker' },
  { name: 'Gladiator' },
];
