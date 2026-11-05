/** Sound stub for the live sync sim: records which sounds each client "heard". */
type SoundEntry = { sound: string; remote: boolean; at: number };

function record(sound: string, remote?: boolean) {
  const log = ((globalThis as any).__simSounds ??= []) as SoundEntry[];
  log.push({ sound, remote: !!remote, at: Date.now() });
}

export function playDrawSound(remote?: boolean) {
  record('draw', remote);
}
export function playTapSound(remote?: boolean) {
  record('tap', remote);
}
export function playPlayCardSound(remote?: boolean) {
  record('playCard', remote);
}
export function playShuffleDeckSound(remote?: boolean) {
  record('shuffle', remote);
}
export function playCounterSoundForModifierChange() {}
export function playCounterUpSound() {}
export function playCounterDownSound() {}
export function playLifeChangeSound() {}
export function playTurnSound() {}
export function playCoinFlipSound() {}
export function playDiceRollSound() {}
export function previewLocalVolumeSound() {}
export function previewRemoteVolumeSound() {}
