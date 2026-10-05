/**
 * The waiter rules for a shared attempt (spec §6b), implemented once for the
 * token providers (renewal, pin) and the broker (its build cache).
 *
 * A slot holds at most one active attempt. `join(start, signal?)` starts an
 * attempt when the slot is empty, or joins the active one, and returns that
 * waiter's promise:
 *
 * - one waiter's abort rejects only that waiter, with an
 *   `AuthProviderFailure` of `interactive-login` `aborted`; the attempt runs
 *   on for the others;
 * - a waiter without a signal never aborts;
 * - when the last live waiter aborts, the attempt leaves the slot at once
 *   (identity-checked) — before that waiter is rejected and before the
 *   attempt's `AbortController` aborts — so a join arriving meanwhile starts
 *   a fresh attempt (the doomed-join window);
 * - a settled attempt leaves the slot; its waiters get `start`'s value, or
 *   the failure `classify` makes of what it threw (never the thrown value).
 *
 * **Drain.** Every attempt carries a drain: the exclusive local work it ran
 * through `exclusive(work)` (settled, whichever way), plus the drain it
 * inherited. When an attempt leaves the slot — aborted or settled — the slot
 * keeps that drain as `previousDrain`; the next attempt inherits it, and its
 * `exclusive` awaits it before starting work, raced only against the
 * attempt's own signal: when every waiter of the new attempt aborts, the
 * wait ends `aborted` and the work never starts. Work run outside
 * `exclusive` (a refresh) waits for nothing. A drain never rejects and has
 * no bound: no timer anywhere. Calls of `exclusive` within one attempt run
 * one at a time, in call order: each reserves its place when called. While
 * a drain hangs, an attempt aborted in its `exclusive` wait leaves only an
 * emptied record and the drain's reaction to it behind (a few hundred
 * bytes), released when the drain settles.
 *
 * **Attached parties** (`createParties`): the waiter of a login a moment
 * starts, which has no per-call signal — the provider's attached parties,
 * as one signal per moment.
 *
 * What an attempt commits stays with the caller: `start`'s value is handed
 * to the waiters, never applied here.
 *
 * **A waiter's signal is foreign.** Its `aborted` must be a boolean, read
 * before its listener is added and again after (a signal aborting during its
 * own registration never calls the listener); the listener is added and
 * removed inside a `try`, its removal in place before the registration
 * runs. A signal that is not an object, whose `aborted` throws or is not a
 * boolean, or whose `addEventListener` throws cannot be honoured: its waiter
 * is refused `aborted` at once, so it neither starts nor keeps an attempt.
 * Its listener is idempotent (a second call changes nothing), and a throwing
 * `removeEventListener` is ignored: no signal can harm another waiter.
 *
 * **Foreign code runs on a consistent state.** A signal's getter,
 * `addEventListener` and `removeEventListener` are consumer code that may
 * call back in (join, attach, detach, abort another signal). Each runs only
 * once every membership change is complete — a waiter out of its attempt
 * and the slot left, a party out of the set and its moments, the moments to
 * abort decided — and the rejections and aborts follow it, in spec §6b's
 * order (a waiter's rejection before its attempt's abort).
 */
import type { Operation } from '@mcp-abap-adt/interfaces-auth';
import { authError } from './builders';
import { classify } from './classify';
import { AuthProviderFailure } from './failure';

/** What `start` is given: the attempt's signal, and its exclusive section. */
export interface AttemptContext {
  /** Aborts when every waiter of the attempt has aborted. */
  readonly signal: AbortSignal;
  /**
   * Runs `work` — work holding an exclusive local resource (a callback
   * socket, a stdin reader) — once the drain this attempt inherited, and
   * every earlier exclusive work of this attempt, has settled; its promise,
   * settled either way, joins this attempt's drain. Rejects with the
   * `aborted` failure, starting nothing, when the attempt is aborted (or
   * has ended) before the work starts.
   */
  exclusive<R>(work: () => Promise<R>): Promise<R>;
}

/** What `join` is given to start an attempt. */
export type AttemptStart<T> = (attempt: AttemptContext) => Promise<T>;

/**
 * One slot of shared attempts (spec §6b). `T` must not be thenable: a
 * waiter is resolved with `start`'s value, and resolving re-reads its
 * `then`, which would hand a waiter whatever that `then` passes, outside
 * `classify`. `start` is the caller's own code, which answers plain values.
 */
export interface SharedAttempt<T> {
  /**
   * Joins the active attempt, or starts one with `start` when the slot is
   * empty (`start` is ignored otherwise). Resolves with the attempt's value;
   * rejects with an `AuthProviderFailure` — `aborted` when `signal` aborts
   * first, else the attempt's classified failure.
   */
  join(start: AttemptStart<T>, signal?: AbortSignal): Promise<T>;
}

/** The failure of an aborted waiter: `interactive-login` `aborted`. */
function abortedFailure(): AuthProviderFailure {
  return withoutFrames(
    () =>
      new AuthProviderFailure(
        authError['interactive-login']({ outcome: 'aborted' }),
      ),
  );
}

/**
 * `make()` with no stack frames captured. An error built while a signal
 * dispatches its abort would otherwise hold the dispatch's frames — their
 * functions and receivers, the consumer's signal among them — for as long
 * as the error lives (a waiter's rejection, an attempt's `signal.reason`).
 * When `Error.stackTraceLimit` cannot be set, frames are captured as usual.
 */
function withoutFrames<V>(make: () => V): V {
  let limit: unknown;
  let set = false;
  try {
    limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 0;
    set = true;
  } catch {
    // A frozen Error: build as usual.
  }
  try {
    return make();
  } finally {
    if (set) {
      try {
        Error.stackTraceLimit = limit as number;
      } catch {
        // Nothing to restore.
      }
    }
  }
}

/** The reason an attempt's or a moment's signal aborts with: no frames. */
function abortReason(): DOMException {
  return withoutFrames(
    () => new DOMException('This operation was aborted', 'AbortError'),
  );
}

const ignore = (): void => undefined;

/**
 * `() => fn(a, b)`, built here so that the closure holds `fn`, `a` and `b`
 * only — never a variable of the caller's scope (V8 shares one context
 * among a scope's closures, so a closure built there would keep, say, a
 * consumer's signal alive through a captured stack frame).
 */
function bound<A, B>(fn: (a: A, b: B) => void, a: A, b: B): () => void {
  return () => fn(a, b);
}

/** A signal's listener removal, built apart for the same reason. */
function remover(signal: AbortSignal, listener: () => void): () => void {
  return () => {
    try {
      signal.removeEventListener('abort', listener);
    } catch {
      // Ignored: the member is gone whatever the signal does.
    }
  };
}

/** `promise`, settled either way, as a promise that never rejects. */
function quietly(promise: Promise<unknown>): Promise<void> {
  return promise.then(ignore, ignore);
}

/** `work()` as a promise: a synchronous throw becomes a rejection. */
function run<R>(work: () => Promise<R>): Promise<R> {
  try {
    return Promise.resolve(work());
  } catch (thrown) {
    return Promise.reject(thrown);
  }
}

interface Waiter<T> {
  done: boolean;
  resolve: (value: T) => void;
  reject: (failure: AuthProviderFailure) => void;
  /** Removes the listener from the waiter's signal, if it has one. */
  detach: () => void;
}

interface Attempt<T> {
  readonly controller: AbortController;
  /** The live waiters, in join order; one without a signal never leaves. */
  readonly waiters: Waiter<T>[];
  /** The inherited drain, then each started exclusive work's settling. */
  drain: Promise<void>;
  /** The gate of the latest `exclusive` call: the next one waits for it. */
  tail: Promise<void>;
  /** Left the slot: aborted or settled. */
  ended: boolean;
}

/**
 * One wait of `exclusive` on a drain. The drain's reaction holds only this
 * record, and an abort empties it: an attempt aborted while a drain hangs
 * keeps nothing of itself alive but the emptied record.
 */
interface DrainWait {
  resolve: (() => void) | undefined;
  signal: AbortSignal | undefined;
  onAbort: (() => void) | undefined;
}

/** The drain settled: the wait, if still there, resolves. */
function drained(wait: DrainWait): void {
  const { resolve, signal, onAbort } = wait;
  wait.resolve = wait.signal = wait.onAbort = undefined;
  if (signal !== undefined && onAbort !== undefined) {
    signal.removeEventListener('abort', onAbort);
  }
  resolve?.();
}

/** The drain's reaction for one wait: a closure over the record only. */
function drainedBy(wait: DrainWait): () => void {
  return () => drained(wait);
}

/** `prior` settled, raced only against `signal` (the attempt's own). */
function waitFor(prior: Promise<void>, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortedFailure());
      return;
    }
    const wait: DrainWait = { resolve, signal, onAbort: undefined };
    const onAbort = (): void => {
      wait.resolve = wait.signal = wait.onAbort = undefined;
      reject(abortedFailure());
    };
    wait.onAbort = onAbort;
    signal.addEventListener('abort', onAbort, { once: true });
    // Built outside this scope, so the reaction's closure holds `wait` alone.
    void prior.then(drainedBy(wait));
  });
}

/**
 * A waiter's signal, read once: `'aborted'`, `'live'`, or `'unusable'` when
 * it is not an object, or reading `aborted` throws or gives no boolean.
 */
function readSignal(signal: unknown): 'aborted' | 'live' | 'unusable' {
  try {
    if (typeof signal !== 'object' || signal === null) return 'unusable';
    const aborted: unknown = (signal as { readonly aborted: unknown }).aborted;
    if (aborted === true) return 'aborted';
    return aborted === false ? 'live' : 'unusable';
  } catch {
    return 'unusable';
  }
}

/**
 * A slot of shared attempts. `operation` is what `classify` names when
 * `start` throws or rejects with a value that is not an error of this
 * contract.
 */
export function sharedAttempt<T>(operation: Operation): SharedAttempt<T> {
  let active: Attempt<T> | undefined;
  let previousDrain: Promise<void> = Promise.resolve();

  /**
   * The waiter's listener removal, run once and then dropped: a settled
   * waiter keeps no reference to its signal.
   */
  function detachOnce(waiter: Waiter<T>): void {
    const detach = waiter.detach;
    waiter.detach = ignore;
    detach();
  }

  /** The attempt ends; it leaves the slot if the slot still holds it. */
  function leave(attempt: Attempt<T>): void {
    attempt.ended = true;
    if (active === attempt) {
      active = undefined;
      previousDrain = attempt.drain;
    }
  }

  /**
   * The attempt settled: every live waiter gets `answer`. State first (the
   * slot left, every waiter done and out), then the foreign cleanups (a
   * signal's `removeEventListener` may call back in and must see the final
   * state), then the answers.
   */
  function settle(attempt: Attempt<T>, answer: (waiter: Waiter<T>) => void) {
    if (attempt.ended) return;
    leave(attempt);
    const waiters = attempt.waiters.splice(0);
    for (const waiter of waiters) waiter.done = true;
    for (const waiter of waiters) detachOnce(waiter);
    for (const waiter of waiters) answer(waiter);
  }

  /**
   * A waiter's abort: it leaves; the last one takes the attempt with it.
   * State first — the waiter done and out, the slot left when it was the
   * last — then the foreign cleanup, then (spec §6b's order) the waiter's
   * rejection and the attempt's abort.
   */
  function abandon(attempt: Attempt<T>, waiter: Waiter<T>): void {
    if (waiter.done) return;
    waiter.done = true;
    const index = attempt.waiters.indexOf(waiter);
    if (index >= 0) attempt.waiters.splice(index, 1);
    const last = !attempt.ended && attempt.waiters.length === 0;
    if (last) leave(attempt);
    detachOnce(waiter);
    waiter.reject(abortedFailure());
    if (last) attempt.controller.abort(abortReason());
  }

  function exclusiveOf(attempt: Attempt<T>): AttemptContext['exclusive'] {
    const signal = attempt.controller.signal;
    return <R>(work: () => Promise<R>): Promise<R> => {
      if (attempt.ended) return Promise.reject(abortedFailure());
      // Reserved at the call: a later call waits for this one's gate, which
      // opens when this work settles, or at once when it never starts.
      const prior = attempt.tail;
      let open: () => void = ignore;
      attempt.tail = new Promise<void>((resolve) => {
        open = resolve;
      });
      const opened = open;
      return waitFor(prior, signal).then(
        () => {
          // The drain settled, but the attempt may have ended in between.
          if (attempt.ended) {
            opened();
            throw abortedFailure();
          }
          // Reserved before the work runs: work that synchronously ends its
          // attempt (its last waiter's abort) hands on a drain holding it.
          let finish: () => void = ignore;
          const completion = new Promise<void>((resolve) => {
            finish = resolve;
          });
          attempt.drain = Promise.all([attempt.drain, completion]).then(ignore);
          const finished = finish;
          const running = run(work);
          void quietly(running).then(() => {
            finished();
            opened();
          });
          return running;
        },
        (failure: unknown) => {
          opened();
          throw failure;
        },
      );
    };
  }

  function begin(attempt: Attempt<T>, start: AttemptStart<T>): void {
    const context: AttemptContext = Object.freeze({
      signal: attempt.controller.signal,
      exclusive: exclusiveOf(attempt),
    });
    run(() => start(context)).then(
      (value) => settle(attempt, (waiter) => waiter.resolve(value)),
      (thrown: unknown) => {
        const error = classify(thrown, operation);
        settle(attempt, (waiter) =>
          waiter.reject(new AuthProviderFailure(error)),
        );
      },
    );
  }

  /** Adds `waiter`'s listener to `signal`; a throw refuses the waiter. */
  function listen(
    attempt: Attempt<T>,
    waiter: Waiter<T>,
    signal: AbortSignal,
  ): void {
    // No closure is built in this scope (see `bound`): the listener holds
    // the attempt and the waiter, the removal the signal and the listener.
    const onAbort = bound(abandon, attempt, waiter);
    const removal = remover(signal, onAbort);
    // The cleanup is in place before the foreign registration runs.
    waiter.detach = removal;
    let threw = false;
    try {
      signal.addEventListener('abort', onAbort, { once: true });
    } catch {
      threw = true;
    }
    // The waiter left while its registration ran (re-entrantly): its
    // removal then ran before the registration installed the listener, so
    // remove it once more, with no further change.
    if (waiter.done) {
      removal();
      return;
    }
    if (threw) {
      abandon(attempt, waiter);
      return;
    }
    // A signal that aborted during its registration (before forwarding it)
    // never calls the listener: read it again.
    if (readSignal(signal) !== 'live') abandon(attempt, waiter);
  }

  function join(start: AttemptStart<T>, signal?: AbortSignal): Promise<T> {
    if (signal !== undefined && readSignal(signal) !== 'live') {
      return Promise.reject(abortedFailure());
    }
    const fresh = active === undefined;
    const attempt: Attempt<T> = active ?? {
      controller: new AbortController(),
      waiters: [],
      drain: previousDrain,
      tail: previousDrain,
      ended: false,
    };
    active = attempt;
    const waiter: Waiter<T> = {
      done: false,
      resolve: ignore,
      reject: ignore,
      detach: ignore,
    };
    const promise = new Promise<T>((resolve, reject) => {
      waiter.resolve = resolve;
      waiter.reject = reject;
    });
    attempt.waiters.push(waiter);
    if (signal !== undefined) listen(attempt, waiter, signal);
    // A fresh attempt starts only if its first waiter is still there.
    if (fresh && !attempt.ended) begin(attempt, start);
    return promise;
  }

  return Object.freeze({ join });
}

/** One moment's waiter signal, and the way to let it go. */
export interface MomentWaiter {
  /**
   * Aborts when every party live at the moment's start, and every party
   * attached while it runs, has aborted.
   */
  readonly signal: AbortSignal;
  /**
   * Ends the moment's membership: no later attachment joins it, no party's
   * abort reaches it. Call it when the attempt it waited on has settled.
   * Idempotent.
   */
  release(): void;
}

/** A provider's attached parties (spec §6b, "Which signals are waiters"). */
export interface Parties {
  /**
   * Attaches a party. The same signal attached again is the same party. An
   * attachment is released when its signal aborts (its listener removed) or
   * when any `detach` returned for it is called. A signal already aborted —
   * before its registration or during it — or one that cannot be read or
   * listened to (as `join` judges a waiter's), is not added; its listener is
   * removed and its `detach` does nothing.
   */
  attach(signal: AbortSignal): () => void;
  /**
   * The waiter signal for a login a moment starts: `undefined` when no party
   * is live (the moment's waiter never aborts), else a `MomentWaiter`.
   */
  waiterSignal(): MomentWaiter | undefined;
}

interface Party {
  /** Dropped once the party is released: a released party holds no signal. */
  signal: AbortSignal | undefined;
  onAbort: () => void;
  released: boolean;
}

interface Moment {
  readonly controller: AbortController;
  /** Its parties not yet aborted nor detached. */
  readonly members: Party[];
  released: boolean;
}

/**
 * A moment handle's `release`: the moment and the party set's `end` are
 * held until the first call, then dropped, so a kept handle keeps neither.
 */
function releaser(moment: Moment, end: (moment: Moment) => void): () => void {
  // Both dropped at the first call: `end` closes over the whole party set.
  let held: { moment: Moment; end: (moment: Moment) => void } | undefined = {
    moment,
    end,
  };
  return () => {
    const current = held;
    held = undefined;
    if (current !== undefined && !current.moment.released)
      current.end(current.moment);
  };
}

/** Removes `item` from `list`, if there. */
function remove<V>(list: V[], item: V): boolean {
  const index = list.indexOf(item);
  if (index < 0) return false;
  list.splice(index, 1);
  return true;
}

/**
 * A set of attached parties (spec §6b). Each party holds one listener, on
 * its own signal; a moment holds none — the set tells it. A moment is
 * aborted when an abort leaves it with no member; a member detached without
 * aborting leaves it, but does not abort it. Nothing accumulates: a party
 * leaves on abort or detach, a moment on abort or release.
 */
export function createParties(): Parties {
  const parties: Party[] = [];
  const moments: Moment[] = [];

  function endMoment(moment: Moment): void {
    moment.released = true;
    remove(moments, moment);
    // An ended moment keeps no party (a kept handle must not keep them).
    moment.members.length = 0;
  }

  /**
   * A party leaves. State first — out of the set and of every moment, each
   * moment an abort empties ended — then the foreign cleanup (its signal's
   * `removeEventListener` may call back in and must see the final state),
   * then the emptied moments abort.
   */
  function release(party: Party, aborted: boolean): void {
    if (party.released) return;
    party.released = true;
    remove(parties, party);
    const emptied: Moment[] = [];
    for (const moment of moments.slice()) {
      if (!remove(moment.members, party)) continue;
      if (aborted && moment.members.length === 0) {
        endMoment(moment);
        emptied.push(moment);
      }
    }
    const signal = party.signal;
    party.signal = undefined;
    if (signal !== undefined) remover(signal, party.onAbort)();
    party.onAbort = ignore;
    for (const moment of emptied) moment.controller.abort(abortReason());
  }

  function attach(signal: AbortSignal): () => void {
    if (readSignal(signal) !== 'live') return ignore;
    // No closure is built in this scope (see `bound`), so none holds the
    // signal beside the party.
    let existing: Party | undefined;
    for (const candidate of parties) {
      if (candidate.signal === signal) existing = candidate;
    }
    // An explicit detach of the same party: not a cancellation.
    if (existing !== undefined) return bound(release, existing, false);
    const party: Party = { signal, onAbort: ignore, released: false };
    party.onAbort = bound(release, party, true);
    const listener = party.onAbort;
    parties.push(party);
    for (const moment of moments) moment.members.push(party);
    // A registration that does not end cleanly — it throws, or the signal is
    // aborted or unreadable after it — removes the provisional party as an
    // abort (as join refuses such a waiter `aborted`): a moment left with no
    // member is aborted (the registration may have aborted the others).
    let registered = false;
    try {
      signal.addEventListener('abort', listener, { once: true });
      registered = true;
    } catch {
      registered = false;
    }
    // The party left while its registration ran (re-entrantly: a detach, an
    // abort): its removal ran before the listener was installed, so remove
    // it once more, with no further membership change.
    if (party.released) {
      remover(signal, listener)();
      return ignore;
    }
    if (!registered || readSignal(signal) !== 'live') {
      release(party, true);
      return ignore;
    }
    // The one removal that is not a cancellation: an explicit detach.
    return bound(release, party, false);
  }

  function waiterSignal(): MomentWaiter | undefined {
    if (parties.length === 0) return undefined;
    const moment: Moment = {
      controller: new AbortController(),
      members: parties.slice(),
      released: false,
    };
    moments.push(moment);
    return Object.freeze({
      signal: moment.controller.signal,
      release: releaser(moment, endMoment),
    });
  }

  return Object.freeze({ attach, waiterSignal });
}
