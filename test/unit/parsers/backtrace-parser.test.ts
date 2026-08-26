import { describe, it, expect } from "vitest";
import { parseBacktrace } from "../../../src/parsers/backtrace-parser.js";

describe("backtrace-parser", () => {
  it("parses multi-frame BrightScript backtrace", () => {
    const raw = `
#0  Function oncontentloaded() As Void
   file/line: pkg:/components/HomeScene.brs(42)
#1  Function main() As Void
   file/line: pkg:/source/main.brs(5)
`;
    const frames = parseBacktrace(raw);
    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual({
      frame: 0,
      function: "Function oncontentloaded() As Void",
      file: "pkg:/components/HomeScene.brs",
      line: 42,
    });
    expect(frames[1]).toEqual({
      frame: 1,
      function: "Function main() As Void",
      file: "pkg:/source/main.brs",
      line: 5,
    });
  });

  it("handles alternative formatting and returns empty array on invalid text", () => {
    expect(parseBacktrace("")).toEqual([]);
    expect(parseBacktrace("Some random log line")).toEqual([]);

    const alternative = `
#0 Sub init()
   file/line: pkg:/components/DetailView.brs:18
`;
    const frames = parseBacktrace(alternative);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({
      frame: 0,
      function: "Sub init()",
      file: "pkg:/components/DetailView.brs",
      line: 18,
    });
  });
});
