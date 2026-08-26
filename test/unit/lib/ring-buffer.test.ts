import { describe, it, expect } from "vitest";
import { RingBuffer } from "../../../src/lib/ring-buffer.js";

describe("RingBuffer", () => {
  it("initializes with default capacity", () => {
    const buffer = new RingBuffer();
    expect(buffer.bufferCapacity).toBe(500);
    expect(buffer.size).toBe(0);
    expect(buffer.totalBuffered).toBe(0);
    expect(buffer.getAll()).toEqual([]);
  });

  it("pushes entries and assigns monotonic sequence numbers and timestamps", () => {
    const buffer = new RingBuffer(5);
    const e1 = buffer.push("Line 1");
    expect(e1.seq).toBe(1);
    expect(e1.text).toBe("Line 1");
    expect(e1.timestamp).toBeDefined();

    const e2 = buffer.push("Line 2");
    expect(e2.seq).toBe(2);
    expect(e2.text).toBe("Line 2");

    expect(buffer.size).toBe(2);
    expect(buffer.totalBuffered).toBe(2);
    expect(buffer.getAll()).toEqual([e1, e2]);
  });

  it("overwrites oldest entries when capacity is exceeded", () => {
    const buffer = new RingBuffer(3);
    buffer.push("A"); // seq 1
    buffer.push("B"); // seq 2
    buffer.push("C"); // seq 3
    buffer.push("D"); // seq 4, overwrites A
    buffer.push("E"); // seq 5, overwrites B

    expect(buffer.size).toBe(3);
    expect(buffer.totalBuffered).toBe(5);

    const all = buffer.getAll();
    expect(all.map((e) => e.text)).toEqual(["C", "D", "E"]);
    expect(all.map((e) => e.seq)).toEqual([3, 4, 5]);
  });

  it("retrieves recent entries correctly", () => {
    const buffer = new RingBuffer(5);
    buffer.push("1");
    buffer.push("2");
    buffer.push("3");
    buffer.push("4");

    expect(buffer.getRecent(2).map((e) => e.text)).toEqual(["3", "4"]);
    expect(buffer.getRecent(10).map((e) => e.text)).toEqual(["1", "2", "3", "4"]);
    expect(buffer.getRecent(0)).toEqual([]);
  });

  it("retrieves entries since a given sequence number", () => {
    const buffer = new RingBuffer(5);
    buffer.push("A"); // seq 1
    buffer.push("B"); // seq 2
    buffer.push("C"); // seq 3
    buffer.push("D"); // seq 4

    expect(buffer.getSince(2).map((e) => e.text)).toEqual(["C", "D"]);
    expect(buffer.getSince(4)).toEqual([]);
    expect(buffer.getSince(0).map((e) => e.text)).toEqual(["A", "B", "C", "D"]);
  });

  it("clears the buffer", () => {
    const buffer = new RingBuffer(5);
    buffer.push("A");
    buffer.push("B");
    buffer.clear();
    expect(buffer.size).toBe(0);
    expect(buffer.getAll()).toEqual([]);
  });
});
