/**
 * Live two-player sync simulator.
 *
 * Spawns two headless clients (separate processes, separate Y.Docs), relays Yjs
 * updates between them with network latency, runs scenarios through the real
 * game code paths, and compares what each player sees.
 *
 *   node scripts/live-sync-sim/run.mjs [scenario...]
 *
 * Env: SIM_LATENCY_MS (default 60), VITE_NODE_CLI (path to vite-node/dist/cli.mjs)
 */
import { fork, execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const LATENCY = Number(process.env.SIM_LATENCY_MS ?? 60);

function findViteNodeCli() {
  if (process.env.VITE_NODE_CLI) return process.env.VITE_NODE_CLI;
  const local = path.join(root, 'node_modules/vite-node/dist/cli.mjs');
  if (existsSync(local)) return local;
  // Fall back to the npx cache (npx vite-node installs it there).
  const npmCache = execSync('npm config get cache').toString().trim();
  const npxDir = path.join(npmCache, '_npx');
  const dirs = existsSync(npxDir) ? readdirSync(npxDir) : [];
  for (const dir of dirs) {
    const candidate = path.join(npmCache, '_npx', dir, 'node_modules/vite-node/dist/cli.mjs');
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('vite-node not found: run `npx vite-node --version` once or set VITE_NODE_CLI');
}

const VITE_NODE = findViteNodeCli();

class Client {
  constructor(name, clientId, seat, env = {}) {
    this.name = name;
    this.clientId = clientId;
    this.pending = new Map();
    this.nextId = 1;
    this.peer = null;
    this.queue = Promise.resolve();
    this.child = fork(
      VITE_NODE,
      ['--config', 'scripts/live-sync-sim/vite.config.ts', 'scripts/live-sync-sim/client.ts'],
      {
        cwd: root,
        env: {
          ...process.env,
          // Yjs deep-freezes log entries when NODE_ENV=development; the game mutates
          // them in place, so run like the production browser build.
          // SIM_STRICT=1 keeps Yjs dev mode: log entries get frozen, so any code that
          // mutates them throws and shows up as a failure.
          NODE_ENV: process.env.SIM_STRICT ? 'development' : 'test',
          SIM_CLIENT_ID: String(clientId),
          SIM_PREFIX: name,
          SIM_SEAT_INDEX: String(seat),
          ...env,
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      },
    );
    this.stderr = '';
    this.child.stderr.on('data', d => (this.stderr += d));
    this.child.stdout.on('data', d => {
      if (process.env.SIM_VERBOSE) process.stdout.write(`[${name}] ${d}`);
    });
    this.ready = new Promise((resolve, reject) => {
      this.child.on('exit', code => {
        const error = new Error(`${name} exited ${code}\n${this.stderr.slice(-3000)}`);
        if (code && !this.killed) console.error(error.message);
        for (const p of this.pending.values()) p.reject(error);
        this.pending.clear();
        reject(error);
      });
      this.child.on('message', msg => {
        if (msg.type === 'ready') resolve();
        else if (msg.type === 'y' || msg.type === 'aw') this.relay(msg);
        else if (msg.type === 'res') {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) p?.reject(new Error(`${name}: ${msg.error}`));
          else p?.resolve(msg.result);
        }
      });
    });
  }

  /** In-order delivery with fixed latency (like a websocket). */
  relay(msg) {
    const peer = this.peer;
    if (!peer) return;
    const deliverAt = Date.now() + LATENCY;
    this.queue = this.queue.then(async () => {
      const wait = deliverAt - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      peer.child.send(msg);
    });
  }

  cmd(name, args = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (!this.child.connected) {
        reject(new Error(`${this.name} is not running\n${this.stderr.slice(-3000)}`));
        return;
      }
      this.pending.set(id, { resolve, reject });
      this.child.send({ type: 'cmd', id, name, args });
    });
  }

  kill() {
    this.killed = true;
    this.child.kill();
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function startGame({ envA = {}, envB = {} } = {}) {
  const A = new Client('A', 1001, 0, envA);
  const B = new Client('B', 2002, 1, envB);
  A.peer = B;
  B.peer = A;
  await Promise.all([A.ready, B.ready]);
  await A.cmd('join');
  await sleep(LATENCY * 3);
  await B.cmd('join');
  await sleep(LATENCY * 3);
  // Settle between players so setup itself never races (races are tested on purpose).
  await A.cmd('draw', { count: 7 });
  await settle(A, B);
  await B.cmd('draw', { count: 7 });
  await settle(A, B);
  return { A, B };
}

async function settle(A, B) {
  await sleep(LATENCY * 3);
  await Promise.all([A.cmd('idle', { maxMs: 20_000 }), B.cmd('idle', { maxMs: 20_000 })]);
  await sleep(400); // let animations finish
}

/** Compare the actor's own view of a seat with the other player's view of it. */
function compareSeat(owner, ownerFp, observer, observerFp) {
  const problems = [];
  const mine = ownerFp.seats.find(s => s.clientId === owner.clientId);
  const theirs = observerFp.seats.find(s => s.clientId === owner.clientId);
  if (!mine || !theirs) return [`seat ${owner.name} missing on ${observer.name}`];

  if (mine.handCount !== theirs.handCount)
    problems.push(`hand count ${mine.handCount} vs ${theirs.handCount}`);
  if (mine.deckCount !== theirs.deckCount)
    problems.push(`deck count ${mine.deckCount} vs ${theirs.deckCount}`);
  if (JSON.stringify(mine.graveyard) !== JSON.stringify(theirs.graveyard))
    problems.push(`graveyard ${mine.graveyard} vs ${theirs.graveyard}`);

  const byId = new Map(theirs.battlefield.map(c => [c.id, c]));
  for (const card of mine.battlefield) {
    const other = byId.get(card.id);
    if (!other) {
      problems.push(`${card.id}: on ${owner.name}'s battlefield but NOT on ${observer.name}'s view`);
      continue;
    }
    if (card.tapped !== other.tapped)
      problems.push(`${card.id}: tapped=${card.tapped} for ${owner.name}, ${other.tapped} for ${observer.name}`);
    if (JSON.stringify(card.zonePos) !== JSON.stringify(other.zonePos))
      problems.push(`${card.id}: position ${card.zonePos} vs ${other.zonePos}`);
  }
  for (const card of theirs.battlefield) {
    if (!mine.battlefield.some(c => c.id === card.id))
      problems.push(`${card.id}: on ${observer.name}'s view but not on ${owner.name}'s battlefield`);
  }

  // Visual checks on the observer: is the card drawn where its state says?
  for (const card of theirs.battlefield) {
    const v = card.visual;
    if (!v.onBattlefieldMesh) problems.push(`${card.id}: [visual ${observer.name}] mesh not attached to battlefield`);
    if (v.posErr > 1) problems.push(`${card.id}: [visual ${observer.name}] drawn ${v.posErr} units away from its battlefield slot`);
    if (v.rotErr > 0.1)
      problems.push(`${card.id}: [visual ${observer.name}] rotation off by ${v.rotErr} rad (tapped=${card.tapped}, looksTapped=${v.looksTapped})`);
  }
  return problems;
}

async function check(label, A, B) {
  await settle(A, B);
  const [fa, fb] = await Promise.all([A.cmd('fingerprint'), B.cmd('fingerprint')]);
  const problems = [
    ...compareSeat(A, fa, B, fb).map(p => `A's seat as seen by B: ${p}`),
    ...compareSeat(B, fb, A, fa).map(p => `B's seat as seen by A: ${p}`),
  ];
  // Failed events are now logged and skipped instead of blocking the queue; surface them.
  for (const client of [A, B]) {
    const failures = (await client.cmd('buglog'))
      .split(String.fromCharCode(10))
      .filter(line => line.includes('entry-failed') || line.includes('unknown-event-type'));
    for (const line of failures.slice(0, 3)) problems.push(`[${client.name}] ${line.slice(0, 300)}`);
  }
  return { label, ok: problems.length === 0, problems, fa, fb };
}

// ---------- scenarios ----------
const scenarios = {
  /** Baseline: play a card, wait, tap it. */
  async baseline() {
    const { A, B } = await startGame();
    await A.cmd('play', { position: [10, 0, 0] });
    await sleep(800);
    await A.cmd('tap', {});
    return [await check('baseline play then tap', A, B), A, B];
  },

  /** Both players act at the same moment (inside the network latency window). */
  async concurrentTaps() {
    const { A, B } = await startGame();
    await A.cmd('play', { position: [10, 0, 0] });
    await B.cmd('play', { position: [10, 0, 0] });
    await settle(A, B);
    const before = await check('setup', A, B);
    if (!before.ok) before.problems.unshift('(setup already diverged)');
    for (let i = 0; i < 4; i++) {
      await Promise.all([A.cmd('tap', {}), B.cmd('tap', {})]);
      await sleep(500);
    }
    const result = await check('A and B tap at the same time x4', A, B);
    result.problems.push(
      `(info) yjs clientIDs A=${(await A.cmd('internals')).yjsClientId} B=${(await B.cmd('internals')).yjsClientId}`,
    );
    result.ok = result.problems.length === 1;
    return [result, A, B];
  },

  /** Land + mana: tap the card a few ms after dropping it. */
  async playThenFastTap() {
    const { A, B } = await startGame();
    const results = [];
    for (const tapAfterMs of [0, 5, 20, 60]) {
      await A.cmd('play', { position: [10 + tapAfterMs, 0, 0], tapAfterMs });
      await sleep(600);
    }
    return [await check('play then tap after 0/5/20/60ms', A, B), A, B];
  },

  /** Draw a card whose art is still downloading, play it at once and tap it (land + mana). */
  async drawPlayTapSlowArt() {
    const { A, B } = await startGame({ envA: { SIM_FETCH_DELAY_MS: '1500' } });
    await A.cmd('draw', { count: 1 });
    await A.cmd('play', { position: [25, 0, 0], tapAfterMs: 50, newest: true });
    return [await check('draw, play and tap while art loads', A, B), A, B];
  },

  /** Observer's tab is hidden (no animation frames) while the opponent plays and taps. */
  async hiddenTab() {
    const { A, B } = await startGame();
    await B.cmd('setRenderPaused', { value: true });
    await A.cmd('play', { position: [20, 0, 0] });
    await sleep(700);
    await A.cmd('tap', {});
    await sleep(700);
    await B.cmd('idle', { maxMs: 20_000 });
    await B.cmd('setRenderPaused', { value: false });
    return [await check('hidden tab: play then tap', A, B), A, B];
  },

  /** Observer's network/image proxy is slow: remote processing waits on textures. */
  async slowTextures() {
    const { A, B } = await startGame({ envB: { SIM_FETCH_DELAY_MS: '1500' } });
    const t0 = Date.now();
    await A.cmd('play', { position: [30, 0, 0] });
    await sleep(300);
    await A.cmd('tap', {});
    await sleep(300);
    const early = await B.cmd('fingerprint');
    const seatA = early.seats.find(s => s.clientId === A.clientId);
    const r = await check('slow textures: play then tap', A, B);
    r.problems.unshift(
      `(info) 600ms after A played+tapped, B shows A's battlefield as: ${JSON.stringify(
        seatA?.battlefield.map(c => ({ id: c.id, tapped: c.tapped })),
      )}; B processed ${early.processed}/${early.logLength}`,
    );
    r.ok = r.problems.length === 1;
    return [r, A, B];
  },

  /** Both players act at the same time for 30 rounds (draw/play/tap/graveyard). */
  async concurrentChaos() {
    const { A, B } = await startGame();
    let seed = Number(process.env.SIM_SEED ?? 7);
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const act = async actor => {
      const roll = rand();
      try {
        if (roll < 0.15) await actor.cmd('draw', { count: 1 });
        else if (roll < 0.5) await actor.cmd('play', { position: [Math.round(rand() * 120 - 60), Math.round(rand() * 40 - 20), 0], tapAfterMs: rand() < 0.3 ? Math.round(rand() * 80) : undefined });
        else if (roll < 0.85) await actor.cmd('tap', {});
        else await actor.cmd('toGraveyard', {});
      } catch {
        // invalid action for current state
      }
    };
    for (let i = 0; i < 30; i++) {
      await Promise.all([act(A), act(B)]);
      await sleep(Math.round(rand() * 120));
    }
    const result = await check('30 rounds of simultaneous actions', A, B);
    const ia = await A.cmd('internals');
    const ib = await B.cmd('internals');
    result.problems.push(`(info) yjs clientIDs A=${ia.yjsClientId} B=${ib.yjsClientId}`);
    result.ok = result.problems.length === 1;
    return [result, A, B];
  },

  /** B's view of A's seat breaks without any event; the seat digest check must repair it. */
  async selfHeal() {
    const { A, B } = await startGame();
    await A.cmd('play', { position: [10, 0, 0] });
    await A.cmd('play', { position: [40, 0, 0] });
    await sleep(500);
    await A.cmd('tap', {});
    await settle(A, B);
    await B.cmd('corruptRemote', { kind: 'hide' });
    await B.cmd('corruptRemote', { kind: 'untap' });
    const broken = await check('corrupted', A, B);
    const started = Date.now();
    let result = broken;
    while (Date.now() - started < 25_000) {
      await sleep(1000);
      result = await check("B repairs A's seat on its own", A, B);
      if (result.ok) break;
    }
    const fb = await B.cmd('fingerprint');
    result.problems.push(
      `(info) before repair: ${broken.problems.length} problems; repaired in ~${Math.round((Date.now() - started) / 1000)}s; seatSync events in log: ${fb.seatSyncEvents}`,
    );
    result.ok = result.problems.length === 1 && broken.problems.length > 0 && fb.seatSyncEvents > 0;
    return [result, A, B];
  },

  /** B reloads (log replay) while A keeps tapping; then B taps. Own events must not be re-applied. */
  async reconnectWhileOpponentActs() {
    // Slow art on B so applying A's plays takes a while (as with real image downloads).
    const { A, B } = await startGame({ envB: { SIM_FETCH_DELAY_MS: '1000' } });
    await A.cmd('play', { position: [10, 0, 0] });
    await B.cmd('play', { position: [10, 0, 0] });
    await settle(A, B);
    let reconnected = false;
    const spam = (async () => {
      for (let i = 0; !reconnected && i < 300; i++) {
        if (i % 5 === 0) await A.cmd('play', { position: [20 + i, 0, 0] }).catch(() => {});
        else await A.cmd('tap', {});
        await sleep(80);
      }
    })();
    await sleep(100);
    const reconnect = await B.cmd('reconnect', { settleMs: 400, finishWhileBehind: true });
    reconnected = true;
    await spam;
    await settle(A, B);
    if (process.env.SIM_DEBUG_RECONNECT) {
      console.log('B', JSON.stringify(await B.cmd('debugLog')));
      console.log('A', JSON.stringify(await A.cmd('debugLog')));
      const f = await B.cmd('fingerprint');
      console.log(JSON.stringify(f.seats.map(x => ({ c: x.clientId, hand: x.handCount, deck: x.deckCount, bf: x.battlefield.map(c => c.id) }))));
      const lines = (await B.cmd('buglog')).split(/\r?\n/);
      console.log(lines.filter(l => /dropped|missing|failed|anomaly/.test(l)).map(l => l.slice(0, 300)).join('\n'));
    }
    const soundsBefore = (await B.cmd('sounds')).filter(e => e.sound === 'tap' && !e.remote).length;
    for (let i = 0; i < 3; i++) {
      await B.cmd('tap', {});
      await sleep(400);
    }
    await settle(A, B);
    const soundsAfter = (await B.cmd('sounds')).filter(e => e.sound === 'tap' && !e.remote).length;
    const result = await check('B reloads while A acts, then B taps x3', A, B);
    const internals = await B.cmd('internals');
    const localTapSounds = soundsAfter - soundsBefore;
    if (localTapSounds !== 3) {
      result.problems.push(`B heard its own tap ${localTapSounds} times for 3 taps (own events re-applied)`);
    }
    result.problems.push(
      `(info) at reclaim initialReplayComplete=${reconnect.initialReplayComplete}; now ${internals.initialReplayComplete}`,
    );
    result.ok = result.problems.length === 1;
    return [result, A, B];
  },

  /** Random human-paced game, both players acting. */
  async randomGame() {
    const { A, B } = await startGame();
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 40; i++) {
      const actor = i % 2 === 0 ? A : B;
      const roll = rand();
      try {
        if (roll < 0.15) await actor.cmd('draw', { count: 1 });
        else if (roll < 0.45) await actor.cmd('play', { position: [Math.round(rand() * 120 - 60), Math.round(rand() * 40 - 20), 0], tapAfterMs: rand() < 0.3 ? Math.round(rand() * 80) : undefined });
        else if (roll < 0.85) await actor.cmd('tap', {});
        else await actor.cmd('toGraveyard', {});
      } catch {
        // invalid action for current state (empty hand, etc.)
      }
      await sleep(Math.round(50 + rand() * 400));
    }
    return [await check('random 40-action game', A, B), A, B];
  },
};

const selected = process.argv.slice(2);
const names = selected.length ? selected : Object.keys(scenarios);
let failed = 0;
for (const name of names) {
  const started = Date.now();
  let A, B;
  try {
    const [result, a, b] = await scenarios[name]();
    A = a;
    B = b;
    const status = result.ok ? 'OK  ' : 'FAIL';
    const resyncs = result.fa?.seatSyncEvents ?? 0;
    console.log(`${status} ${name} — ${result.label} (${Date.now() - started}ms, resyncs=${resyncs})`);
    for (const p of result.problems) console.log(`     · ${p}`);
    if (!result.ok) failed++;
    if (process.env.SIM_DUMP) {
      console.log(JSON.stringify({ A: result.fa, B: result.fb }, null, 2));
      console.log('sounds B', JSON.stringify(await B.cmd('sounds')));
      console.log('internals', JSON.stringify(await A.cmd('internals')), JSON.stringify(await B.cmd('internals')));
      const strip = text =>
        text
          .split('\n')
          .filter(line => line.includes('['))
          .map(line => line.replace(/"seats":\[[^\]]*\],/, '').replace(/"totalBattlefieldCards[^}]*?"syncLag":\d+,/, '').slice(0, 400))
          .join('\n');
      console.log('--- bug log A\n' + strip(await A.cmd('buglog')));
      console.log('--- bug log B\n' + strip(await B.cmd('buglog')));
    }
  } catch (error) {
    failed++;
    console.log(`ERR  ${name}: ${error.stack ?? error}`);
  } finally {
    A?.kill();
    B?.kill();
  }
}
process.exit(failed ? 1 : 0);
