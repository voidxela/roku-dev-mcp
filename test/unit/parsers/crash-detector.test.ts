import { describe, it, expect } from "vitest";
import {
  isCrashLine,
  extractCrashEvent,
} from "../../../src/parsers/crash-detector.js";

describe("crash-detector", () => {
  it("detects various BrightScript crash signatures", () => {
    expect(
      isCrashLine(
        "BRIGHTSCRIPT: ERROR: Runtime Error (code 244): Dot Operator invoked on invalid type"
      )
    ).toBe(true);

    expect(
      isCrashLine(
        "Runtime Error (code 024) in pkg:/source/main.brs(10)"
      )
    ).toBe(true);

    expect(isCrashLine("ERR_NORMAL_STOP: Execution stopped")).toBe(true);

    expect(isCrashLine("Normal log message: Initializing component")).toBe(false);
    expect(isCrashLine("------ Running dev 'MyApp' main ------")).toBe(false);
  });

  it("extracts structured crash event with context lines and backtrace", () => {
    const lines = [
      "Initializing app...",
      "Connecting to server...",
      "BRIGHTSCRIPT: ERROR: Runtime Error (code 244): \"Dot Operator invoked on invalid type\"",
      "#0  Function oncontentloaded() As Void",
      "   file/line: pkg:/components/HomeScene.brs(42)",
      "#1  Function main() As Void",
      "   file/line: pkg:/source/main.brs(5)",
      "Channel exited with code 1",
    ];

    const event = extractCrashEvent(lines);
    expect(event.trigger_line).toContain("BRIGHTSCRIPT: ERROR:");
    expect(event.context_lines).toHaveLength(lines.length);
    expect(event.backtrace).toHaveLength(2);
    expect(event.backtrace[0].function).toBe("Function oncontentloaded() As Void");
    expect(event.backtrace[0].file).toBe("pkg:/components/HomeScene.brs");
    expect(event.backtrace[0].line).toBe(42);
  });
});
