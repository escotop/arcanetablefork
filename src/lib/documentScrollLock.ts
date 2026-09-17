let lockCount = 0;

function applyLockedStyles() {
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
}

function applyUnlockedStyles() {
  document.documentElement.style.removeProperty('overflow');
  document.body.style.removeProperty('overflow');
  document.body.style.removeProperty('padding-right');
}

/** Prevent background scroll while a fullscreen overlay (e.g. deck editor) is open. */
export function lockDocumentScroll() {
  lockCount += 1;
  if (lockCount === 1) {
    applyLockedStyles();
  }
}

export function unlockDocumentScroll() {
  if (lockCount <= 0) {
    lockCount = 0;
    applyUnlockedStyles();
    return;
  }

  lockCount -= 1;
  if (lockCount === 0) {
    applyUnlockedStyles();
  }
}

/** Clear any leaked scroll lock (e.g. after closing modals or navigating home). */
export function resetDocumentScroll() {
  lockCount = 0;
  applyUnlockedStyles();
}
