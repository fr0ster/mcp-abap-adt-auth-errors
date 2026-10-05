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
 * no bound: no timer anywhere.
 *
 * What an attempt commits stays with the caller: `start`'s value is handed
 * to the waiters, never applied here.
 *
 * **A waiter's signal is foreign.** Its `aborted` is read once and must be a
 * boolean; its listener is added and removed inside a `try`. A signal that
 * is not an object, whose `aborted` throws or is not a boolean, or whose
 * `addEventListener` throws cannot be honoured: its waiter is refused
 * `aborted` at once, so it neither starts nor keeps an attempt. Its listener
 * is idempotent (a second call changes nothing), and a throwing
 * `removeEventListener` is ignored: no signal can harm another waiter.
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

/** One slot of shared attempts (spec §6b). */
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
  return new AuthProviderFailure(
    authError['interactive-login']({ outcome: 'aborted' }),
  );
}

const ignore = (): void => undefined;

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
  /** The inherited drain, then each exclusive work's settling. */
  drain: Promise<void>;
  /** Left the slot: aborted or settled. */
  ended: boolean;
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

  /** The attempt ends; it leaves the slot if the slot still holds it. */
  function leave(attempt: Attempt<T>): void {
    attempt.ended = true;
    if (active === attempt) {
      active = undefined;
      previousDrain = attempt.drain;
    }
  }

  /** The attempt settled: every live waiter gets `answer`. */
  function settle(attempt: Attempt<T>, answer: (waiter: Waiter<T>) => void) {
    if (attempt.ended) return;
    leave(attempt);
    for (const waiter of attempt.waiters.splice(0)) {
      waiter.done = true;
      waiter.detach();
      answer(waiter);
    }
  }

  /** A waiter's abort: it leaves; the last one takes the attempt with it. */
  function abandon(attempt: Attempt<T>, waiter: Waiter<T>): void {
    if (waiter.done) return;
    waiter.done = true;
    waiter.detach();
    const index = attempt.waiters.indexOf(waiter);
    if (index >= 0) attempt.waiters.splice(index, 1);
    const last = !attempt.ended && attempt.waiters.length === 0;
    // Order (spec §6b): leave the slot, reject the waiter, abort the attempt.
    if (last) leave(attempt);
    waiter.reject(abortedFailure());
    if (last) attempt.controller.abort();
  }

  function exclusiveOf(attempt: Attempt<T>): AttemptContext['exclusive'] {
    const signal = attempt.controller.signal;
    return <R>(work: () => Promise<R>): Promise<R> => {
      const before = attempt.drain;
      const ready = new Promise<void>((resolve, reject) => {
        if (attempt.ended) {
          reject(abortedFailure());
          return;
        }
        const onAbort = (): void => reject(abortedFailure());
        signal.addEventListener('abort', onAbort, { once: true });
        void before.then(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        });
      });
      return ready.then(() => {
        if (attempt.ended) throw abortedFailure();
        const running = run(work);
        attempt.drain = Promise.all([attempt.drain, quietly(running)]).then(
          ignore,
        );
        return running;
      });
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
    const onAbort = (): void => abandon(attempt, waiter);
    try {
      signal.addEventListener('abort', onAbort, { once: true });
    } catch {
      abandon(attempt, waiter);
      return;
    }
    if (waiter.done) return;
    waiter.detach = () => {
      try {
        signal.removeEventListener('abort', onAbort);
      } catch {
        // Ignored: the waiter is settled whatever the signal does.
      }
    };
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
