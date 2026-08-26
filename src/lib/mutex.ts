import { createRokuError, ErrorCode } from "../types/errors.js";

export class AsyncMutex {
  private locked: boolean = false;
  private waitingQueue: Array<{
    resolve: (release: () => void) => void;
    reject: (err: Error) => void;
    timer?: NodeJS.Timeout;
  }> = [];

  public async acquire(timeoutMs?: number): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return this.createRelease();
    }

    return new Promise<() => void>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;

      if (timeoutMs !== undefined && timeoutMs > 0) {
        timer = setTimeout(() => {
          const index = this.waitingQueue.findIndex((item) => item.resolve === resolve);
          if (index !== -1) {
            this.waitingQueue.splice(index, 1);
            reject(
              createRokuError(
                ErrorCode.PORT_BUSY,
                `Timeout (${timeoutMs}ms) waiting for port mutex lock`
              )
            );
          }
        }, timeoutMs);
      }

      this.waitingQueue.push({ resolve, reject, timer });
    });
  }

  public async runExclusive<T>(
    fn: () => Promise<T>,
    timeoutMs?: number
  ): Promise<T> {
    const release = await this.acquire(timeoutMs);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;

      const next = this.waitingQueue.shift();
      if (next) {
        if (next.timer) {
          clearTimeout(next.timer);
        }
        next.resolve(this.createRelease());
      } else {
        this.locked = false;
      }
    };
  }

  public get isLocked(): boolean {
    return this.locked;
  }

  public get queueLength(): number {
    return this.waitingQueue.length;
  }
}
