import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * What a finished handle keeps reachable (spec §6b): a handle the consumer
 * keeps — a used or stale `detach`, a released or self-ended
 * `MomentWaiter`, an `AttemptContext`, a waiter's promise — must keep no
 * consumer signal alive: neither the finished member's nor, through the
 * module's state, an unrelated live member's once the `Parties` object or
 * the slot is dropped. Each scenario runs in a child process with
 * `--expose-gc`, keeps only the finished handles and drops everything else,
 * and reports which signals were collected.
 */
const entry = resolve(__dirname, '../../dist/index.js');

const SCENARIOS = String.raw`
const { createParties, sharedAttempt } = require(process.argv[1]);
const name = process.argv[2];
const keep = [];
async function collect(refs) {
  for (let i = 0; i < 30; i += 1) {
    await new Promise((r) => setImmediate(r));
    global.gc();
    if (refs.every((ref) => ref.deref() === undefined)) break;
  }
  return refs.map((ref) => ref.deref() === undefined);
}
const never = () => new Promise(() => {});
const scenarios = {
  // A used detach kept; another party attached and left live.
  async detachKept() {
    let parties = createParties();
    let a = new AbortController();
    let b = new AbortController();
    const refs = [new WeakRef(a.signal), new WeakRef(b.signal)];
    const detach = parties.attach(a.signal);
    detach();
    parties.attach(b.signal);
    keep.push(detach);
    parties = a = b = undefined;
    return refs;
  },
  // A stale detach (its party aborted) kept; another party live.
  async staleDetach() {
    let parties = createParties();
    let a = new AbortController();
    let b = new AbortController();
    const refs = [new WeakRef(a.signal), new WeakRef(b.signal)];
    const detach = parties.attach(a.signal);
    a.abort();
    parties.attach(b.signal);
    keep.push(detach);
    parties = a = b = undefined;
    return refs;
  },
  // A released moment and a used detach kept; another party live.
  async releasedMoment() {
    let parties = createParties();
    let a = new AbortController();
    let b = new AbortController();
    const refs = [new WeakRef(a.signal), new WeakRef(b.signal)];
    const detach = parties.attach(a.signal);
    const handle = parties.waiterSignal();
    handle.release();
    detach();
    parties.attach(b.signal);
    keep.push(handle, detach);
    parties = a = b = undefined;
    return refs;
  },
  // A released moment whose party was never detached; another live.
  async releasedLive() {
    let parties = createParties();
    let a = new AbortController();
    let b = new AbortController();
    const refs = [new WeakRef(a.signal), new WeakRef(b.signal)];
    parties.attach(a.signal);
    const handle = parties.waiterSignal();
    handle.release();
    parties.attach(b.signal);
    keep.push(handle);
    parties = a = b = undefined;
    return refs;
  },
  // A moment ended by its party's abort, never released; another live.
  async abortedMoment() {
    let parties = createParties();
    let a = new AbortController();
    let b = new AbortController();
    const refs = [new WeakRef(a.signal), new WeakRef(b.signal)];
    const detach = parties.attach(a.signal);
    const handle = parties.waiterSignal();
    a.abort();
    parties.attach(b.signal);
    keep.push(handle, detach);
    parties = a = b = undefined;
    return refs;
  },
  // A moment whose member detached, ended by the other's abort.
  async detachedMember() {
    let parties = createParties();
    let a = new AbortController();
    let b = new AbortController();
    let c = new AbortController();
    const refs = [
      new WeakRef(a.signal),
      new WeakRef(b.signal),
      new WeakRef(c.signal),
    ];
    const detach = parties.attach(a.signal);
    parties.attach(b.signal);
    const handle = parties.waiterSignal();
    detach();
    b.abort();
    parties.attach(c.signal);
    keep.push(handle, detach);
    parties = a = b = c = undefined;
    return refs;
  },
  // A settled attempt's context and promise kept; another waiter live.
  async settled() {
    let slot = sharedAttempt('token-request');
    let a = new AbortController();
    let b = new AbortController();
    const refs = [new WeakRef(a.signal), new WeakRef(b.signal)];
    let context;
    const promise = slot.join((ctx) => {
      context = ctx;
      return Promise.resolve('token');
    }, a.signal);
    await promise;
    slot.join(never, b.signal).catch(() => {});
    keep.push(context, promise);
    slot = a = b = undefined;
    return refs;
  },
  // An aborted attempt's context and promise kept; another waiter live.
  async abandoned() {
    let slot = sharedAttempt('token-request');
    let a = new AbortController();
    let b = new AbortController();
    const refs = [new WeakRef(a.signal), new WeakRef(b.signal)];
    let context;
    const promise = slot.join((ctx) => {
      context = ctx;
      return never();
    }, a.signal);
    promise.catch(() => {});
    a.abort();
    slot.join(never, b.signal).catch(() => {});
    keep.push(context, promise);
    slot = a = b = undefined;
    return refs;
  },
};
scenarios[name]().then(collect).then((collected) => {
  process.stdout.write(JSON.stringify({ collected, kept: keep.length }));
});
`;

function run(name: string): { collected: boolean[]; kept: number } {
  const out = execFileSync(
    process.execPath,
    ['--expose-gc', '-e', SCENARIOS, entry, name],
    { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } },
  );
  return JSON.parse(out) as { collected: boolean[]; kept: number };
}

describe('what a finished handle keeps reachable', () => {
  it.each([
    'detachKept',
    'staleDetach',
    'releasedMoment',
    'releasedLive',
    'abortedMoment',
    'detachedMember',
    'settled',
    'abandoned',
  ])(
    '%s: every signal is collectible while the finished handles are kept',
    (name) => {
      const result = run(name);
      expect(result.kept).toBeGreaterThan(0);
      expect(result.collected).toEqual(result.collected.map(() => true));
    },
  );
});
