import { getEventListeners } from 'node:events';
import type { IAuthProviderError } from '@mcp-abap-adt/interfaces-auth';
import { loadBuilt } from './builtPackage';

/**
 * Re-entrancy of `sharedAttempt` and `createParties` (spec §6b): a
 * consumer's signal runs foreign code — `addEventListener`,
 * `removeEventListener`, the `aborted` getter — and that code may call back
 * in. Whatever it does, it must see a consistent state, and the rules must
 * hold afterwards. Two reproduced cases, then a matrix: every foreign call
 * point of every operation × every re-entrant action × with or without a
 * peer waiter, each checked against the invariants.
 */
interface AttemptContext {
  readonly signal: AbortSignal;
  exclusive<R>(work: () => Promise<R>): Promise<R>;
}
type Start = (attempt: AttemptContext) => Promise<string>;
interface Slot {
  join(start: Start, signal?: AbortSignal): Promise<string>;
}
interface MomentWaiter {
  readonly signal: AbortSignal;
  release(): void;
}
interface Parties {
  attach(signal: AbortSignal): () => void;
  waiterSignal(): MomentWaiter | undefined;
}
type Failure = Error & { readonly error: IAuthProviderError };

const built = loadBuilt();
const sharedAttempt = built.sharedAttempt as (operation: string) => Slot;
const createParties = built.createParties as () => Parties;

async function flush(): Promise<void> {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
}

function track<T>(promise: Promise<T>): {
  state(): 'pending' | 'resolved' | 'rejected';
  reason(): unknown;
} {
  let state: 'pending' | 'resolved' | 'rejected' = 'pending';
  let reason: unknown;
  promise.then(
    () => {
      state = 'resolved';
    },
    (r: unknown) => {
      state = 'rejected';
      reason = r;
    },
  );
  return { state: () => state, reason: () => reason };
}

function isAborted(reason: unknown): boolean {
  const error = (reason as Failure | undefined)?.error;
  return (
    error?.kind === 'interactive-login' &&
    (error.facts as { outcome?: string }).outcome === 'aborted'
  );
}

/** A foreign signal over a real one, with one armed hook per call point. */
class Foreign {
  readonly controller = new AbortController();
  readonly inner = this.controller.signal;
  hook: { point: string; run: (listener?: () => void) => void } | undefined;
  #reads = 0;

  #fire(point: string, listener?: () => void): void {
    const hook = this.hook;
    if (hook !== undefined && hook.point === point) {
      this.hook = undefined;
      hook.run(listener);
    }
  }

  readonly signal = (() => {
    const self = this;
    return {
      get aborted(): boolean {
        self.#reads += 1;
        self.#fire(`get${self.#reads}`);
        return self.inner.aborted;
      },
      addEventListener(
        type: string,
        listener: () => void,
        options?: AddEventListenerOptions,
      ) {
        self.#fire('add', listener);
        self.inner.addEventListener(type, listener, options);
      },
      removeEventListener(type: string, listener: () => void) {
        self.#fire('remove', listener);
        self.inner.removeEventListener(type, listener);
      },
    } as unknown as AbortSignal;
  })();

  /** Arms a hook; `get` points count reads from now on. */
  arm(point: string, run: (listener?: () => void) => void): void {
    this.#reads = 0;
    this.hook = { point, run };
  }
}

/** Starts that run their work through `exclusive`, held until released. */
class Starts {
  running = 0;
  most = 0;
  calls = 0;
  readonly #gates: (() => void)[] = [];

  make(): Start {
    return (attempt) => {
      this.calls += 1;
      return attempt.exclusive(async () => {
        this.running += 1;
        this.most = Math.max(this.most, this.running);
        await new Promise<void>((resolve) => this.#gates.push(resolve));
        this.running -= 1;
        return 'token';
      });
    };
  }

  releaseAll(): void {
    for (const gate of this.#gates.splice(0)) gate();
  }
}

describe('re-entrancy: the reproduced cases', () => {
  it('detaching a party whose removal aborts the last other party aborts the moment', () => {
    const parties = createParties();
    const a = new Foreign();
    const b = new AbortController();
    const detachA = parties.attach(a.signal);
    parties.attach(b.signal);
    const moment = parties.waiterSignal();
    a.arm('remove', () => b.abort());
    detachA();
    expect(moment?.signal.aborted).toBe(true);
    expect(getEventListeners(a.inner, 'abort')).toHaveLength(0);
    expect(getEventListeners(b.signal, 'abort')).toHaveLength(0);
  });

  it('a join from the removal of the last aborted waiter starts afresh; the old attempt is aborted', async () => {
    const slot = sharedAttempt('token-request');
    const starts = new Starts();
    const x = new Foreign();
    const old = track(slot.join(starts.make(), x.signal));
    const first = starts.calls;
    let rejoined: ReturnType<typeof track> | undefined;
    const fresh = jest.fn(starts.make());
    x.arm('remove', () => {
      rejoined = track(slot.join(fresh));
    });
    x.controller.abort();
    expect(fresh).toHaveBeenCalledTimes(1);
    expect(first).toBe(1);
    await flush();
    expect(isAborted(old.reason())).toBe(true);
    starts.releaseAll();
    await flush();
    starts.releaseAll();
    await flush();
    expect(rejoined?.state()).toBe('resolved');
  });
});

describe('re-entrancy: the same member, again and again', () => {
  it('attach whose registration detaches the same party, 100 times: no listener stays', () => {
    const parties = createParties();
    const x = new Foreign();
    for (let i = 0; i < 100; i += 1) {
      x.arm('add', () => parties.attach(x.signal)());
      parties.attach(x.signal)();
    }
    expect(getEventListeners(x.inner, 'abort')).toHaveLength(0);
    expect(parties.waiterSignal()).toBeUndefined();
  });

  it('attach whose registration fires its own listener, 100 times: no listener stays', () => {
    const parties = createParties();
    const x = new Foreign();
    for (let i = 0; i < 100; i += 1) {
      x.arm('add', (listener) => listener?.());
      parties.attach(x.signal);
    }
    expect(getEventListeners(x.inner, 'abort')).toHaveLength(0);
    expect(parties.waiterSignal()).toBeUndefined();
  });

  it('join whose registration fires its own listener, 100 times: each refused, no listener stays, the slot free', async () => {
    const slot = sharedAttempt('token-request');
    const starts = new Starts();
    const x = new Foreign();
    const waiters: ReturnType<typeof track>[] = [];
    for (let i = 0; i < 100; i += 1) {
      x.arm('add', (listener) => listener?.());
      waiters.push(track(slot.join(starts.make(), x.signal)));
    }
    await flush();
    expect(waiters.every((t) => isAborted(t.reason()))).toBe(true);
    expect(getEventListeners(x.inner, 'abort')).toHaveLength(0);
    expect(starts.calls).toBe(0);
    const before = starts.calls;
    void slot.join(starts.make());
    expect(starts.calls).toBe(before + 1);
  });
});

type Op = 'join' | 'attach' | 'abandon' | 'settle' | 'detach' | 'release';
type Action =
  | 'join'
  | 'attach'
  | 'detach'
  | 'abortParty'
  | 'abortWaiter'
  | 'abortOwn'
  | 'releaseMoment'
  | 'detachSelf'
  | 'fireOwn';

const POINTS: readonly (readonly [Op, string])[] = [
  ['join', 'get1'],
  ['join', 'get2'],
  ['join', 'add'],
  ['attach', 'get1'],
  ['attach', 'get2'],
  ['attach', 'add'],
  ['abandon', 'remove'],
  ['settle', 'remove'],
  ['detach', 'remove'],
  ['release', 'remove'],
];
const ACTIONS: readonly Action[] = [
  'join',
  'attach',
  'detach',
  'abortParty',
  'abortWaiter',
  'abortOwn',
  'releaseMoment',
  'detachSelf',
  'fireOwn',
];

const MATRIX = POINTS.flatMap(([op, point]) =>
  ACTIONS.flatMap((action) =>
    [false, true].map((peer) => [op, point, action, peer] as const),
  ),
);

/** The moment's expected fate, from the events in their semantic order. */
class MomentModel {
  readonly members = new Set<string>();
  aborted = false;
  released = false;
  alive = false;

  create(live: readonly string[]): void {
    this.alive = true;
    for (const name of live) this.members.add(name);
  }
  attach(name: string): void {
    if (this.alive && !this.released && !this.aborted) this.members.add(name);
  }
  detach(name: string): void {
    this.members.delete(name);
  }
  abort(name: string): void {
    if (!this.members.delete(name)) return;
    if (this.members.size === 0 && !this.released) this.aborted = true;
  }
  release(): void {
    if (!this.aborted) this.released = true;
  }
}

describe('re-entrancy: the matrix', () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  beforeAll(() => process.on('unhandledRejection', onUnhandled));
  afterAll(() => process.off('unhandledRejection', onUnhandled));

  it(`holds the invariants in all ${MATRIX.length} cases`, async () => {
    const failures: string[] = [];
    for (const [op, point, action, peer] of MATRIX) {
      const label = `${op}@${point} → ${action}${peer ? ' (peer)' : ''}`;
      const problems = await runCase(op, point, action, peer);
      for (const problem of problems) failures.push(`${label}: ${problem}`);
    }
    expect(failures).toEqual([]);
    expect(unhandled).toEqual([]);
    expect(MATRIX.length).toBe(180);
  });
});

async function runCase(
  op: Op,
  point: string,
  action: Action,
  peer: boolean,
): Promise<string[]> {
  const problems: string[] = [];
  const parties = createParties();
  const model = new MomentModel();
  const slot = sharedAttempt('token-request');
  const momentSlot = sharedAttempt('token-request');
  const starts = new Starts();
  const momentStarts = new Starts();
  const x = new Foreign();
  const b = new AbortController();
  const w = new AbortController();
  const extras: AbortController[] = [];
  const realSignals: AbortSignal[] = [b.signal, w.signal, x.inner];
  const waiters: { name: string; t: ReturnType<typeof track> }[] = [];
  const unsignalled: ReturnType<typeof track>[] = [];
  const detaches = new Map<string, () => void>();
  /** Whether a waiter of slot 1 is live, as the rules see it. */
  const liveSlotWaiters = new Set<string>();

  // Parties: B always; X before the moment for detach / release.
  detaches.set('B', parties.attach(b.signal));
  if (op === 'detach' || op === 'release') {
    detaches.set('X', parties.attach(x.signal));
  }
  const moment = parties.waiterSignal();
  model.create(op === 'detach' || op === 'release' ? ['B', 'X'] : ['B']);
  const momentWaiter = track(
    momentSlot.join(momentStarts.make(), moment?.signal),
  );

  // Slot 1: a peer waiter and X for abandon / settle — X first for settle,
  // so its cleanup runs while the peer is still to be answered.
  const joinPeer = (): void => {
    if (!peer) return;
    waiters.push({ name: 'W', t: track(slot.join(starts.make(), w.signal)) });
    liveSlotWaiters.add('W');
  };
  if (op !== 'settle') joinPeer();
  if (op === 'abandon' || op === 'settle') {
    waiters.push({ name: 'X', t: track(slot.join(starts.make(), x.signal)) });
    liveSlotWaiters.add('X');
  }
  if (op === 'settle') joinPeer();
  await flush();

  // Whether a re-entrant join must start a fresh attempt.
  const expectFresh = (): boolean => {
    if (op === 'settle') return true;
    if (op === 'join') return point === 'get1' ? !peer : false;
    if (op === 'abandon') return !peer;
    return !peer;
  };

  const act = (listener?: () => void): void => {
    switch (action) {
      case 'join': {
        const before = starts.calls;
        unsignalled.push(track(slot.join(starts.make())));
        const fresh = starts.calls > before;
        if (fresh !== expectFresh())
          problems.push(`re-entrant join fresh=${fresh}`);
        break;
      }
      case 'attach': {
        const c = new AbortController();
        extras.push(c);
        realSignals.push(c.signal);
        model.attach('C');
        detaches.set('C', parties.attach(c.signal));
        break;
      }
      case 'detach':
        model.detach('B');
        detaches.get('B')?.();
        break;
      case 'abortParty':
        model.abort('B');
        b.abort();
        break;
      case 'abortWaiter':
        liveSlotWaiters.delete('W');
        w.abort();
        break;
      case 'abortOwn':
        model.abort('X');
        liveSlotWaiters.delete('X');
        x.controller.abort();
        break;
      case 'releaseMoment':
        model.release();
        moment?.release();
        break;
      case 'detachSelf': {
        // The member whose registration (or removal) runs detaches itself:
        // attach of the same signal answers its detach.
        if (op === 'attach' && point !== 'get1') model.detach('X');
        parties.attach(x.signal)();
        break;
      }
      case 'fireOwn':
        // The signal calls the listener it is registering (or removing) at
        // once, before forwarding: the member's own abort, re-entrantly.
        if (listener === undefined) break;
        if (op === 'attach' && point === 'add') model.abort('X');
        if (op === 'join' && point === 'add') liveSlotWaiters.delete('X');
        listener();
        break;
    }
  };

  x.arm(point, act);
  switch (op) {
    case 'join':
      waiters.push({
        name: 'X',
        t: track(slot.join(starts.make(), x.signal)),
      });
      break;
    case 'attach':
      // X joins the moment after its first read: an action at that read
      // happens before it is a member.
      if (point !== 'get1') model.attach('X');
      detaches.set('X', parties.attach(x.signal));
      if (point === 'get1' && !x.inner.aborted) model.attach('X');
      break;
    case 'abandon':
    case 'release':
      model.abort('X');
      liveSlotWaiters.delete('X');
      x.controller.abort();
      break;
    case 'settle':
      starts.releaseAll();
      break;
    case 'detach':
      model.detach('X');
      detaches.get('X')?.();
      break;
  }
  await flush();
  if (x.hook !== undefined) problems.push('the hook never fired');
  // A settled attempt answers every waiter it held, whatever the cleanups do.
  if (op === 'settle') {
    for (const { name, t } of waiters) {
      if (t.state() !== 'resolved')
        problems.push(
          `waiter ${name} of the settled attempt ended ${t.state()}`,
        );
    }
  }

  // X's listeners, before cleanup: one per live registration of X, none
  // left behind by a member that left while its registration ran.
  const xParty = ((): boolean => {
    if (x.inner.aborted) return false;
    if (op !== 'attach') return false;
    if (action === 'detachSelf') return point === 'get1';
    if (action === 'fireOwn') return point !== 'add';
    return true;
  })();
  const xWaiter = ((): boolean => {
    if (x.inner.aborted) return false;
    if (op !== 'join') return false;
    return !(action === 'fireOwn' && point === 'add');
  })();
  const expectedListeners = (xParty ? 1 : 0) + (xWaiter ? 1 : 0);
  const listeners = getEventListeners(x.inner, 'abort').length;
  if (listeners !== expectedListeners)
    problems.push(
      `X holds ${listeners} listener(s), expected ${expectedListeners}`,
    );

  // The moment, before cleanup: aborted exactly when the model says.
  if ((moment?.signal.aborted ?? false) !== model.aborted) {
    problems.push(
      `moment aborted=${moment?.signal.aborted} expected ${model.aborted}`,
    );
  }

  // Cleanup: every party and waiter aborts, in a fixed order; every hold
  // is released.
  for (const [name, controller] of [
    ['B', b],
    ['X', x.controller],
    ['C', extras[0]],
  ] as const) {
    if (controller !== undefined && !controller.signal.aborted) {
      model.abort(name);
      controller.abort();
    }
  }
  w.abort();
  for (let round = 0; round < 4; round += 1) {
    starts.releaseAll();
    momentStarts.releaseAll();
    await flush();
  }

  if ((moment?.signal.aborted ?? false) !== model.aborted) {
    problems.push(
      `after cleanup: moment aborted=${moment?.signal.aborted} expected ${model.aborted}`,
    );
  }
  if (momentWaiter.state() === 'pending')
    problems.push('the moment’s waiter never settled');
  if (momentWaiter.state() === 'rejected' && !isAborted(momentWaiter.reason()))
    problems.push('the moment’s waiter was refused other than aborted');
  for (const { name, t } of waiters) {
    if (t.state() === 'pending') problems.push(`waiter ${name} never settled`);
  }
  for (const t of unsignalled) {
    if (t.state() !== 'resolved')
      problems.push(`an unsignalled waiter ended ${t.state()}`);
  }
  if (starts.most > 1 || momentStarts.most > 1)
    problems.push('two exclusive works ran at once');
  for (const signal of [...realSignals, moment?.signal]) {
    if (signal !== undefined && getEventListeners(signal, 'abort').length > 0)
      problems.push('a listener stayed');
  }
  // The slot is free: a fresh join starts afresh.
  const before = starts.calls;
  const last = track(slot.join(starts.make()));
  if (starts.calls !== before + 1) problems.push('the slot was not released');
  for (let round = 0; round < 3; round += 1) {
    starts.releaseAll();
    await flush();
  }
  if (last.state() !== 'resolved') problems.push('the last join did not end');
  for (const detach of detaches.values()) detach();
  return problems;
}
