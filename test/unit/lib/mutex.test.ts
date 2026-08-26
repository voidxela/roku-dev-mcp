import { describe, it, expect } from "vitest";
import { AsyncMutex } from "../../../src/lib/mutex.js";
import { ErrorCode } from "../../../src/types/errors.js";

describe("AsyncMutex", () => {
  it("allows immediate acquisition when unlocked", async () => {
    const mutex = new AsyncMutex();
    expect(mutex.isLocked).toBe(false);

    const release = await mutex.acquire();
    expect(mutex.isLocked).toBe(true);

    release();
    expect(mutex.isLocked).toBe(false);
  });

  it("serializes concurrent access", async () => {
    const mutex = new AsyncMutex();
    const sequence: number[] = [];

    const p1 = mutex.runExclusive(async () => {
      sequence.push(1);
      await new Promise((r) => setTimeout(r, 50));
      sequence.push(2);
    });

    const p2 = mutex.runExclusive(async () => {
      sequence.push(3);
      await new Promise((r) => setTimeout(r, 20));
      sequence.push(4);
    });

    await Promise.all([p1, p2]);
    expect(sequence).toEqual([1, 2, 3, 4]);
  });

  it("rejects with PORT_BUSY on timeout", async () => {
    const mutex = new AsyncMutex();
    const release = await mutex.acquire();

    await expect(mutex.acquire(50)).rejects.toMatchObject({
      code: ErrorCode.PORT_BUSY,
    });

    release();
  });
});
