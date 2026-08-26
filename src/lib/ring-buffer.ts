import { LogEntry } from "../types/roku.js";

export class RingBuffer {
  private readonly buffer: LogEntry[];
  private readonly capacity: number;
  private head: number = 0;
  private count: number = 0;
  private currentSeq: number = 0;

  constructor(capacity: number = 500) {
    if (capacity <= 0) {
      throw new Error("RingBuffer capacity must be greater than 0");
    }
    this.capacity = capacity;
    this.buffer = new Array<LogEntry>(capacity);
  }

  public push(text: string, timestamp?: string): LogEntry {
    const entry: LogEntry = {
      seq: ++this.currentSeq,
      timestamp: timestamp || new Date().toISOString(),
      text,
    };

    this.buffer[this.head] = entry;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }

    return entry;
  }

  public getAll(): LogEntry[] {
    if (this.count === 0) {
      return [];
    }

    const result: LogEntry[] = [];
    const start = this.count < this.capacity ? 0 : this.head;

    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      result.push(this.buffer[idx]);
    }

    return result;
  }

  public getRecent(count: number): LogEntry[] {
    const all = this.getAll();
    if (count <= 0) {
      return [];
    }
    if (count >= all.length) {
      return all;
    }
    return all.slice(all.length - count);
  }

  public getSince(seq: number): LogEntry[] {
    return this.getAll().filter((entry) => entry.seq > seq);
  }

  public clear(): void {
    this.head = 0;
    this.count = 0;
    this.buffer.fill(undefined as unknown as LogEntry);
  }

  public get totalBuffered(): number {
    return this.currentSeq;
  }

  public get size(): number {
    return this.count;
  }

  public get bufferCapacity(): number {
    return this.capacity;
  }
}
