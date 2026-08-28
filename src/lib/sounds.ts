import { isEventCatchUpComplete, settings } from './globals';

type SoundId = 'draw' | 'tap' | 'counterUp' | 'counterDown' | 'playCard' | 'shuffleDeck';

type PlaySoundOptions = {
  /** Allow playback before the game has finished loading (e.g. volume preview in settings). */
  preview?: boolean;
};

const SOUND_URLS: Record<SoundId, string> = {
  draw: '/sounds/draw-card-sound.mp3',
  tap: '/sounds/tap-card-sound.mp3',
  counterUp: '/sounds/up-counter-sound.mp3',
  counterDown: '/sounds/down-counter-sound.mp3',
  playCard: '/sounds/play-card-sound.mp3',
  shuffleDeck: '/sounds/shuffle-deck-sound.mp3',
};

const audioCache = new Map<SoundId, HTMLAudioElement>();

function playAudio(id: SoundId, remote = false, options: PlaySoundOptions = {}) {
  if (typeof window === 'undefined') return;
  if (!options.preview && !isEventCatchUpComplete()) return;

  let template = audioCache.get(id);
  if (!template) {
    template = new Audio(SOUND_URLS[id]);
    template.preload = 'auto';
    audioCache.set(id, template);
  }

  const audio = template.cloneNode() as HTMLAudioElement;
  audio.volume = remote ? settings.remoteSoundVolume : settings.localSoundVolume;
  void audio.play().catch(() => {});
}

export function playDrawSound(remote = false, options?: PlaySoundOptions) {
  playAudio('draw', remote, options);
}

export function playTapSound(remote = false, options?: PlaySoundOptions) {
  playAudio('tap', remote, options);
}

export function playCounterUpSound(remote = false, options?: PlaySoundOptions) {
  playAudio('counterUp', remote, options);
}

export function playCounterDownSound(remote = false, options?: PlaySoundOptions) {
  playAudio('counterDown', remote, options);
}

export function playPlayCardSound(remote = false, options?: PlaySoundOptions) {
  playAudio('playCard', remote, options);
}

export function playShuffleDeckSound(remote = false, options?: PlaySoundOptions) {
  playAudio('shuffleDeck', remote, options);
}

interface CardModifiers {
  power?: number;
  toughness?: number;
  counters?: Record<string, number>;
}

function modifierScore(modifiers: CardModifiers) {
  const power = modifiers.power ?? 0;
  const toughness = modifiers.toughness ?? 0;
  const counterTotal = Object.values(modifiers.counters ?? {}).reduce((sum, value) => sum + value, 0);
  return power + toughness + counterTotal;
}

export function playCounterSoundForModifierChange(
  prev: CardModifiers,
  next: CardModifiers,
  remote = false,
) {
  const delta = modifierScore(next) - modifierScore(prev);
  if (delta > 0) playCounterUpSound(remote);
  else if (delta < 0) playCounterDownSound(remote);
}
