import { Vector3 } from 'three';
import { getProjectionVec } from './globals';
import { getPingTune } from './pingTuneSettings';
import { getPingType, PING_TYPES, type PingTypeId } from './pingTypes';

const PING_OVERLAY_Z = 115;

interface PooledPingVideo {
  video: HTMLVideoElement;
  inUse: boolean;
  ready: Promise<void>;
}

interface ActiveVideoPing {
  root: HTMLDivElement;
  video: HTMLVideoElement;
  pingType: PingTypeId;
}

const ACTIVE_VIDEO_PINGS: ActiveVideoPing[] = [];
const preloadPool = new Map<PingTypeId, PooledPingVideo>();
const playbackPool = new Map<PingTypeId, PooledPingVideo[]>();

function getPingPreloadSink() {
  let sink = document.getElementById('ping-video-preload-sink');
  if (!sink) {
    sink = document.createElement('div');
    sink.id = 'ping-video-preload-sink';
    sink.style.cssText =
      'position:fixed;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;left:-9999px;top:-9999px;';
    sink.setAttribute('aria-hidden', 'true');
    document.body.appendChild(sink);
  }
  return sink;
}

function suppressBrowserVideoUi() {
  if (!('mediaSession' in navigator)) return;

  navigator.mediaSession.metadata = null;
  navigator.mediaSession.playbackState = 'none';

  for (const action of ['play', 'pause', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack'] as const) {
    try {
      navigator.mediaSession.setActionHandler(action, null);
    } catch {
      // Unsupported action in this browser.
    }
  }
}

function configurePingVideoElement(video: HTMLVideoElement) {
  video.controls = false;
  video.disablePictureInPicture = true;
  video.disableRemotePlayback = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.setAttribute('disablepictureinpicture', '');
  video.setAttribute('disableremoteplayback', '');
  video.setAttribute('controlsList', 'nodownload nofullscreen noremoteplayback noplaybackrate');
  video.setAttribute('tabindex', '-1');
  video.setAttribute('aria-hidden', 'true');
  video.setAttribute('role', 'presentation');
  video.dataset.pingFx = 'true';

  video.addEventListener(
    'enterpictureinpicture',
    () => {
      void document.exitPictureInPicture?.();
    },
    { passive: true },
  );
}

function ensurePingChromaFilter() {
  if (document.getElementById('ping-chroma-svg')) return;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'ping-chroma-svg';
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.cssText = 'position:fixed;width:0;height:0;pointer-events:none;overflow:hidden';
  svg.innerHTML = `
    <defs>
      <filter id="ping-chroma-key"
        x="-50%" y="-50%" width="200%" height="200%"
        color-interpolation-filters="sRGB">
        <feColorMatrix in="SourceGraphic" type="matrix"
          values="1 0 0 0 0
                  0 1 0 0 0
                  0 0 1 0 0
                  1 -2 1 0 1" result="greenKeyed" />
        <feColorMatrix in="SourceGraphic" type="matrix"
          values="0 0 0 0 0
                  0 0 0 0 0
                  0 0 0 0 0
                  0.2126 0.7152 0.0722 0 0" result="luma" />
        <feComponentTransfer in="luma" result="lumaCut">
          <feFuncA type="linear" slope="12" intercept="-0.1" />
        </feComponentTransfer>
        <feComposite in="greenKeyed" in2="lumaCut" operator="in" />
      </filter>
    </defs>
  `;
  document.body.appendChild(svg);
}

function getPingOverlayRoot() {
  let root = document.getElementById('ping-video-overlay');
  if (!root) {
    root = document.createElement('div');
    root.id = 'ping-video-overlay';
    root.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:' +
      PING_OVERLAY_Z +
      ';overflow:visible;background:transparent;';
    document.body.appendChild(root);
  }
  return root;
}

function waitForVideoReady(video: HTMLVideoElement) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return Promise.resolve();
  }

  return new Promise<void>(resolve => {
    const done = () => resolve();
    video.addEventListener('loadeddata', done, { once: true });
    video.addEventListener('canplay', done, { once: true });
    video.addEventListener('error', done, { once: true });
  });
}

function createVideoElement(pingType: PingTypeId, muted: boolean) {
  const video = document.createElement('video');
  configurePingVideoElement(video);
  video.src = getPingType(pingType).videoSrc;
  video.muted = muted;
  return video;
}

function stylePingVideoShell(shell: HTMLDivElement, video: HTMLVideoElement, pingType: PingTypeId) {
  const tune = getPingTune(pingType);

  shell.style.cssText = [
    'display:block',
    'background:transparent',
    'overflow:visible',
    'pointer-events:none',
    'filter:url(#ping-chroma-key)',
    'isolation:isolate',
  ].join(';');

  video.style.cssText = [
    'display:block',
    `width:${tune.size}px`,
    'height:auto',
    'background:transparent',
    'pointer-events:none',
    'vertical-align:top',
  ].join(';');
}

/** Warm browser cache so pings start immediately on release. */
export function preloadPingVideos() {
  ensurePingChromaFilter();

  for (const type of PING_TYPES) {
    if (preloadPool.has(type.id)) continue;

    const video = createVideoElement(type.id, true);
    getPingPreloadSink().appendChild(video);

    const ready = new Promise<void>(resolve => {
      const done = () => resolve();
      video.addEventListener('canplaythrough', done, { once: true });
      video.addEventListener('error', done, { once: true });
      if (video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) done();
    });

    video.load();
    preloadPool.set(type.id, { video, inUse: false, ready });
  }
}

function acquirePlaybackVideo(pingType: PingTypeId, muted: boolean) {
  const pooled = preloadPool.get(pingType);
  const tune = getPingTune(pingType);
  let entries = playbackPool.get(pingType);
  if (!entries) {
    entries = [];
    playbackPool.set(pingType, entries);
  }

  let entry = entries.find(item => !item.inUse);
  if (!entry) {
    const video = createVideoElement(pingType, muted);
    entry = {
      video,
      inUse: true,
      ready: Promise.all([pooled?.ready ?? Promise.resolve(), waitForVideoReady(video)]).then(
        () => undefined,
      ),
    };
    entries.push(entry);
  } else {
    entry.inUse = true;
    entry.video.muted = muted || tune.volume <= 0;
    entry.ready = Promise.all([pooled?.ready ?? Promise.resolve(), waitForVideoReady(entry.video)]).then(
      () => undefined,
    );
  }

  return entry;
}

function releasePlaybackVideo(pingType: PingTypeId, video: HTMLVideoElement) {
  video.pause();
  video.currentTime = 0;

  const entries = playbackPool.get(pingType);
  const entry = entries?.find(item => item.video === video);
  if (entry) entry.inUse = false;
}

function disposeVideoPing(ping: ActiveVideoPing) {
  ping.video.pause();
  ping.video.currentTime = 0;
  ping.video.remove();
  ping.root.remove();
  releasePlaybackVideo(ping.pingType, ping.video);
}

export function clearVideoPings() {
  ACTIVE_VIDEO_PINGS.splice(0).forEach(disposeVideoPing);
  document.getElementById('ping-video-overlay')?.replaceChildren();
}

/** Play a greenscreen ping video at a table point, projected to 2D screen space. */
export function spawnVideoPing(worldPosition: Vector3, _worldNormal: Vector3, pingType: PingTypeId) {
  const screen = getProjectionVec(worldPosition.clone());
  if (!screen) return;

  ensurePingChromaFilter();

  const tune = getPingTune(pingType);
  const { video, ready } = acquirePlaybackVideo(pingType, tune.volume <= 0);

  const root = document.createElement('div');
  root.style.cssText = [
    'position:absolute',
    `left:${screen.x + tune.xOffset}px`,
    `top:${screen.y + tune.yOffset}px`,
    'transform:translate(-50%,-50%)',
    'pointer-events:none',
    'background:transparent',
    'overflow:visible',
  ].join(';');

  const shell = document.createElement('div');
  stylePingVideoShell(shell, video, pingType);
  shell.appendChild(video);
  root.appendChild(shell);
  getPingOverlayRoot().appendChild(root);

  const activePing: ActiveVideoPing = { root, video, pingType };
  ACTIVE_VIDEO_PINGS.push(activePing);

  const cleanup = () => {
    const index = ACTIVE_VIDEO_PINGS.indexOf(activePing);
    if (index >= 0) ACTIVE_VIDEO_PINGS.splice(index, 1);
    disposeVideoPing(activePing);
  };

  video.addEventListener('ended', cleanup, { once: true });
  video.addEventListener('error', cleanup, { once: true });

  const begin = () => {
    suppressBrowserVideoUi();
    video.volume = Math.max(0, Math.min(1, tune.volume));
    video.muted = tune.volume <= 0;
    video.currentTime = 0;
    void video.play().catch(cleanup);
  };

  void ready.then(begin);
}
