import type { Clock } from "@duyquangnvx/agent-cli";

interface Sleeper {
  readonly at: number;
  readonly wake: () => void;
}

// Node's names for a file read or write in flight; time waits for them, as it would really.
const FILE_REQUESTS = ["FSReqPromise", "FSReqCallback", "CloseReq"];

function filesBusy(): boolean {
  return process.getActiveResourcesInfo().some((resource) => FILE_REQUESTS.includes(resource));
}

/**
 * A clock whose time moves only when every task is waiting on it: the earliest sleep then wakes
 * at once, so deadlines and polls run instantly and in order. `busy` says when work Node cannot see,
 * such as sharp on its own threads, is still running.
 */
export function fakeClock(busy: () => boolean = () => false): Clock {
  let now = 0;
  let sleepers: Sleeper[] = [];
  let scheduled = false;

  const wakeEarliest = (): void => {
    if (filesBusy() || busy()) {
      setImmediate(wakeEarliest);
      return;
    }
    scheduled = false;
    const [earliest] = [...sleepers].sort((a, b) => a.at - b.at);
    if (earliest === undefined) return;
    sleepers = sleepers.filter((sleeper) => sleeper !== earliest);
    now = Math.max(now, earliest.at);
    earliest.wake();
    schedule();
  };
  const schedule = (): void => {
    if (scheduled || sleepers.length === 0) return;
    scheduled = true;
    setImmediate(wakeEarliest);
  };

  return {
    now: () => now,
    sleep: (ms, signal) =>
      new Promise((resolve, reject) => {
        if (signal?.aborted === true) {
          reject(signal.reason);
          return;
        }
        const sleeper: Sleeper = { at: now + ms, wake: resolve };
        sleepers = [...sleepers, sleeper];
        signal?.addEventListener(
          "abort",
          () => {
            sleepers = sleepers.filter((other) => other !== sleeper);
            reject(signal.reason);
          },
          { once: true },
        );
        schedule();
      }),
  };
}
