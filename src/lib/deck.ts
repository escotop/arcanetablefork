import { nanoid } from 'nanoid';
import { createStore, SetStoreFunction } from 'solid-js/store';
import { CatmullRomCurve3, BoxGeometry, Euler, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { animateObject, queueAnimationGroup } from './animations';
import {
  cleanupCard,
  createDeckProxyMesh,
  createDeckStackMesh,
  dematerializeCard,
  ensureCardMesh,
  getCardImage,
  getCardArtImage,
  getSearchLine,
  getSerializableCard,
  loadCardTextures,
  resolveImageUrl,
  setCardData,
} from './card';
import {
  Card,
  CARD_HEIGHT,
  CARD_THICKNESS,
  CARD_WIDTH,
  CardEntry,
  CardEntryDetail,
  CardZone,
  Deck as StoredDeck,
  DetailedCardEntry,
} from './constants';
import { applyCustomArtToEntry, normalizeTextureUrl } from './customCardArt';
import { devLog } from './devLog';
import { parseImportedCardList } from './deckParser';
import { getCardCollectorNumber } from './deckListFormat';
import { hasRequestedPrinting, printingMatchesRequest } from './deckPrinting';
import { cardsById, cardSystem, getProjectionVec, setHoverSignal, zonesById } from './globals';
import { cleanupMesh, getGlobalRotation, shuffleItems } from './utils';
import { createRoot } from 'solid-js';
import {
  getCardById,
  getCardBySetCollector,
  getCardNamed,
  searchCards,
} from './scryfall/client';

function isValidCardDetail(payload: unknown): payload is CardEntryDetail {
  if (!payload || typeof payload !== 'object') return false;
  const card = payload as CardEntryDetail;
  if ((card as { object?: string }).object === 'error') return false;
  return Boolean(card.id || card.name);
}

function detailFromSearchResult(match: CardEntryDetail): CardEntryDetail | null {
  if (!match?.id || !match?.name) return null;
  if (match.image_uris || match.card_faces?.length || match.type || match.type_line) {
    return match;
  }
  return null;
}

async function fetchCardDetailById(id: string): Promise<CardEntryDetail | null> {
  return getCardById(id);
}

function buildExactNameSearchQuery(name: string) {
  return `!"${name.replace(/"/g, '\\"')}"`;
}

export class Deck implements CardZone<{ location: 'top' | 'bottom' }> {
  public mesh: Group;
  public isTopPublic = false;
  public zone: string;
  public observable: CardZone['observable'];
  private setObservable: SetStoreFunction<CardZone['observable']>;
  private destroyReactivity(): void;
  private topProxyMesh: Mesh;
  private stackMesh: Mesh;

  constructor(
    public cards: Card[],
    public id = nanoid(),
    public clientId: number,
  ) {
    this.mesh = new Group();
    zonesById.set(this.id, this);

    this.mesh.rotation.set(0, Math.PI, 0);
    this.mesh.position.set(70, -55, cards.length * CARD_THICKNESS + 2.5);
    this.mesh.userData.isInteractive = true;
    this.mesh.userData.zone = 'deck';
    this.mesh.userData.location = 'deck';
    this.mesh.userData.zoneId = id;
    this.mesh.userData.id = id;
    this.zone = 'deck';

    this.cards.forEach(card => {
      card.id = card.id || nanoid();
      card.clientId = clientId;
      cardsById.set(card.id, card);
    });

    this.topProxyMesh = createDeckProxyMesh();
    this.stackMesh = createDeckStackMesh();
    this.topProxyMesh.userData.zoneId = id;
    this.stackMesh.userData.zoneId = id;
    this.mesh.add(this.stackMesh);
    this.mesh.add(this.topProxyMesh);

    const hitBox = new Mesh(
      new BoxGeometry(CARD_WIDTH * 1.15, CARD_HEIGHT * 1.15, CARD_THICKNESS * 8),
      new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    hitBox.userData.zoneId = id;
    hitBox.userData.location = 'deck';
    hitBox.userData.isOrnament = true;
    hitBox.position.z = CARD_THICKNESS * 3;
    this.mesh.add(hitBox);

    createRoot(destroy => {
      this.destroyReactivity = destroy;
      [this.observable, this.setObservable] = createStore<CardZone['observable']>({
        cardCount: cards.length,
      });
    });

    this.syncDeckVisual();
  }

  materializeTopCard() {
    const card = this.cards[0];
    if (!card) return undefined;

    ensureCardMesh(card, this.clientId);
    if (!card.mesh) return undefined;

    setCardData(card.mesh, 'location', 'deck');
    setCardData(card.mesh, 'zoneId', this.id);
    setCardData(card.mesh, 'isPublic', false);
    setCardData(card.mesh, 'isInteractive', true);
    card.mesh.position.set(0, 0, 0);

    if (!this.mesh.children.includes(card.mesh)) {
      this.mesh.add(card.mesh);
    }

    this.topProxyMesh.visible = false;
    return card;
  }

  prepareCardForRemoval(card: Card) {
    if (this.cards[0]?.id === card.id) {
      this.materializeTopCard();
      return;
    }
    ensureCardMesh(card, this.clientId);
  }

  condenseMeshes() {
    this.cards.forEach((card, index) => {
      if (index === 0 && this.isTopPublic) return;
      dematerializeCard(card);
    });
    this.syncDeckVisual();
  }

  syncDeckVisual() {
    this.mesh.position.set(70, -55, this.cards.length * CARD_THICKNESS + 2.5);
    this.setObservable('cardCount', this.cards.length);

    const top = this.cards[0];
    if (!top) {
      this.topProxyMesh.visible = false;
      this.stackMesh.visible = false;
      return;
    }

    const stackCount = Math.max(0, this.cards.length - 1);
    if (stackCount === 0) {
      this.stackMesh.visible = false;
    } else {
      const depth = stackCount * CARD_THICKNESS;
      this.stackMesh.visible = true;
      this.stackMesh.scale.z = depth;
      this.stackMesh.position.z = CARD_THICKNESS / 2 + depth / 2;
    }

    if (top.mesh && this.mesh.children.includes(top.mesh)) {
      this.topProxyMesh.visible = false;
      top.mesh.position.set(0, 0, 0);
      return;
    }

    this.mesh.children.forEach(child => {
      if (
        child !== this.topProxyMesh &&
        child !== this.stackMesh &&
        child.userData?.id
      ) {
        this.mesh.remove(child);
      }
    });
    this.topProxyMesh.visible = true;
  }

  updatePositions() {
    this.updateUiTether();
  }

  private updateUiTether() {
    const point = new Vector3(CARD_WIDTH / 2, -CARD_HEIGHT / 2, 0);
    this.mesh.localToWorld(point);
    const projection = getProjectionVec(point);
    if (!projection) return;

    this.setObservable('uiTether', {
      x: projection.x,
      y: projection.y,
      offset: { y: '125%', x: '-25%' },
    });
  }

  addCardBottom(card: Card, { destroy = false, skipAnimation = false } = {}) {
    ensureCardMesh(card, this.clientId);
    setCardData(card.mesh!, 'isPublic', false);
    setCardData(card.mesh!, 'zoneId', this.id);
    setCardData(card.mesh!, 'location', 'deck');
    this.cards.push(card);

    this.setObservable('cardCount', this.cards.length);

    let initialPosition = card.mesh!.getWorldPosition(new Vector3());
    this.mesh.worldToLocal(initialPosition);
    this.mesh.add(card.mesh!);

    let yPos = this.cards.length - 1;
    let position = new Vector3(0, 0, yPos * 0.125);

    if (skipAnimation) {
      card.mesh!.position.copy(position);
      card.mesh!.rotation.set(0, 0, 0);
      this.mesh.position.set(70, -55, this.cards.length * CARD_THICKNESS + 2.5);
      this.condenseMeshes();
      return;
    }

    let path = new CatmullRomCurve3([initialPosition, position]);

    const restingPosition = new Vector3(70, -55, this.cards.length * 0.125 + 2.5);
    const curPosition = this.mesh.position.clone();

    animateObject(this.mesh, {
      completeOnCancel: true,
      path: new CatmullRomCurve3([curPosition, restingPosition]),
      duration: 0.5,
    });

    animateObject(card.mesh!, {
      completeOnCancel: true,
      path,
      duration: 0.2,
      to: {
        rotation: new Euler(0, 0, 0),
      },
      onComplete: () => {
        if (destroy) {
          this.removeCard(card.mesh!);
          cleanupCard(card);
          setHoverSignal();
        } else {
          this.condenseMeshes();
        }
      },
    });
  }

  async addCardTop(card: Card, { destroy = false, skipAnimation = false } = {}) {
    this.updateUiTether();
    ensureCardMesh(card, this.clientId);
    setCardData(card.mesh!, 'location', 'deck');
    setCardData(card.mesh!, 'zoneId', this.id);

    if (this.cards[0]?.mesh?.userData.isPublic || this.isTopPublic) {
      await this.flipTop();
    }
    setCardData(card.mesh!, 'isPublic', false);

    this.cards.unshift(card);
    this.setObservable('cardCount', this.cards.length);

    let initialPosition = card.mesh!.getWorldPosition(new Vector3());
    this.mesh.worldToLocal(initialPosition);
    this.mesh.add(card.mesh!);

    let position = new Vector3(0, 0, 0);

    if (skipAnimation) {
      card.mesh!.position.copy(position);
      card.mesh!.rotation.set(0, 0, 0);
      for (let i = 0; i < this.cards.length; i++) {
        const deckCard = this.cards[i];
        if (deckCard.mesh) {
          deckCard.mesh.position.set(0, 0, i * CARD_THICKNESS);
        }
      }
      this.mesh.position.set(70, -55, this.cards.length * CARD_THICKNESS + 2.5);
      this.condenseMeshes();
      return;
    }

    let path = new CatmullRomCurve3([initialPosition, position]);

    this.mesh.position.setZ(this.cards.length * CARD_THICKNESS + 2.5);

    let promises = [];
    let positionOffset = 0;

    for (let i = 0; i < this.cards.length; i++) {
      const deckCard = this.cards[i];
      if (!deckCard.mesh) continue;
      setCardData(deckCard.mesh, 'location', 'deck');
      deckCard.mesh.position.set(0, 0, positionOffset);
      positionOffset += CARD_THICKNESS;
    }

    promises.push(
      new Promise<void>(resolve => {
        animateObject(card.mesh!, {
          completeOnCancel: true,
          path,
          duration: 0.2,
          to: {
            rotation: new Euler(0, 0, 0),
          },
          onComplete: () => {
            if (destroy) {
              this.removeCard(card.mesh!);
              cleanupCard(card);
              setHoverSignal();
            }
            resolve();
          },
        });
      }),
    );

    if (this.isTopPublic) {
      promises.push(this.flipTop());
    }

    await Promise.all(promises).then(() => {
      this.cards.forEach((deckCard, i) => {
        if (deckCard.mesh) {
          deckCard.mesh.position.set(0, 0, i * CARD_THICKNESS);
        }
      });
      this.condenseMeshes();
    });
  }

  addCard(card: Card, { location = 'top', ...rest } = {}) {
    if (location === 'top') {
      return this.addCardTop(card, rest);
    } else {
      return this.addCardBottom(card, rest);
    }
  }

  async shuffle(order?: number[]) {
    if (this.cards?.[0]?.mesh?.userData?.isPublic) {
      await this.flipTop();
    }

    let newOrder = shuffleItems(this.cards, order);

    await this.animateReorder().then(async () => {
      if (this.isTopPublic) {
        await this.flipTop();
      }
    });
    return newOrder;
  }

  async removeCard(cardMesh?: Mesh) {
    if (!cardMesh?.userData?.id) return;

    let index = this.cards.findIndex(card => card.id === cardMesh.userData.id);
    if (index > -1) {
      this.cards.splice(index, 1);
      let worldPosition = new Vector3();
      cardMesh.getWorldPosition(worldPosition);
      let globalRotation = getGlobalRotation(cardMesh);

      cardMesh.position.copy(worldPosition);
      cardMesh.rotation.copy(globalRotation);

      this.mesh.remove(cardMesh);
      this.setObservable('cardCount', this.cards.length);
    } else {
      devLog.error(`didn't find card`, {
        cardMesh,
        cards: this.cards,
        meshId: cardMesh.userData.id,
      });
    }
    if (this.isTopPublic && !this.cards[0]?.mesh?.userData.isPublic) {
      await this.flipTop();
    }
    this.condenseMeshes();
  }

  async animateReorder() {
    queueAnimationGroup();
    animateObject(this.mesh, {
      completeOnCancel: true,
      duration: 0.2,
      to: {
        position: new Vector3(70, -55, this.cards.length * CARD_THICKNESS + 2.5),
      },
    });

    const materialized = this.cards.filter(
      card => card.mesh && this.mesh.children.includes(card.mesh),
    );

    if (!materialized.length) {
      await new Promise<void>(resolve => {
        animateObject(this.topProxyMesh, {
          completeOnCancel: true,
          duration: 0.4,
          path: new CatmullRomCurve3([
            this.topProxyMesh.position.clone(),
            new Vector3(10, 0, 0),
            new Vector3(-10, 0, 0),
            new Vector3(0, 0, 0),
          ]),
          onComplete: resolve,
        });
      });
      queueAnimationGroup();
      return;
    }

    await Promise.all(
      materialized.map((card, i) => {
        return new Promise<void>(resolve => {
          animateObject(card.mesh!, {
            completeOnCancel: true,
            duration: 0.4,
            path: new CatmullRomCurve3([
              card.mesh!.position.clone(),
              new Vector3((i % 2) * 20 - 10, 0, card.mesh!.position.z),
              new Vector3((i % 2) * 20 - 10, 0, i * CARD_THICKNESS),
              new Vector3(0, 0, i * CARD_THICKNESS),
            ]),
            to: {
              rotation: new Euler(0, 0, 0),
            },
            onComplete: resolve,
          });
        });
      }),
    );
    queueAnimationGroup();
  }

  flipTop(toggle = false) {
    return new Promise<void>(resolve => {
      let card = this.cards[0];
      if (!card) {
        resolve();
        return;
      }
      this.materializeTopCard();
      void loadCardTextures(card).then(() => {
        let isVisible = !card.mesh!.userData.isPublic;

        setCardData(card.mesh!, 'isPublic', isVisible);

        animateObject(card.mesh!, {
          completeOnCancel: true,
          duration: 0.2,
          path: new CatmullRomCurve3([
            card.mesh!.position.clone(),
            card.mesh!.position.clone(),
          ]),
          to: {
            rotation: new Euler(0, isVisible ? Math.PI : 0, 0),
          },
          onComplete() {
            resolve(card);
          },
        });
        if (toggle) {
          this.isTopPublic = !this.isTopPublic;
        }
      });
    });
  }

  getSerializable() {
    return {
      id: this.id,
      cards: this.cards.map(card =>
        card.mesh
          ? getSerializableCard(card.mesh)
          : {
              id: card.id,
              detail: card.detail,
              userData: {
                id: card.id,
                card: { detail: card.detail },
                clientId: card.clientId,
              },
              position: [0, 0, 0],
              rotation: [0, 0, 0],
            },
      ),
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

export function expandCardEntries(cardEntries: DetailedCardEntry[]) {
  let cards: Card[] = [];

  cardEntries.forEach(card => {
    for (let i = 0; i < card.qty; i++) {
      cards.push({
        id: nanoid(),
        clientId: 0,
        detail: card.detail,
        customArtUrl: card.customArtUrl,
        modifiers: {} as Card['modifiers'],
      });
    }
  });

  return cards;
}

export function loadCardList(cardList: string): CardEntry[] {
  return parseImportedCardList(cardList).cards;
}

export { parseImportedCardList } from './deckParser';

export { formatDeckListLine, getCardCollectorNumber } from './deckListFormat';
export { hasRequestedPrinting, printingMatchesRequest } from './deckPrinting';

function normalizeSetCode(set?: string) {
  return set?.trim().toLowerCase() || undefined;
}

function normalizeCollectorNumber(collectorNumber?: string | number) {
  if (collectorNumber == null) return undefined;
  const normalized = String(collectorNumber).trim().toLowerCase();
  if (!normalized) return undefined;
  if (/^\d+$/.test(normalized)) {
    return String(Number.parseInt(normalized, 10));
  }
  return normalized;
}

function normalizeCardName(name?: string) {
  return name?.trim().toLowerCase() || '';
}

function cardNamesMatch(cardName: string | undefined, requestedName: string) {
  const left = normalizeCardName(cardName);
  const right = normalizeCardName(requestedName);
  if (!left || !right) return false;
  if (left === right) return true;

  const leftFront = left.split('//')[0]?.trim() ?? left;
  const rightFront = right.split('//')[0]?.trim() ?? right;
  return leftFront === rightFront || leftFront === right || left === rightFront;
}

function matchesSetSearchResult(
  card: { name?: string; set?: string; collector_number?: string },
  name: string,
  set: string,
  collectorNumber?: string,
): boolean {
  if (!cardNamesMatch(card.name, name)) return false;

  if (collectorNumber) {
    if (card.collector_number) {
      return (
        normalizeCollectorNumber(card.collector_number) ===
          normalizeCollectorNumber(collectorNumber) &&
        (!card.set || normalizeSetCode(card.set) === normalizeSetCode(set))
      );
    }
    // Search already included cn: — minimal search payloads may omit set/collector_number.
    return !card.set || card.set.toLowerCase() === set.toLowerCase();
  }

  return !card.set || card.set.toLowerCase() === set.toLowerCase();
}

function fetchCardInfoCacheKey(entry: CardEntry, urlString: string) {
  return `${urlString}:${entry.qty ?? 1}:${entry.set ?? ''}:${entry.collector_number ?? ''}`;
}

export async function fetchCardInfo(
  entry: CardEntry,
  cache?: Map<string, DetailedCardEntry>,
): Promise<DetailedCardEntry> {
  const url = new URL(cardSystem.cardDetailEndpoint);
  url.searchParams.set('exact', entry.name);

  if (entry.id) {
    url.searchParams.set('id', entry.id);
  }
  if (entry.set) {
    url.searchParams.set('set', entry.set);
  }

  let urlString = url.toString();
  const cacheKey = fetchCardInfoCacheKey(entry, urlString);

  if (cache && cache.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

  let result: DetailedCardEntry | undefined;

  try {
    const trace: string[] = [];
    const payload = await fetchCardDetailPayload(entry, trace);
    if (!payload) {
      const reason = trace.at(-1) ?? 'Card not found';
      devLog.warn('[deck import] Card not found:', entry.name, trace);
      result = {
        ...entry,
        found: false,
        importLookupReason: reason,
        importLookupTrace: [...trace],
        detail: { name: entry.name } as CardEntryDetail,
      };
    } else {
      const requestedSet = entry.set;
      const requestedCollector = entry.collector_number;
      const populated = populateCardInfo(payload, entry);

      result = {
        ...entry,
        ...populated,
        // Keep decklist printing on the entry; resolved printing lives in detail.
        set: requestedSet,
        collector_number: requestedCollector,
      };

      if (hasRequestedPrinting(entry) && !printingMatchesRequest(payload, entry)) {
        result.printingMismatch = true;
      }

      if (trace.some(step => step.startsWith('Fuzzy search matched'))) {
        result.importLookupTrace = trace;
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Card lookup failed';
    devLog.warn('[deck import] Lookup failed:', entry.name, message);
    result = {
      ...entry,
      found: false,
      importLookupReason: message,
      detail: { name: entry.name } as CardEntryDetail,
    };
  }

  if (cache && result) {
    cache.set(cacheKey, result);
  }

  if (result?.customArtUrl) {
    result = applyCustomArtToEntry(result);
    if (cache) {
      cache.set(cacheKey, result);
    }
  }

  return result;
}

async function fetchCardDetailBySetCollector(
  set: string,
  collectorNumber: string,
): Promise<CardEntryDetail | null> {
  return getCardBySetCollector(set, collectorNumber);
}

async function fetchCardDetailPayload(
  entry: CardEntry,
  trace: string[] = [],
): Promise<CardEntryDetail | null> {
  const { name, set, collector_number } = entry;

  if (set && collector_number) {
    trace.push(`Lookup ${set.toUpperCase()} #${collector_number}`);
    if (cardSystem.collectorLookup) {
      const byCollector = await fetchCardDetailBySetCollector(set, collector_number);
      if (byCollector) return byCollector;
      trace.push('Set/collector lookup returned no card');
    }

    const exact = await fetchCardDetailViaSetSearch(name, set, collector_number);
    if (exact) return exact;
    trace.push('No exact match in set search with collector number');
  } else if (set) {
    trace.push(`Lookup printing in ${set.toUpperCase()}`);
  }

  const payload = await getCardNamed(name, { set, id: entry.id });
  if (!payload) {
    trace.push(`Named lookup failed for "${name}"`);
  } else {
    const payloadSet = payload.set as string | undefined;
    const payloadCollector = payload.collector_number as string | undefined;
    const setMatches = !set || payloadSet?.toLowerCase() === set.toLowerCase();
    const collectorMatches =
      !collector_number ||
      payloadCollector?.toLowerCase() === collector_number.toLowerCase();

    if (setMatches && collectorMatches) {
      return payload;
    }

    trace.push(
      `Named lookup returned ${payloadSet?.toUpperCase() ?? '?'} #${payloadCollector ?? '?'} instead of requested printing`,
    );
  }

  if (set) {
    const fallback = await resolveSetOrDefault(entry, trace);
    if (fallback) return fallback;
  }

  trace.push(`Fuzzy search for "${name}"`);
  const fuzzy = await fetchCardDetailViaFuzzySearch(name);
  if (fuzzy) {
    trace.push(`Fuzzy search matched "${fuzzy.name}"`);
    return fuzzy;
  }

  trace.push(`No search results for "${name}"`);
  return null;
}

async function resolveSetOrDefault(entry: CardEntry, trace: string[] = []): Promise<CardEntryDetail | null> {
  const { name, set, collector_number } = entry;
  if (!set) return null;

  const fromSearch = await fetchCardDetailViaSetSearch(name, set, collector_number);
  if (fromSearch) return fromSearch;

  trace.push(`No match in set search for ${set.toUpperCase()}`);
  return null;
}

async function fetchCardDetailViaFuzzySearch(name: string): Promise<CardEntryDetail | null> {
  const body = await searchCards(buildExactNameSearchQuery(name), { page: 1 });
  const results = body.data ?? [];
  if (!results.length) return null;

  const match =
    results.find(card => cardNamesMatch(card.name, name)) ??
    results.find(card => normalizeCardName(card.name).includes(normalizeCardName(name))) ??
    results[0];

  if (!match?.id) return null;

  const fromSearch = detailFromSearchResult(match as CardEntryDetail);
  if (fromSearch) return fromSearch;

  return fetchCardDetailById(match.id);
}

async function fetchCardDetailViaSetSearch(
  name: string,
  set: string,
  collectorNumber?: string,
): Promise<CardEntryDetail | null> {
  let query = `!"${name.replace(/"/g, '\\"')}" set:${set}`;
  if (collectorNumber) {
    query += ` cn:${collectorNumber}`;
  }

  const body = await searchCards(query, { page: 1 });
  const match = body.data.find(card =>
    matchesSetSearchResult(card, name, set, collectorNumber),
  );
  if (!match?.id) return null;

  const fromSearch = detailFromSearchResult(match as CardEntryDetail);
  if (fromSearch) return fromSearch;

  return fetchCardDetailById(match.id);
}

export interface CardPrintingOption {
  id: string;
  name: string;
  set?: string;
  set_name?: string;
  collector_number?: string;
  lang?: string;
  released_at?: string;
  image_uris?: CardEntryDetail['image_uris'];
  card_faces?: Array<Pick<CardEntryDetail, 'image_uris' | 'name'>>;
}

export function entryToPrintingOption(entry: DetailedCardEntry): CardPrintingOption {
  const detail = entry.detail;
  return {
    id: entry.id ?? detail?.id ?? '',
    name: entry.name,
    set: entry.set ?? detail?.set,
    set_name: (detail as { set_name?: string })?.set_name,
    collector_number: entry.collector_number ?? detail?.collector_number,
    lang: (detail as { lang?: string })?.lang,
    released_at: (detail as { released_at?: string })?.released_at,
    image_uris: detail?.image_uris,
    card_faces: detail?.card_faces,
  };
}

export interface CardPrintingsResponse {
  data: CardPrintingOption[];
  page: number;
  total_pages: number;
  total_cards: number;
}

export function supportsCardPrintings() {
  return true;
}

export function getPrintingPreviewUrl(printing: CardPrintingOption) {
  return (
    resolveImageUrl(printing.image_uris) ??
    resolveImageUrl(printing.card_faces?.[0]?.image_uris)
  );
}

const DEFAULT_DECK_PREVIEW = '/arcane-table-back.webp';

function cardPopularity(card: DetailedCardEntry) {
  return card.detail?.popularity ?? (card as DetailedCardEntry & { popularity?: number }).popularity ?? 99999;
}

export function getDeckCoverCard(deck: StoredDeck): DetailedCardEntry | undefined {
  let best: DetailedCardEntry | undefined;

  const consider = (card: DetailedCardEntry) => {
    if ((card.qty ?? 0) <= 0) return;
    if (!best || cardPopularity(card) < cardPopularity(best)) {
      best = card;
    }
  };

  Object.values(deck.inPlay ?? {}).forEach(consider);
  Object.values(deck.cards ?? {}).forEach(consider);
  return best ?? Object.values(deck.cards ?? {}).find(card => (card.qty ?? 0) > 0);
}

function cardHasFullArt(detail: CardEntryDetail | undefined) {
  if (!detail) return false;

  const candidates = [detail, ...(detail.card_faces ?? [])];
  return candidates.some(face => {
    const extended = face as CardEntryDetail & {
      full_art?: boolean;
      frame_effects?: string[];
      illustration_type?: string;
    };
    if (extended.full_art) return true;
    if (extended.illustration_type === 'full_art') return true;
    return (
      extended.frame_effects?.some(
        effect => effect === 'extendedart' || effect === 'fullart' || effect === 'showcase',
      ) ?? false
    );
  });
}

export function getDeckCoverMetadata(
  deck: StoredDeck,
): Pick<StoredDeck, 'coverImage' | 'coverImageFullArt'> {
  const card = getDeckCoverCard(deck);
  if (!card?.detail) return {};

  const coverImage = normalizeTextureUrl(getCardArtImage(card)) ?? getCardArtImage(card);
  if (!coverImage) return { coverImageFullArt: cardHasFullArt(card.detail) };

  return {
    coverImage,
    coverImageFullArt: cardHasFullArt(card.detail),
  };
}

function scryfallCardImageUrl(card: DetailedCardEntry, version: 'normal' | 'art_crop' = 'normal') {
  if (card.id) {
    return `https://api.scryfall.com/cards/${encodeURIComponent(card.id)}?format=image&version=${version}`;
  }
  if (card.set && card.collector_number) {
    return `https://api.scryfall.com/cards/${encodeURIComponent(card.set)}/${encodeURIComponent(card.collector_number)}?format=image&version=${version}`;
  }
  return undefined;
}

export function getDeckPreviewImageUrl(deck: StoredDeck) {
  const card = getDeckCoverCard(deck);
  if (!card) return deck.coverImage ?? DEFAULT_DECK_PREVIEW;

  if (card.customArtUrl) {
    return normalizeTextureUrl(card.customArtUrl) ?? card.customArtUrl;
  }

  const useArtPreview = deck.coverImageFullArt === true || cardHasFullArt(card.detail);

  if (useArtPreview) {
    const art =
      normalizeTextureUrl(getCardArtImage(card)) ??
      deck.coverImage ??
      scryfallCardImageUrl(card, 'art_crop');
    if (art) return art;
  }

  if (deck.coverImage && deck.coverImageFullArt === true && !card.detail?.image_uris) {
    return deck.coverImage;
  }

  const fromDetail = getCardImage(card);
  if (fromDetail) return fromDetail;

  return scryfallCardImageUrl(card) ?? deck.coverImage ?? DEFAULT_DECK_PREVIEW;
}

/** @deprecated use getDeckCoverCard */
export function getDeckPreviewCard(deck: StoredDeck): DetailedCardEntry | undefined {
  return getDeckCoverCard(deck);
}

export function getPrintingLabel(printing: CardPrintingOption) {
  if (printing.set) return printing.set.toUpperCase();
  if (printing.set_name) return printing.set_name;
  if (printing.collector_number) return `#${printing.collector_number}`;
  return printing.id.slice(0, 8);
}

const printingMetaCache = new Map<
  string,
  Pick<CardPrintingOption, 'set' | 'set_name' | 'collector_number' | 'lang' | 'released_at'>
>();

async function fetchPrintingMeta(
  id: string,
): Promise<Pick<CardPrintingOption, 'set' | 'set_name' | 'collector_number' | 'lang' | 'released_at'>> {
  const cached = printingMetaCache.get(id);
  if (cached) return cached;

  const meta = await getCardById(id);
  if (!meta) return {};
  const result = {
    set: meta.set as string | undefined,
    set_name: (meta as { set_name?: string }).set_name,
    collector_number: meta.collector_number as string | undefined,
    lang: (meta as { lang?: string }).lang,
    released_at: (meta as { released_at?: string }).released_at,
  };
  printingMetaCache.set(id, result);
  return result;
}

async function enrichPrintingOptions(
  printings: CardPrintingOption[],
): Promise<CardPrintingOption[]> {
  const needsEnrich = printings.filter(printing => !printing.set);
  if (needsEnrich.length === 0) return printings;

  const concurrency = 12;
  const enriched = new Map<string, CardPrintingOption>();

  for (let index = 0; index < needsEnrich.length; index += concurrency) {
    const batch = needsEnrich.slice(index, index + concurrency);
    await Promise.all(
      batch.map(async printing => {
        const meta = await fetchPrintingMeta(printing.id);
        enriched.set(printing.id, { ...printing, ...meta });
      }),
    );
  }

  return printings.map(printing => enriched.get(printing.id) ?? printing);
}

const printingsCache = new Map<string, CardPrintingsResponse>();
const printingsInflight = new Map<string, Promise<CardPrintingsResponse>>();

function printingsCacheKey(name: string, page: number, query?: string) {
  return `${name}\0${page}\0${query ?? ''}`;
}

export function prefetchCardPrintings(name: string, page = 1, query?: string) {
  void fetchCardPrintings(name, page, query);
}

async function loadCardPrintings(
  name: string,
  page: number,
  query?: string,
): Promise<CardPrintingsResponse> {
  const body = await searchCards(
    query ?? `!"${name.replace(/"/g, '\\"')}" unique:prints`,
    { page },
  );

  const data = await enrichPrintingOptions(
    body.data
      .filter(card => card.name === name)
      .map(card => ({
        id: card.id!,
        name: card.name,
        set: card.set,
        set_name: (card as { set_name?: string }).set_name,
        collector_number: card.collector_number,
        lang: (card as { lang?: string }).lang,
        released_at: (card as { released_at?: string }).released_at,
        image_uris: card.image_uris,
        card_faces: card.card_faces,
      })),
  );

  return {
    data,
    page: body.page ?? page,
    total_pages: body.total_pages ?? 0,
    total_cards: body.total_cards ?? 0,
  };
}

export async function fetchCardPrintings(
  name: string,
  page = 1,
  query?: string,
): Promise<CardPrintingsResponse> {
  const key = printingsCacheKey(name, page, query);
  const cached = printingsCache.get(key);
  if (cached) return cached;

  const inflight = printingsInflight.get(key);
  if (inflight) return inflight;

  const promise = loadCardPrintings(name, page, query).then(result => {
    printingsCache.set(key, result);
    printingsInflight.delete(key);
    return result;
  });
  printingsInflight.set(key, promise);
  return promise;
}

export function populateCardInfo(detail: CardEntryDetail, entry?: Card) {
  let fields = {
    found: !!(detail?.id ?? detail?.name),
    id: detail?.id || entry?.id,
    set: detail?.set || entry?.set,
    collector_number: detail?.collector_number || entry?.collector_number,
    name: entry?.name || detail.name,
    search: detail?.search || getSearchLine(detail),
    popularity: detail?.popularity ?? detail[cardSystem.popularity],
  };

  return {
    ...fields,
    detail: {
      ...detail,
      ...fields,
    },
  };
}
