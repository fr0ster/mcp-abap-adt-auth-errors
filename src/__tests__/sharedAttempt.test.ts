import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { describe, it, type Mock, mock } from 'node:test';
import type { IAuthProviderError } from '@mcp-abap-adt/interfaces-auth';
import { loadBuilt, loadBuiltModule } from './builtPackage';

/**
 * `sharedAttempt`, run against the built package: the waiter
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
  readonly start: Mock<(attempt: AttemptContext) => Promise<T>>;
  readonly result: Deferred<T>;
  context(): AttemptContext;
} {
  const result = deferred<T>();
  const start = mock.fn((_: AttemptContext) => result.promise);
  return {
    start,
    result,
    context(): AttemptContext {
      const call = start.mock.calls[0];
      if (call === undefined) throw new Error('start was not called');
      return call.arguments[0];
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
  assert.equal(isAuthProviderFailure(reason), true);
  const error = (reason as Failure).error;
  assert.equal(isMinted(error), true);
  assert.equal(error.kind, 'interactive-login');
  assert.deepEqual(error.facts, { outcome: 'aborted' });
  assert.equal(error.reason, 'the authorization was aborted');
  assert.equal((reason as Failure).message, 'the authorization was aborted');
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
    assert.equal(a.state(), 'rejected');
    expectAborted(a.reason());
    assert.equal(b.state(), 'pending');
    assert.equal(held.context().signal.aborted, false);

    held.result.resolve('token');
    await flush();
    assert.equal(b.state(), 'resolved');
    assert.equal(b.value(), 'token');
    assert.equal(held.start.mock.callCount(), 1);
    assert.equal(held.context().signal.aborted, false);
  });

  it('a later join while the attempt runs shares it: start is called once', async () => {
    const slot = sharedAttempt<string>('token-request');
    const held = heldStart<string>();
    const other = mock.fn(() => Promise.resolve('other'));
    const a = slot.join(held.start);
    const b = slot.join(other);
    held.result.resolve('token');
    assert.deepEqual(await Promise.all([a, b]), ['token', 'token']);
    assert.equal(held.start.mock.callCount(), 1);
    assert.equal(other.mock.callCount(), 0);
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
    assert.equal(signal.aborted, false);
    second.abort();
    assert.equal(signal.aborted, true);
    assert.equal(fresh.start.mock.callCount(), 1);

    await flush();
    expectAborted(a.reason());
    expectAborted(b.reason());
    fresh.result.resolve('fresh');
    await flush();
    assert.equal(joinedFromAbort?.value(), 'fresh');
  });

  it('the slot is empty when the last waiter’s rejection is observed', async () => {
    const slot = sharedAttempt<string>('token-request');
    const held = heldStart<string>();
    const controller = new AbortController();
    const fresh = heldStart<string>();
    const observed = slot.join(held.start, controller.signal).catch(() => {
      void slot.join(fresh.start);
      return fresh.start.mock.callCount();
    });
    controller.abort();
    assert.equal(await observed, 1);
    assert.equal(held.start.mock.callCount(), 1);
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
    assert.equal(held.context().signal.aborted, false);
    held.result.resolve('token');
    await flush();
    assert.equal(unsignalled.value(), 'token');
  });

  it('doomed join: after every waiter aborted, a join while the old start is pending starts afresh; the late result changes nothing', async () => {
    const slot = sharedAttempt<string>('token-request');
    const old = heldStart<string>();
    const controller = new AbortController();
    const doomed = track(slot.join(old.start, controller.signal));
    controller.abort();

    const fresh = heldStart<string>();
    const next = track(slot.join(fresh.start));
    assert.equal(fresh.start.mock.callCount(), 1);

    old.result.resolve('late');
    await flush();
    expectAborted(doomed.reason());
    assert.equal(next.state(), 'pending');

    fresh.result.resolve('fresh');
    await flush();
    assert.equal(next.value(), 'fresh');
  });

  it('a waiter whose signal is already aborted is refused aborted and starts nothing', async () => {
    const slot = sharedAttempt<string>('token-request');
    const held = heldStart<string>();
    const a = track(slot.join(held.start, AbortSignal.abort()));
    await flush();
    expectAborted(a.reason());
    assert.equal(held.start.mock.callCount(), 0);

    // Joining a running attempt with an aborted signal neither counts nor ends it.
    const b = track(slot.join(held.start));
    const c = track(slot.join(held.start, AbortSignal.abort()));
    await flush();
    expectAborted(c.reason());
    assert.equal(held.context().signal.aborted, false);
    held.result.resolve('token');
    await flush();
    assert.equal(b.value(), 'token');
  });

  it('a settled waiter leaves no listener on its signal', async () => {
    const slot = sharedAttempt<string>('token-request');
    const held = heldStart<string>();
    const kept = new AbortController();
    const aborting = new AbortController();
    const a = slot.join(held.start, kept.signal);
    void slot.join(held.start, aborting.signal).catch(() => undefined);
    assert.equal(getEventListeners(kept.signal, 'abort').length, 1);
    aborting.abort();
    assert.equal(getEventListeners(aborting.signal, 'abort').length, 0);
    held.result.resolve('token');
    assert.equal(await a, 'token');
    assert.equal(getEventListeners(kept.signal, 'abort').length, 0);
    // An abort after the result changes nothing.
    kept.abort();
    assert.equal(await a, 'token');
  });
});

describe('sharedAttempt — settling', () => {
  it('a resolved attempt leaves the slot: the next join starts afresh', async () => {
    const slot = sharedAttempt<string>('token-request');
    assert.equal(await slot.join(() => Promise.resolve('one')), 'one');
    assert.equal(await slot.join(() => Promise.resolve('two')), 'two');
  });

  it('a rejected attempt leaves the slot: the next join starts afresh', async () => {
    const slot = sharedAttempt<string>('token-request');
    await assert.rejects(
      slot.join(() => Promise.reject(new Error('down'))),
      (thrown: unknown) => thrown !== undefined,
    );
    assert.equal(await slot.join(() => Promise.resolve('two')), 'two');
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
      assert.notEqual(reason, thrown);
      assert.equal(isAuthProviderFailure(reason), true);
      const error = (reason as Failure).error;
      assert.equal(error.kind, 'unknown');
      assert.deepEqual(error.facts, {
        operation: 'device-authorization',
        status: 500,
      });
      assert.ok(!JSON.stringify(reason).includes('secret'));
      assert.ok(!String(reason).includes('secret'));
      assert.equal((reason as { cause?: unknown }).cause, undefined);
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
    assert.deepEqual((primitive as Failure).error.facts, {
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
    assert.equal(isAuthProviderFailure(reason), true);
    assert.equal((reason as Failure).error, minted);
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
    assert.equal(isAuthProviderFailure(reason), true);
    assert.ok(!String(reason).includes('secret'));
  });

  it('an attempt that ends after every waiter left raises no unhandled rejection', async () => {
    const slot = sharedAttempt<string>('token-request');
    const held = heldStart<string>();
    const controller = new AbortController();
    const waiter = slot.join(held.start, controller.signal);
    controller.abort();
    await assert.rejects(waiter, (thrown: unknown) => thrown !== undefined);
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

    const newWork = mock.fn(() => Promise.resolve('fresh'));
    const next = track(slot.join((attempt) => attempt.exclusive(newWork)));
    await flush();
    assert.equal(newWork.mock.callCount(), 0);

    oldWork.resolve('late');
    await flush();
    assert.equal(newWork.mock.callCount(), 1);
    assert.equal(next.value(), 'fresh');
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
    assert.equal(
      await slot.join(() => Promise.resolve('refreshed')),
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

    const newWork = mock.fn(() => Promise.resolve('fresh'));
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
    assert.equal(waited?.state(), 'rejected');
    expectAborted(waited?.reason());

    oldWork.resolve('late');
    await flush();
    assert.equal(newWork.mock.callCount(), 0);
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
    ): Promise<Mock<() => Promise<string>>> => {
      const controller = new AbortController();
      const counted = mock.fn(work);
      void slot
        .join(exclusiveStart(counted), controller.signal)
        .catch(() => undefined);
      await flush();
      controller.abort();
      return counted;
    };
    const first = await abortedJoin(() => firstWork.promise);
    const second = await abortedJoin(() => Promise.resolve('second'));
    const third = await abortedJoin(() => Promise.resolve('third'));
    assert.equal(first.mock.callCount(), 1);
    assert.equal(second.mock.callCount(), 0);
    assert.equal(third.mock.callCount(), 0);

    const fourthWork = mock.fn(() => Promise.resolve('fourth'));
    const fourth = track(slot.join(exclusiveStart(fourthWork)));
    await flush();
    assert.equal(fourthWork.mock.callCount(), 0);

    firstWork.resolve('late');
    await flush();
    assert.equal(fourthWork.mock.callCount(), 1);
    assert.equal(fourth.value(), 'fourth');
    assert.equal(second.mock.callCount(), 0);
    assert.equal(third.mock.callCount(), 0);
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
    const newWork = mock.fn(() => Promise.resolve('fresh'));
    const next = slot.join((attempt) => attempt.exclusive(newWork));
    oldWork.reject(new Error('socket closed badly'));
    assert.equal(await next, 'fresh');
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
    assert.equal(
      await slot.join(() => Promise.resolve('refreshed')),
      'refreshed',
    );
    // … and the next exclusive work still waits for the aborted one's.
    const newWork = mock.fn(() => Promise.resolve('fresh'));
    const next = track(slot.join((attempt) => attempt.exclusive(newWork)));
    await flush();
    assert.equal(newWork.mock.callCount(), 0);
    oldWork.resolve('late');
    await flush();
    assert.equal(next.value(), 'fresh');
  });

  it('exclusive called after the attempt was aborted starts nothing', async () => {
    const slot = sharedAttempt<string>('browser-login');
    const held = heldStart<string>();
    const controller = new AbortController();
    void slot.join(held.start, controller.signal).catch(() => undefined);
    controller.abort();
    const work = mock.fn(() => Promise.resolve('never'));
    const late = held.context().exclusive(work);
    await assert.rejects(late, (thrown: unknown) => thrown !== undefined);
    expectAborted(await late.catch((r: unknown) => r));
    assert.equal(work.mock.callCount(), 0);
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
    const work = mock.fn(() => Promise.resolve('never'));
    const late = track(held.context().exclusive(work));
    await flush();
    assert.equal(late.state(), 'rejected');
    expectAborted(late.reason());
    oldWork.resolve('late');
    await flush();
    assert.equal(work.mock.callCount(), 0);
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
    assert.deepEqual(order, ['start first']);
    secondGate.resolve();
    await flush();
    assert.deepEqual(order, ['start first']);
    firstGate.resolve();
    assert.equal(await result, 'first+second');
    assert.deepEqual(order, [
      'start first',
      'end first',
      'start second',
      'end second',
    ]);
    assert.equal(most, 1);
  });

  it('a second exclusive call waits for the first even when the first work rejects', async () => {
    const slot = sharedAttempt<string>('browser-login');
    const firstGate = deferred<string>();
    const second = mock.fn(() => Promise.resolve('second'));
    const result = slot.join(async (attempt) => {
      const first = attempt.exclusive(() => firstGate.promise);
      const next = attempt.exclusive(second);
      await first.catch(() => undefined);
      return next;
    });
    await flush();
    assert.equal(second.mock.callCount(), 0);
    firstGate.reject(new Error('closed badly'));
    assert.equal(await result, 'second');
  });

  it('work that synchronously aborts its last waiter and re-joins is already in the drain', async () => {
    const slot = sharedAttempt<string>('browser-login');
    let running = 0;
    let most = 0;
    const firstGate = deferred<string>();
    const controller = new AbortController();
    let replacement: Promise<string> | undefined;
    const secondWork = mock.fn(async () => {
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
    assert.notEqual(replacement, undefined);
    assert.equal(secondWork.mock.callCount(), 0);
    firstGate.resolve('first');
    assert.equal(await replacement, 'second');
    assert.equal(most, 1);
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
    assert.deepEqual(startedAfterAbort, []);
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
    assert.equal(held.context().signal.aborted, false);
    held.result.resolve('token');
    await flush();
    assert.equal(good.value(), 'token');
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
    assert.equal(held.start.mock.callCount(), 0);

    const good = track(slot.join(held.start));
    const bad = track(slot.join(held.start, hostile));
    await flush();
    expectAborted(bad.reason());
    held.result.resolve('token');
    await flush();
    assert.equal(good.value(), 'token');
  });

  it('a signal that is not an object, or whose aborted is not a boolean, refuses its waiter', async () => {
    const slot = sharedAttempt<string>('token-request');
    const start = mock.fn(() => Promise.resolve('token'));
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
    assert.equal(start.mock.callCount(), 0);
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
    assert.equal(held.context().signal.aborted, false);
    held.result.resolve('token');
    await flush();
    assert.equal(kept.value(), 'token');
    assert.equal(keptSignalled.value(), 'token');
  });

  it('a signal that fires its listener during addEventListener ends the attempt before it starts', async () => {
    const slot = sharedAttempt<string>('token-request');
    const start = mock.fn(() => Promise.resolve('token'));
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
    assert.equal(start.mock.callCount(), 0);
    assert.equal(await slot.join(start), 'token');
  });
});

describe('sharedAttempt — the module', () => {
  it('exports no Set or Map, nor one nested a level down', () => {
    const module = loadBuiltModule('sharedAttempt');
    for (const value of Object.values(module)) {
      assert.equal(value instanceof Set || value instanceof Map, false);
      if (typeof value === 'object' && value !== null) {
        for (const nested of Object.values(value)) {
          assert.equal(nested instanceof Set || nested instanceof Map, false);
        }
      }
    }
    const slot = sharedAttempt<string>('token-request');
    assert.equal(Object.isFrozen(slot), true);
    for (const value of Object.values(slot)) {
      assert.equal(value instanceof Set || value instanceof Map, false);
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
    assert.equal(parties.waiterSignal(), undefined);
    const slot = sharedAttempt<string>('token-request');
    const held = heldStart<string>();
    const waiter = track(slot.join(held.start, parties.waiterSignal()?.signal));
    held.result.resolve('token');
    await flush();
    assert.equal(waiter.value(), 'token');
  });

  it('two parties, one aborts: the moment continues; both abort: it is aborted', () => {
    const parties = createParties();
    const a = new AbortController();
    const b = new AbortController();
    parties.attach(a.signal);
    parties.attach(b.signal);
    const moment = momentOf(parties);
    a.abort();
    assert.equal(moment.signal.aborted, false);
    b.abort();
    assert.equal(moment.signal.aborted, true);
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
    assert.equal(held.context().signal.aborted, true);
  });

  it('a party attached while a moment runs joins it', () => {
    const parties = createParties();
    const a = new AbortController();
    const late = new AbortController();
    parties.attach(a.signal);
    const moment = momentOf(parties);
    parties.attach(late.signal);
    a.abort();
    assert.equal(moment.signal.aborted, false);
    late.abort();
    assert.equal(moment.signal.aborted, true);
  });

  it('a released moment is reached by no later abort or attachment', () => {
    const parties = createParties();
    const a = new AbortController();
    parties.attach(a.signal);
    const moment = momentOf(parties);
    moment.release();
    moment.release();
    a.abort();
    assert.equal(moment.signal.aborted, false);
  });

  it('after every party is released, a later moment has no waiter signal', () => {
    const parties = createParties();
    const a = new AbortController();
    const b = new AbortController();
    const detachA = parties.attach(a.signal);
    parties.attach(b.signal);
    detachA();
    b.abort();
    assert.equal(parties.waiterSignal(), undefined);
  });

  it('the same signal attached twice is one party', () => {
    const parties = createParties();
    const a = new AbortController();
    const b = new AbortController();
    const first = parties.attach(a.signal);
    parties.attach(a.signal);
    assert.equal(getEventListeners(a.signal, 'abort').length, 1);
    parties.attach(b.signal);
    const moment = momentOf(parties);
    b.abort();
    // `a` counted once: it still holds the moment.
    assert.equal(moment.signal.aborted, false);
    a.abort();
    assert.equal(moment.signal.aborted, true);
    first();
    assert.equal(parties.waiterSignal(), undefined);
  });

  it('detach removes the party and its listener; a later moment no longer waits on it', () => {
    const parties = createParties();
    const a = new AbortController();
    const b = new AbortController();
    const detachA = parties.attach(a.signal);
    parties.attach(b.signal);
    detachA();
    detachA();
    assert.equal(getEventListeners(a.signal, 'abort').length, 0);
    const moment = momentOf(parties);
    b.abort();
    assert.equal(moment.signal.aborted, true);
  });

  it('a party detached during a moment leaves it without aborting it', () => {
    const parties = createParties();
    const a = new AbortController();
    const b = new AbortController();
    const detachA = parties.attach(a.signal);
    parties.attach(b.signal);
    const moment = momentOf(parties);
    detachA();
    assert.equal(moment.signal.aborted, false);
    b.abort();
    assert.equal(moment.signal.aborted, true);
  });

  it('the only party detached during a moment leaves it unaborted; a party attached later bounds it', () => {
    const parties = createParties();
    const a = new AbortController();
    const detachA = parties.attach(a.signal);
    const moment = momentOf(parties);
    detachA();
    assert.equal(moment.signal.aborted, false);
    const late = new AbortController();
    parties.attach(late.signal);
    assert.equal(moment.signal.aborted, false);
    late.abort();
    assert.equal(moment.signal.aborted, true);
  });

  it('an aborted party is released: its listener removed, a later moment does not wait on it', () => {
    const parties = createParties();
    const a = new AbortController();
    const b = new AbortController();
    parties.attach(a.signal);
    parties.attach(b.signal);
    a.abort();
    assert.equal(getEventListeners(a.signal, 'abort').length, 0);
    const moment = momentOf(parties);
    b.abort();
    assert.equal(moment.signal.aborted, true);
  });

  it('an already-aborted signal is not added', () => {
    const parties = createParties();
    const detach = parties.attach(AbortSignal.abort());
    assert.equal(parties.waiterSignal(), undefined);
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
      assert.doesNotThrow(() => parties.attach(signal));
    }
    assert.equal(parties.waiterSignal(), undefined);

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
    assert.equal(moment.signal.aborted, false);
    good.abort();
    assert.equal(moment.signal.aborted, true);
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
      assert.equal(getEventListeners(c.signal, 'abort').length, 0);
    }
    assert.equal(parties.waiterSignal(), undefined);
  });

  it('the parties object is frozen and holds no Set or Map', () => {
    const parties = createParties();
    assert.equal(Object.isFrozen(parties), true);
    for (const value of Object.values(parties)) {
      assert.equal(value instanceof Set || value instanceof Map, false);
    }
    const a = new AbortController();
    parties.attach(a.signal);
    assert.equal(Object.isFrozen(momentOf(parties)), true);
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
    assert.equal(getEventListeners(inner, 'abort').length, 0);
    const fresh = heldStart<string>();
    void slot.join(fresh.start);
    assert.equal(fresh.start.mock.callCount(), 1);
  });

  it('join beside a live waiter: only it is refused', async () => {
    const slot = sharedAttempt<string>('token-request');
    const held = heldStart<string>();
    const kept = track(slot.join(held.start));
    const { signal, inner } = abortingAdapter();
    const refused = track(slot.join(held.start, signal));
    await flush();
    expectAborted(refused.reason());
    assert.equal(getEventListeners(inner, 'abort').length, 0);
    held.result.resolve('token');
    await flush();
    assert.equal(kept.value(), 'token');
  });

  it('attach: the party is not added, no listener stays', () => {
    const parties = createParties();
    const { signal, inner } = abortingAdapter();
    const detach = parties.attach(signal);
    assert.equal(parties.waiterSignal(), undefined);
    assert.equal(getEventListeners(inner, 'abort').length, 0);
    detach();
  });

  it('attach during a moment: it does not join it', () => {
    const parties = createParties();
    const a = new AbortController();
    parties.attach(a.signal);
    const moment = momentOf(parties);
    parties.attach(abortingAdapter().signal);
    a.abort();
    assert.equal(moment.signal.aborted, true);
  });
});

/**
 * A foreign signal whose registration first aborts another party's (or
 * waiter's) controller, then its own, before forwarding the registration.
 */
function reentrantAdapter(other: AbortController): {
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
      other.abort();
      controller.abort();
      inner.addEventListener(type, listener, options);
    },
    removeEventListener(type: string, listener: () => void) {
      inner.removeEventListener(type, listener);
    },
  } as unknown as AbortSignal;
  return { signal, inner };
}

describe('a registration that aborts another party, then itself', () => {
  it('attach: the moment left with no live party is aborted; listeners at baseline', () => {
    const parties = createParties();
    const existing = new AbortController();
    parties.attach(existing.signal);
    const moment = momentOf(parties);
    const { signal, inner } = reentrantAdapter(existing);
    parties.attach(signal);
    assert.equal(moment.signal.aborted, true);
    assert.equal(getEventListeners(existing.signal, 'abort').length, 0);
    assert.equal(getEventListeners(inner, 'abort').length, 0);
    assert.equal(parties.waiterSignal(), undefined);
  });

  it('join: the attempt whose waiters all aborted is aborted and leaves the slot', async () => {
    const slot = sharedAttempt<string>('token-request');
    const held = heldStart<string>();
    const existing = new AbortController();
    const first = track(slot.join(held.start, existing.signal));
    const { signal, inner } = reentrantAdapter(existing);
    const second = track(slot.join(held.start, signal));
    await flush();
    expectAborted(first.reason());
    expectAborted(second.reason());
    assert.equal(held.context().signal.aborted, true);
    assert.equal(getEventListeners(existing.signal, 'abort').length, 0);
    assert.equal(getEventListeners(inner, 'abort').length, 0);
    const fresh = heldStart<string>();
    void slot.join(fresh.start);
    assert.equal(fresh.start.mock.callCount(), 1);
  });
});

describe('a registration that aborts another party, then turns unreadable', () => {
  it('attach: removed as an abort — the moment left with no live party is aborted', () => {
    const parties = createParties();
    const existing = new AbortController();
    parties.attach(existing.signal);
    const moment = momentOf(parties);
    let unreadable = false;
    const listeners: (() => void)[] = [];
    const signal = {
      get aborted(): boolean {
        if (unreadable) throw new Error('secret');
        return false;
      },
      addEventListener(_: string, listener: () => void) {
        existing.abort();
        unreadable = true;
        listeners.push(listener);
      },
      removeEventListener(_: string, listener: () => void) {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
    } as unknown as AbortSignal;
    parties.attach(signal);
    assert.equal(moment.signal.aborted, true);
    assert.equal(listeners.length, 0);
    assert.equal(getEventListeners(existing.signal, 'abort').length, 0);
    assert.equal(parties.waiterSignal(), undefined);
  });
});

/** An adapter whose registration aborts `other`, then throws. */
function throwingAdapter(other: AbortController): AbortSignal {
  return {
    aborted: false,
    addEventListener() {
      other.abort();
      throw new Error('secret');
    },
    removeEventListener() {},
  } as unknown as AbortSignal;
}

describe('a registration that aborts another party, then throws', () => {
  it('attach: removed as an abort — the moment aborts, its login’s slot is released', async () => {
    const parties = createParties();
    const existing = new AbortController();
    parties.attach(existing.signal);
    const moment = momentOf(parties);
    const slot = sharedAttempt<string>('token-request');
    const held = heldStart<string>();
    const waiter = track(slot.join(held.start, moment.signal));
    parties.attach(throwingAdapter(existing));
    assert.equal(moment.signal.aborted, true);
    assert.equal(getEventListeners(existing.signal, 'abort').length, 0);
    assert.equal(getEventListeners(moment.signal, 'abort').length, 0);
    assert.equal(parties.waiterSignal(), undefined);
    await flush();
    expectAborted(waiter.reason());
    assert.equal(held.context().signal.aborted, true);
    const fresh = heldStart<string>();
    void slot.join(fresh.start);
    assert.equal(fresh.start.mock.callCount(), 1);
  });

  it('join: both waiters refused, the attempt aborted and the slot released', async () => {
    const slot = sharedAttempt<string>('token-request');
    const held = heldStart<string>();
    const existing = new AbortController();
    const first = track(slot.join(held.start, existing.signal));
    const second = track(slot.join(held.start, throwingAdapter(existing)));
    await flush();
    expectAborted(first.reason());
    expectAborted(second.reason());
    assert.equal(held.context().signal.aborted, true);
    assert.equal(getEventListeners(existing.signal, 'abort').length, 0);
    const fresh = heldStart<string>();
    void slot.join(fresh.start);
    assert.equal(fresh.start.mock.callCount(), 1);
  });
});
