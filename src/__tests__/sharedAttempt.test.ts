import { getEventListeners } from 'node:events';
import type { IAuthProviderError } from '@mcp-abap-adt/interfaces-auth';
import { loadBuilt, loadBuiltModule } from './builtPackage';

/**
 * `sharedAttempt` (spec §6b), run against the built package: the waiter
 * rules, the doomed-join window and the drain handoff. Every wait is a
 * controllable promise; no test sleeps.
 */
interface AttemptContext {
  readonly signal: AbortSignal;
  exclusive<R>(work: () => Promise<R>): Promise<R>;
}
type Start<T> = (attempt: AttemptContext) => Promise<T>;
interface Slot<T> {
  join(start: Start<T>, signal?: AbortSignal): Promise<T>;
}
type Failure = Error & { readonly error: IAuthProviderError };

const built = loadBuilt();
const sharedAttempt = built.sharedAttempt as <T>(operation: string) => Slot<T>;
const isAuthProviderFailure = built.isAuthProviderFailure as (
  value: unknown,
) => boolean;
const isMinted = built.isMinted as (value: unknown) => boolean;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every queued microtask (and their follow-ups) run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

/** A start whose attempt is held until the test settles it. */
function heldStart<T>(): {
  readonly start: jest.Mock<Promise<T>, [AttemptContext]>;
  readonly result: Deferred<T>;
  context(): AttemptContext;
} {
  const result = deferred<T>();
  const start = jest.fn((_: AttemptContext) => result.promise);
  return {
    start,
    result,
    context(): AttemptContext {
      const call = start.mock.calls[0];
      if (call === undefined) throw new Error('start was not called');
      return call[0];
    },
  };
}

/** The settled state of a promise, without waiting for it to settle. */
function track<T>(promise: Promise<T>): {
  state(): 'pending' | 'resolved' | 'rejected';
  value(): T | undefined;
  reason(): unknown;
} {
  let state: 'pending' | 'resolved' | 'rejected' = 'pending';
  let value: T | undefined;
  let reason: unknown;
  promise.then(
    (v) => {
      state = 'resolved';
      value = v;
    },
    (r) => {
      state = 'rejected';
      reason = r;
    },
  );
  return { state: () => state, value: () => value, reason: () => reason };
}

/** The rejection is this copy's `interactive-login` `aborted` failure. */
function expectAborted(reason: unknown): void {
  expect(isAuthProviderFailure(reason)).toBe(true);
  const error = (reason as Failure).error;
  expect(isMinted(error)).toBe(true);
  expect(error.kind).toBe('interactive-login');
  expect(error.facts).toStrictEqual({ outcome: 'aborted' });
  expect(error.reason).toBe('the authorization was aborted');
  expect((reason as Failure).message).toBe('the authorization was aborted');
}

describe('sharedAttempt — waiters', () => {
  it('one waiter of two aborts: only it rejects aborted; the other gets the result of the one start', async () => {
    const slot = sharedAttempt<string>('token-request');
    const held = heldStart<string>();
    const first = new AbortController();
    const second = new AbortController();
    const a = track(slot.join(held.start, first.signal));
    const b = track(slot.join(held.start, second.signal));

    first.abort();
    await flush();
    expect(a.state()).toBe('rejected');
    expectAborted(a.reason());
    expect(b.state()).toBe('pending');
    expect(held.context().signal.aborted).toBe(false);

    held.result.resolve('token');
    await flush();
    expect(b.state()).toBe('resolved');
    expect(b.value()).toBe('token');
    expect(held.start).toHaveBeenCalledTimes(1);
    expect(held.context().signal.aborted).toBe(false);
  });

  it('a later join while the attempt runs shares it: start is called once', async () => {
    const slot = sharedAttempt<string>('token-request');
    const held = heldStart<string>();
    const other = jest.fn(() => Promise.resolve('other'));
    const a = slot.join(held.start);
    const b = slot.join(other);
    held.result.resolve('token');
    await expect(Promise.all([a, b])).resolves.toStrictEqual([
      'token',
      'token',
    ]);
    expect(held.start).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it('every waiter aborts: the attempt signal aborts, and the slot is empty before it does', async () => {
    const slot = sharedAttempt<string>('token-request');
    const held = heldStart<string>();
    const first = new AbortController();
    const second = new AbortController();
    const a = track(slot.join(held.start, first.signal));
    const b = track(slot.join(held.start, second.signal));
    const signal = held.context().signal;

    // Joined from the attempt's own abort listener: the slot must already be
    // empty, so this join starts a fresh attempt at once.
    const fresh = heldStart<string>();
    let joinedFromAbort: ReturnType<typeof track<string>> | undefined;
    signal.addEventListener('abort', () => {
      joinedFromAbort = track(slot.join(fresh.start));
    });

    first.abort();
    expect(signal.aborted).toBe(false);
    second.abort();
    expect(signal.aborted).toBe(true);
    expect(fresh.start).toHaveBeenCalledTimes(1);

    await flush();
    expectAborted(a.reason());
    expectAborted(b.reason());
    fresh.result.resolve('fresh');
    await flush();
    expect(joinedFromAbort?.value()).toBe('fresh');
  });

  it('the slot is empty when the last waiter’s rejection is observed', async () => {
    const slot = sharedAttempt<string>('token-request');
    const held = heldStart<string>();
    const controller = new AbortController();
    const fresh = heldStart<string>();
    const observed = slot.join(held.start, controller.signal).catch(() => {
      void slot.join(fresh.start);
      return fresh.start.mock.calls.length;
    });
    controller.abort();
    await expect(observed).resolves.toBe(1);
    expect(held.start).toHaveBeenCalledTimes(1);
  });

  it('a waiter without a signal keeps the attempt alive', async () => {
    const slot = sharedAttempt<string>('token-request');
    const held = heldStart<string>();
    const controller = new AbortController();
    const unsignalled = track(slot.join(held.start));
    const signalled = track(slot.join(held.start, controller.signal));
    controller.abort();
    await flush();
    expectAborted(signalled.reason());
    expect(held.context().signal.aborted).toBe(false);
    held.result.resolve('token');
    await flush();
    expect(unsignalled.value()).toBe('token');
  });

  it('doomed join: after every waiter aborted, a join while the old start is pending starts afresh; the late result changes nothing', async () => {
    const slot = sharedAttempt<string>('token-request');
    const old = heldStart<string>();
    const controller = new AbortController();
    const doomed = track(slot.join(old.start, controller.signal));
    controller.abort();

    const fresh = heldStart<string>();
    const next = track(slot.join(fresh.start));
    expect(fresh.start).toHaveBeenCalledTimes(1);

    old.result.resolve('late');
    await flush();
    expectAborted(doomed.reason());
    expect(next.state()).toBe('pending');

    fresh.result.resolve('fresh');
    await flush();
    expect(next.value()).toBe('fresh');
  });

  it('a waiter whose signal is already aborted is refused aborted and starts nothing', async () => {
    const slot = sharedAttempt<string>('token-request');
    const held = heldStart<string>();
    const a = track(slot.join(held.start, AbortSignal.abort()));
    await flush();
    expectAborted(a.reason());
    expect(held.start).not.toHaveBeenCalled();

    // Joining a running attempt with an aborted signal neither counts nor ends it.
    const b = track(slot.join(held.start));
    const c = track(slot.join(held.start, AbortSignal.abort()));
    await flush();
    expectAborted(c.reason());
    expect(held.context().signal.aborted).toBe(false);
    held.result.resolve('token');
    await flush();
    expect(b.value()).toBe('token');
  });

  it('a settled waiter leaves no listener on its signal', async () => {
    const slot = sharedAttempt<string>('token-request');
    const held = heldStart<string>();
    const kept = new AbortController();
    const aborting = new AbortController();
    const a = slot.join(held.start, kept.signal);
    void slot.join(held.start, aborting.signal).catch(() => undefined);
    expect(getEventListeners(kept.signal, 'abort')).toHaveLength(1);
    aborting.abort();
    expect(getEventListeners(aborting.signal, 'abort')).toHaveLength(0);
    held.result.resolve('token');
    await expect(a).resolves.toBe('token');
    expect(getEventListeners(kept.signal, 'abort')).toHaveLength(0);
    // An abort after the result changes nothing.
    kept.abort();
    await expect(a).resolves.toBe('token');
  });
});

describe('sharedAttempt — settling', () => {
  it('a resolved attempt leaves the slot: the next join starts afresh', async () => {
    const slot = sharedAttempt<string>('token-request');
    await expect(slot.join(() => Promise.resolve('one'))).resolves.toBe('one');
    await expect(slot.join(() => Promise.resolve('two'))).resolves.toBe('two');
  });

  it('a rejected attempt leaves the slot: the next join starts afresh', async () => {
    const slot = sharedAttempt<string>('token-request');
    await expect(
      slot.join(() => Promise.reject(new Error('down'))),
    ).rejects.toBeDefined();
    await expect(slot.join(() => Promise.resolve('two'))).resolves.toBe('two');
  });

  it('a start that throws synchronously rejects every waiter with its classified failure, no foreign value', async () => {
    const slot = sharedAttempt<string>('device-authorization');
    const thrown = Object.assign(new Error('secret-in-the-message'), {
      status: 500,
    });
    const start = (): Promise<string> => {
      throw thrown;
    };
    const a = slot.join(start);
    const b = slot.join(start);
    for (const waiter of [a, b]) {
      const reason = await waiter.then(
        () => undefined,
        (r: unknown) => r,
      );
      expect(reason).not.toBe(thrown);
      expect(isAuthProviderFailure(reason)).toBe(true);
      const error = (reason as Failure).error;
      expect(error.kind).toBe('unknown');
      expect(error.facts).toStrictEqual({
        operation: 'device-authorization',
        status: 500,
      });
      expect(JSON.stringify(reason)).not.toContain('secret');
      expect(String(reason)).not.toContain('secret');
      expect((reason as { cause?: unknown }).cause).toBeUndefined();
    }
  });

  it('a start that rejects with a primitive or a failure of this copy is classified', async () => {
    const slot = sharedAttempt<string>('token-request');
    const primitive = await slot
      .join(() => Promise.reject('secret'))
      .then(
        () => undefined,
        (r: unknown) => r,
      );
    expect((primitive as Failure).error.facts).toStrictEqual({
      operation: 'token-request',
    });

    const AuthProviderFailure = built.AuthProviderFailure as new (
      error: unknown,
    ) => Failure;
    const authError = built.authError as Record<
      string,
      (facts: unknown) => IAuthProviderError
    >;
    const minted = authError['client-certificate']?.({ problem: 'expired' });
    const failure = new AuthProviderFailure(minted);
    const reason = await slot
      .join(() => Promise.reject(failure))
      .then(
        () => undefined,
        (r: unknown) => r,
      );
    expect(isAuthProviderFailure(reason)).toBe(true);
    expect((reason as Failure).error).toBe(minted);
  });

  it('a start returning a thenable whose then throws is classified, not thrown', async () => {
    const slot = sharedAttempt<string>('token-request');
    const hostile = Object.defineProperty({}, 'then', {
      get() {
        throw new Error('secret');
      },
    }) as Promise<string>;
    const reason = await slot
      .join(() => hostile)
      .then(
        () => undefined,
        (r: unknown) => r,
      );
    expect(isAuthProviderFailure(reason)).toBe(true);
    expect(String(reason)).not.toContain('secret');
  });

  it('an attempt that ends after every waiter left raises no unhandled rejection', async () => {
    const slot = sharedAttempt<string>('token-request');
    const held = heldStart<string>();
    const controller = new AbortController();
    const waiter = slot.join(held.start, controller.signal);
    controller.abort();
    await expect(waiter).rejects.toBeDefined();
    held.result.reject(new Error('late failure'));
    await flush();
  });
});

describe('sharedAttempt — drain handoff', () => {
  it('a new attempt’s exclusive work waits for the aborted attempt’s drain', async () => {
    const slot = sharedAttempt<string>('browser-login');
    const oldWork = deferred<string>();
    const oldController = new AbortController();
    const old = track(
      slot.join(
        (attempt) => attempt.exclusive(() => oldWork.promise),
        oldController.signal,
      ),
    );
    await flush();
    oldController.abort();

    const newWork = jest.fn(() => Promise.resolve('fresh'));
    const next = track(slot.join((attempt) => attempt.exclusive(newWork)));
    await flush();
    expect(newWork).not.toHaveBeenCalled();

    oldWork.resolve('late');
    await flush();
    expect(newWork).toHaveBeenCalledTimes(1);
    expect(next.value()).toBe('fresh');
    expectAborted(old.reason());
  });

  it('work outside exclusive (a refresh) does not wait for the drain', async () => {
    const slot = sharedAttempt<string>('refresh');
    const oldWork = deferred<string>();
    const oldController = new AbortController();
    void slot
      .join(
        (attempt) => attempt.exclusive(() => oldWork.promise),
        oldController.signal,
      )
      .catch(() => undefined);
    await flush();
    oldController.abort();
    await expect(slot.join(() => Promise.resolve('refreshed'))).resolves.toBe(
      'refreshed',
    );
  });

  it('the drain wait ends aborted when the new attempt’s only waiter aborts; its work never starts', async () => {
    const slot = sharedAttempt<string>('browser-login');
    const oldWork = deferred<string>();
    const oldController = new AbortController();
    void slot
      .join(
        (attempt) => attempt.exclusive(() => oldWork.promise),
        oldController.signal,
      )
      .catch(() => undefined);
    await flush();
    oldController.abort();

    const newWork = jest.fn(() => Promise.resolve('fresh'));
    let waited: ReturnType<typeof track<string>> | undefined;
    const newController = new AbortController();
    const next = track(
      slot.join((attempt) => {
        const wait = attempt.exclusive(newWork);
        waited = track(wait);
        return wait;
      }, newController.signal),
    );
    await flush();
    newController.abort();
    await flush();
    expectAborted(next.reason());
    expect(waited?.state()).toBe('rejected');
    expectAborted(waited?.reason());

    oldWork.resolve('late');
    await flush();
    expect(newWork).not.toHaveBeenCalled();
  });

  it('three aborted attempts chain their drains: the fourth waits for the first’s work', async () => {
    const slot = sharedAttempt<string>('browser-login');
    const firstWork = deferred<string>();
    const exclusiveStart =
      (work: () => Promise<string>) =>
      (attempt: AttemptContext): Promise<string> =>
        attempt.exclusive(work);
    const abortedJoin = async (
      work: () => Promise<string>,
    ): Promise<jest.Mock> => {
      const controller = new AbortController();
      const mock = jest.fn(work);
      void slot
        .join(exclusiveStart(mock), controller.signal)
        .catch(() => undefined);
      await flush();
      controller.abort();
      return mock;
    };
    const first = await abortedJoin(() => firstWork.promise);
    const second = await abortedJoin(() => Promise.resolve('second'));
    const third = await abortedJoin(() => Promise.resolve('third'));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(third).not.toHaveBeenCalled();

    const fourthWork = jest.fn(() => Promise.resolve('fourth'));
    const fourth = track(slot.join(exclusiveStart(fourthWork)));
    await flush();
    expect(fourthWork).not.toHaveBeenCalled();

    firstWork.resolve('late');
    await flush();
    expect(fourthWork).toHaveBeenCalledTimes(1);
    expect(fourth.value()).toBe('fourth');
    expect(second).not.toHaveBeenCalled();
    expect(third).not.toHaveBeenCalled();
  });

  it('a drain whose work rejected still releases the next attempt', async () => {
    const slot = sharedAttempt<string>('browser-login');
    const oldWork = deferred<string>();
    const oldController = new AbortController();
    void slot
      .join(
        (attempt) => attempt.exclusive(() => oldWork.promise),
        oldController.signal,
      )
      .catch(() => undefined);
    await flush();
    oldController.abort();
    const newWork = jest.fn(() => Promise.resolve('fresh'));
    const next = slot.join((attempt) => attempt.exclusive(newWork));
    oldWork.reject(new Error('socket closed badly'));
    await expect(next).resolves.toBe('fresh');
  });

  it('a settled attempt hands on the drain it inherited', async () => {
    const slot = sharedAttempt<string>('browser-login');
    const oldWork = deferred<string>();
    const oldController = new AbortController();
    void slot
      .join(
        (attempt) => attempt.exclusive(() => oldWork.promise),
        oldController.signal,
      )
      .catch(() => undefined);
    await flush();
    oldController.abort();
    // A refresh-only attempt settles without waiting for the drain …
    await expect(slot.join(() => Promise.resolve('refreshed'))).resolves.toBe(
      'refreshed',
    );
    // … and the next exclusive work still waits for the aborted one's.
    const newWork = jest.fn(() => Promise.resolve('fresh'));
    const next = track(slot.join((attempt) => attempt.exclusive(newWork)));
    await flush();
    expect(newWork).not.toHaveBeenCalled();
    oldWork.resolve('late');
    await flush();
    expect(next.value()).toBe('fresh');
  });

  it('exclusive called after the attempt was aborted starts nothing', async () => {
    const slot = sharedAttempt<string>('browser-login');
    const held = heldStart<string>();
    const controller = new AbortController();
    void slot.join(held.start, controller.signal).catch(() => undefined);
    controller.abort();
    const work = jest.fn(() => Promise.resolve('never'));
    const late = held.context().exclusive(work);
    await expect(late).rejects.toBeDefined();
    expectAborted(await late.catch((r: unknown) => r));
    expect(work).not.toHaveBeenCalled();
  });

  it('exclusive called after the abort ends at once, without waiting for a pending drain', async () => {
    const slot = sharedAttempt<string>('browser-login');
    const oldWork = deferred<string>();
    const oldController = new AbortController();
    void slot
      .join(
        (attempt) => attempt.exclusive(() => oldWork.promise),
        oldController.signal,
      )
      .catch(() => undefined);
    await flush();
    oldController.abort();

    const held = heldStart<string>();
    const controller = new AbortController();
    void slot.join(held.start, controller.signal).catch(() => undefined);
    controller.abort();
    const work = jest.fn(() => Promise.resolve('never'));
    const late = track(held.context().exclusive(work));
    await flush();
    expect(late.state()).toBe('rejected');
    expectAborted(late.reason());
    oldWork.resolve('late');
    await flush();
    expect(work).not.toHaveBeenCalled();
  });
});

describe('sharedAttempt — exclusive within one attempt', () => {
  it('two overlapping exclusive calls run one at a time, in call order', async () => {
    const slot = sharedAttempt<string>('browser-login');
    let running = 0;
    let most = 0;
    const order: string[] = [];
    const gates = [deferred<void>(), deferred<void>()];
    const work = (name: string, gate: Deferred<void>) => async () => {
      running += 1;
      most = Math.max(most, running);
      order.push(`start ${name}`);
      await gate.promise;
      order.push(`end ${name}`);
      running -= 1;
      return name;
    };
    const [firstGate, secondGate] = gates as [Deferred<void>, Deferred<void>];
    const result = slot.join(async (attempt) => {
      const first = attempt.exclusive(work('first', firstGate));
      const second = attempt.exclusive(work('second', secondGate));
      return (await Promise.all([first, second])).join('+');
    });
    await flush();
    expect(order).toStrictEqual(['start first']);
    secondGate.resolve();
    await flush();
    expect(order).toStrictEqual(['start first']);
    firstGate.resolve();
    await expect(result).resolves.toBe('first+second');
    expect(order).toStrictEqual([
      'start first',
      'end first',
      'start second',
      'end second',
    ]);
    expect(most).toBe(1);
  });

  it('a second exclusive call waits for the first even when the first work rejects', async () => {
    const slot = sharedAttempt<string>('browser-login');
    const firstGate = deferred<string>();
    const second = jest.fn(() => Promise.resolve('second'));
    const result = slot.join(async (attempt) => {
      const first = attempt.exclusive(() => firstGate.promise);
      const next = attempt.exclusive(second);
      await first.catch(() => undefined);
      return next;
    });
    await flush();
    expect(second).not.toHaveBeenCalled();
    firstGate.reject(new Error('closed badly'));
    await expect(result).resolves.toBe('second');
  });

  it('work that synchronously aborts its last waiter and re-joins is already in the drain', async () => {
    const slot = sharedAttempt<string>('browser-login');
    let running = 0;
    let most = 0;
    const firstGate = deferred<string>();
    const controller = new AbortController();
    let replacement: Promise<string> | undefined;
    const secondWork = jest.fn(async () => {
      running += 1;
      most = Math.max(most, running);
      running -= 1;
      return 'second';
    });
    void slot
      .join(
        (attempt) =>
          attempt.exclusive(() => {
            running += 1;
            most = Math.max(most, running);
            controller.abort();
            replacement = slot.join((next) => next.exclusive(secondWork));
            return firstGate.promise.finally(() => {
              running -= 1;
            });
          }),
        controller.signal,
      )
      .catch(() => undefined);
    await flush();
    expect(replacement).toBeDefined();
    expect(secondWork).not.toHaveBeenCalled();
    firstGate.resolve('first');
    await expect(replacement).resolves.toBe('second');
    expect(most).toBe(1);
  });

  it('an abort landing in any microtask gap after the drain settles keeps the work from starting', async () => {
    const startedAfterAbort: number[] = [];
    for (let depth = 0; depth < 15; depth += 1) {
      const slot = sharedAttempt<string>('browser-login');
      const oldWork = deferred<string>();
      const oldController = new AbortController();
      void slot
        .join(
          (attempt) => attempt.exclusive(() => oldWork.promise),
          oldController.signal,
        )
        .catch(() => undefined);
      await flush();
      oldController.abort();

      const controller = new AbortController();
      let began = false;
      void slot
        .join(
          (attempt) =>
            attempt.exclusive(async () => {
              if (attempt.signal.aborted) began = true;
              return 'fresh';
            }),
          controller.signal,
        )
        .catch(() => undefined);
      await flush();
      oldWork.resolve('late');
      let gap = Promise.resolve();
      for (let i = 0; i < depth; i += 1) gap = gap.then(() => undefined);
      void gap.then(() => controller.abort());
      await flush();
      if (began) startedAfterAbort.push(depth);
    }
    expect(startedAfterAbort).toStrictEqual([]);
  });
});

describe('sharedAttempt — a hostile signal', () => {
  it('a signal whose aborted getter throws refuses only its own waiter', async () => {
    const slot = sharedAttempt<string>('token-request');
    const held = heldStart<string>();
    const good = track(slot.join(held.start));
    const hostile = Object.defineProperty({}, 'aborted', {
      get() {
        throw new Error('secret');
      },
    }) as AbortSignal;
    const bad = track(slot.join(held.start, hostile));
    await flush();
    expectAborted(bad.reason());
    expect(held.context().signal.aborted).toBe(false);
    held.result.resolve('token');
    await flush();
    expect(good.value()).toBe('token');
  });

  it('a signal whose addEventListener throws refuses only its own waiter and starts nothing alone', async () => {
    const slot = sharedAttempt<string>('token-request');
    const held = heldStart<string>();
    const hostile = {
      aborted: false,
      addEventListener() {
        throw new Error('secret');
      },
      removeEventListener() {
        throw new Error('secret');
      },
    } as unknown as AbortSignal;
    const alone = track(slot.join(held.start, hostile));
    await flush();
    expectAborted(alone.reason());
    expect(held.start).not.toHaveBeenCalled();

    const good = track(slot.join(held.start));
    const bad = track(slot.join(held.start, hostile));
    await flush();
    expectAborted(bad.reason());
    held.result.resolve('token');
    await flush();
    expect(good.value()).toBe('token');
  });

  it('a signal that is not an object, or whose aborted is not a boolean, refuses its waiter', async () => {
    const slot = sharedAttempt<string>('token-request');
    const start = jest.fn(() => Promise.resolve('token'));
    for (const signal of [
      'abort',
      { aborted: 'no', addEventListener() {}, removeEventListener() {} },
    ]) {
      const reason = await slot
        .join(start, signal as unknown as AbortSignal)
        .then(
          () => undefined,
          (r: unknown) => r,
        );
      expectAborted(reason);
    }
    expect(start).not.toHaveBeenCalled();
  });

  it('a signal that fires its listener again and again, or whose removeEventListener throws, harms no other waiter', async () => {
    const slot = sharedAttempt<string>('token-request');
    const held = heldStart<string>();
    let fire: (() => void) | undefined;
    const twice = {
      aborted: false,
      addEventListener(_: string, listener: () => void) {
        fire = listener;
      },
      removeEventListener() {
        throw new Error('secret');
      },
    } as unknown as AbortSignal;
    const kept = track(slot.join(held.start));
    const kept2 = new AbortController();
    const keptSignalled = track(slot.join(held.start, kept2.signal));
    const bad = track(slot.join(held.start, twice));
    fire?.();
    fire?.();
    fire?.();
    await flush();
    expectAborted(bad.reason());
    expect(held.context().signal.aborted).toBe(false);
    held.result.resolve('token');
    await flush();
    expect(kept.value()).toBe('token');
    expect(keptSignalled.value()).toBe('token');
  });

  it('a signal that fires its listener during addEventListener ends the attempt before it starts', async () => {
    const slot = sharedAttempt<string>('token-request');
    const start = jest.fn(() => Promise.resolve('token'));
    const eager = {
      aborted: false,
      addEventListener(_: string, listener: () => void) {
        listener();
      },
      removeEventListener() {},
    } as unknown as AbortSignal;
    const reason = await slot.join(start, eager).then(
      () => undefined,
      (r: unknown) => r,
    );
    expectAborted(reason);
    expect(start).not.toHaveBeenCalled();
    await expect(slot.join(start)).resolves.toBe('token');
  });
});

describe('sharedAttempt — the module', () => {
  it('exports no Set or Map, nor one nested a level down', () => {
    const module = loadBuiltModule('sharedAttempt');
    for (const value of Object.values(module)) {
      expect(value instanceof Set || value instanceof Map).toBe(false);
      if (typeof value === 'object' && value !== null) {
        for (const nested of Object.values(value)) {
          expect(nested instanceof Set || nested instanceof Map).toBe(false);
        }
      }
    }
    const slot = sharedAttempt<string>('token-request');
    expect(Object.isFrozen(slot)).toBe(true);
    for (const value of Object.values(slot)) {
      expect(value instanceof Set || value instanceof Map).toBe(false);
    }
  });
});

interface MomentWaiter {
  readonly signal: AbortSignal;
  release(): void;
}
interface Parties {
  attach(signal: AbortSignal): () => void;
  waiterSignal(): MomentWaiter | undefined;
}
const createParties = built.createParties as () => Parties;

/** The moment's waiter signal, which must exist. */
function momentOf(parties: Parties): MomentWaiter {
  const moment = parties.waiterSignal();
  if (moment === undefined) throw new Error('expected a waiter signal');
  return moment;
}

describe('createParties — attached parties', () => {
  it('no party attached: a moment has no waiter signal, so its login never aborts', async () => {
    const parties = createParties();
    expect(parties.waiterSignal()).toBeUndefined();
    const slot = sharedAttempt<string>('token-request');
    const held = heldStart<string>();
    const waiter = track(slot.join(held.start, parties.waiterSignal()?.signal));
    held.result.resolve('token');
    await flush();
    expect(waiter.value()).toBe('token');
  });

  it('two parties, one aborts: the moment continues; both abort: it is aborted', () => {
    const parties = createParties();
    const a = new AbortController();
    const b = new AbortController();
    parties.attach(a.signal);
    parties.attach(b.signal);
    const moment = momentOf(parties);
    a.abort();
    expect(moment.signal.aborted).toBe(false);
    b.abort();
    expect(moment.signal.aborted).toBe(true);
  });

  it('a login a moment starts is released as aborted when every party aborts', async () => {
    const parties = createParties();
    const a = new AbortController();
    parties.attach(a.signal);
    const moment = momentOf(parties);
    const slot = sharedAttempt<string>('token-request');
    const held = heldStart<string>();
    const waiter = track(slot.join(held.start, moment.signal));
    a.abort();
    await flush();
    expectAborted(waiter.reason());
    expect(held.context().signal.aborted).toBe(true);
  });

  it('a party attached while a moment runs joins it', () => {
    const parties = createParties();
    const a = new AbortController();
    const late = new AbortController();
    parties.attach(a.signal);
    const moment = momentOf(parties);
    parties.attach(late.signal);
    a.abort();
    expect(moment.signal.aborted).toBe(false);
    late.abort();
    expect(moment.signal.aborted).toBe(true);
  });

  it('a released moment is reached by no later abort or attachment', () => {
    const parties = createParties();
    const a = new AbortController();
    parties.attach(a.signal);
    const moment = momentOf(parties);
    moment.release();
    moment.release();
    a.abort();
    expect(moment.signal.aborted).toBe(false);
  });

  it('after every party is released, a later moment has no waiter signal', () => {
    const parties = createParties();
    const a = new AbortController();
    const b = new AbortController();
    const detachA = parties.attach(a.signal);
    parties.attach(b.signal);
    detachA();
    b.abort();
    expect(parties.waiterSignal()).toBeUndefined();
  });

  it('the same signal attached twice is one party', () => {
    const parties = createParties();
    const a = new AbortController();
    const b = new AbortController();
    const first = parties.attach(a.signal);
    parties.attach(a.signal);
    expect(getEventListeners(a.signal, 'abort')).toHaveLength(1);
    parties.attach(b.signal);
    const moment = momentOf(parties);
    b.abort();
    // `a` counted once: it still holds the moment.
    expect(moment.signal.aborted).toBe(false);
    a.abort();
    expect(moment.signal.aborted).toBe(true);
    first();
    expect(parties.waiterSignal()).toBeUndefined();
  });

  it('detach removes the party and its listener; a later moment no longer waits on it', () => {
    const parties = createParties();
    const a = new AbortController();
    const b = new AbortController();
    const detachA = parties.attach(a.signal);
    parties.attach(b.signal);
    detachA();
    detachA();
    expect(getEventListeners(a.signal, 'abort')).toHaveLength(0);
    const moment = momentOf(parties);
    b.abort();
    expect(moment.signal.aborted).toBe(true);
  });

  it('a party detached during a moment leaves it without aborting it', () => {
    const parties = createParties();
    const a = new AbortController();
    const b = new AbortController();
    const detachA = parties.attach(a.signal);
    parties.attach(b.signal);
    const moment = momentOf(parties);
    detachA();
    expect(moment.signal.aborted).toBe(false);
    b.abort();
    expect(moment.signal.aborted).toBe(true);
  });

  it('the only party detached during a moment leaves it unaborted; a party attached later bounds it', () => {
    const parties = createParties();
    const a = new AbortController();
    const detachA = parties.attach(a.signal);
    const moment = momentOf(parties);
    detachA();
    expect(moment.signal.aborted).toBe(false);
    const late = new AbortController();
    parties.attach(late.signal);
    expect(moment.signal.aborted).toBe(false);
    late.abort();
    expect(moment.signal.aborted).toBe(true);
  });

  it('an aborted party is released: its listener removed, a later moment does not wait on it', () => {
    const parties = createParties();
    const a = new AbortController();
    const b = new AbortController();
    parties.attach(a.signal);
    parties.attach(b.signal);
    a.abort();
    expect(getEventListeners(a.signal, 'abort')).toHaveLength(0);
    const moment = momentOf(parties);
    b.abort();
    expect(moment.signal.aborted).toBe(true);
  });

  it('an already-aborted signal is not added', () => {
    const parties = createParties();
    const detach = parties.attach(AbortSignal.abort());
    expect(parties.waiterSignal()).toBeUndefined();
    detach();
  });

  it('a hostile signal is refused like a waiter’s, and harms no other party', () => {
    const parties = createParties();
    const throwingGetter = Object.defineProperty({}, 'aborted', {
      get() {
        throw new Error('secret');
      },
    }) as AbortSignal;
    const throwingAdd = {
      aborted: false,
      addEventListener() {
        throw new Error('secret');
      },
      removeEventListener() {
        throw new Error('secret');
      },
    } as unknown as AbortSignal;
    for (const signal of [
      throwingGetter,
      throwingAdd,
      'abort' as unknown as AbortSignal,
      { aborted: 1 } as unknown as AbortSignal,
    ]) {
      expect(() => parties.attach(signal)).not.toThrow();
    }
    expect(parties.waiterSignal()).toBeUndefined();

    let fire: (() => void) | undefined;
    const repeating = {
      aborted: false,
      addEventListener(_: string, listener: () => void) {
        fire = listener;
      },
      removeEventListener() {
        throw new Error('secret');
      },
    } as unknown as AbortSignal;
    const good = new AbortController();
    parties.attach(good.signal);
    parties.attach(repeating);
    const moment = momentOf(parties);
    fire?.();
    fire?.();
    expect(moment.signal.aborted).toBe(false);
    good.abort();
    expect(moment.signal.aborted).toBe(true);
  });

  it('listener counts return to zero', () => {
    const parties = createParties();
    const signals = [1, 2, 3].map(() => new AbortController());
    const detaches = signals.map((c) => parties.attach(c.signal));
    for (let i = 0; i < 5; i += 1) momentOf(parties).release();
    const [first, second] = signals as [AbortController, AbortController];
    first.abort();
    second.abort();
    detaches[2]?.();
    for (const c of signals) {
      expect(getEventListeners(c.signal, 'abort')).toHaveLength(0);
    }
    expect(parties.waiterSignal()).toBeUndefined();
  });

  it('the parties object is frozen and holds no Set or Map', () => {
    const parties = createParties();
    expect(Object.isFrozen(parties)).toBe(true);
    for (const value of Object.values(parties)) {
      expect(value instanceof Set || value instanceof Map).toBe(false);
    }
    const a = new AbortController();
    parties.attach(a.signal);
    expect(Object.isFrozen(momentOf(parties))).toBe(true);
  });
});

/**
 * A foreign signal over a real one that aborts it inside addEventListener,
 * before forwarding the registration: the forwarded listener never fires.
 */
function abortingAdapter(): {
  readonly signal: AbortSignal;
  readonly inner: AbortSignal;
} {
  const controller = new AbortController();
  const inner = controller.signal;
  const signal = {
    get aborted() {
      return inner.aborted;
    },
    addEventListener(
      type: string,
      listener: () => void,
      options?: AddEventListenerOptions,
    ) {
      controller.abort();
      inner.addEventListener(type, listener, options);
    },
    removeEventListener(type: string, listener: () => void) {
      inner.removeEventListener(type, listener);
    },
  } as unknown as AbortSignal;
  return { signal, inner };
}

describe('a signal that aborts while its listener is registered', () => {
  it('join: the waiter is refused aborted, the attempt leaves the slot, no listener stays', async () => {
    const slot = sharedAttempt<string>('token-request');
    const held = heldStart<string>();
    const { signal, inner } = abortingAdapter();
    const waiter = track(slot.join(held.start, signal));
    await flush();
    expectAborted(waiter.reason());
    expect(getEventListeners(inner, 'abort')).toHaveLength(0);
    const fresh = heldStart<string>();
    void slot.join(fresh.start);
    expect(fresh.start).toHaveBeenCalledTimes(1);
  });

  it('join beside a live waiter: only it is refused', async () => {
    const slot = sharedAttempt<string>('token-request');
    const held = heldStart<string>();
    const kept = track(slot.join(held.start));
    const { signal, inner } = abortingAdapter();
    const refused = track(slot.join(held.start, signal));
    await flush();
    expectAborted(refused.reason());
    expect(getEventListeners(inner, 'abort')).toHaveLength(0);
    held.result.resolve('token');
    await flush();
    expect(kept.value()).toBe('token');
  });

  it('attach: the party is not added, no listener stays', () => {
    const parties = createParties();
    const { signal, inner } = abortingAdapter();
    const detach = parties.attach(signal);
    expect(parties.waiterSignal()).toBeUndefined();
    expect(getEventListeners(inner, 'abort')).toHaveLength(0);
    detach();
  });

  it('attach during a moment: it does not join it', () => {
    const parties = createParties();
    const a = new AbortController();
    parties.attach(a.signal);
    const moment = momentOf(parties);
    parties.attach(abortingAdapter().signal);
    a.abort();
    expect(moment.signal.aborted).toBe(true);
  });
});
