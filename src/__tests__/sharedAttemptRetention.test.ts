import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * What a finished moment or attempt keeps reachable (spec §6b): a handle the
 * consumer keeps — a released `MomentWaiter`, a `detach`, an
 * `AttemptContext`, a waiter's promise — must not keep a party's or a
 * waiter's signal alive. Each scenario runs in a child process with
 * `--expose-gc` and reports whether the signal was collected.
 */
const entry = resolve(__dirname, '../../dist/index.js');

const SCENARIOS = String.raw`
const { createParties, sharedAttempt } = require(process.argv[1]);
const name = process.argv[2];
const keep = [];
async function collect(ref) {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setImmediate(r));
    global.gc();
    if (ref.deref() === undefined) return true;
  }
  return false;
}
const scenarios = {
  // A released moment and a used detach, both kept.
  async released() {
    const parties = createParties();
    let c = new AbortController();
    const ref = new WeakRef(c.signal);
    const detach = parties.attach(c.signal);
    const handle = parties.waiterSignal();
    handle.release();
    detach();
    keep.push(handle, detach);
    c = undefined;
    return ref;
  },
  // A released moment whose party was never detached: the party set and
  // the controller dropped, only the handle kept.
  async releasedLive() {
    let parties = createParties();
    let c = new AbortController();
    const ref = new WeakRef(c.signal);
    parties.attach(c.signal);
    const handle = parties.waiterSignal();
    handle.release();
    keep.push(handle);
    parties = undefined;
    c = undefined;
    return ref;
  },
  // A moment ended by its party's abort, the handle and detach kept.
  async aborted() {
    const parties = createParties();
    let c = new AbortController();
    const ref = new WeakRef(c.signal);
    const detach = parties.attach(c.signal);
    const handle = parties.waiterSignal();
    c.abort();
    keep.push(handle, detach);
    c = undefined;
    return ref;
  },
  // A moment ended by another party's abort while this one was detached.
  async detachedMember() {
    const parties = createParties();
    let c = new AbortController();
    const other = new AbortController();
    const ref = new WeakRef(c.signal);
    const detach = parties.attach(c.signal);
    parties.attach(other.signal);
    const handle = parties.waiterSignal();
    detach();
    keep.push(handle, detach, other);
    c = undefined;
    return ref;
  },
  // A settled attempt: its context and the waiter's promise kept.
  async settled() {
    const slot = sharedAttempt('token-request');
    let c = new AbortController();
    const ref = new WeakRef(c.signal);
    let context;
    const promise = slot.join((ctx) => {
      context = ctx;
      return Promise.resolve('token');
    }, c.signal);
    await promise;
    keep.push(context, promise, slot);
    c = undefined;
    return ref;
  },
  // An aborted attempt: its context and the waiter's promise kept.
  async abandoned() {
    const slot = sharedAttempt('token-request');
    let c = new AbortController();
    const ref = new WeakRef(c.signal);
    let context;
    const promise = slot.join((ctx) => {
      context = ctx;
      return new Promise(() => {});
    }, c.signal);
    promise.catch(() => {});
    c.abort();
    keep.push(context, promise, slot);
    c = undefined;
    return ref;
  },
};
scenarios[name]().then(collect).then((collected) => {
  process.stdout.write(JSON.stringify({ collected, kept: keep.length }));
});
`;

function run(name: string): { collected: boolean; kept: number } {
  const out = execFileSync(
    process.execPath,
    ['--expose-gc', '-e', SCENARIOS, entry, name],
    { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } },
  );
  return JSON.parse(out) as { collected: boolean; kept: number };
}

describe('what a finished moment or attempt keeps reachable', () => {
  it.each([
    'released',
    'releasedLive',
    'aborted',
    'detachedMember',
    'settled',
    'abandoned',
  ])('%s: the signal is collectible while the handles are kept', (name) => {
    const result = run(name);
    expect(result.kept).toBeGreaterThan(0);
    expect(result.collected).toBe(true);
  });
});
