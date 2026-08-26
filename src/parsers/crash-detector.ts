import { CrashEvent } from "../types/roku.js";
import { parseBacktrace } from "./backtrace-parser.js";

export const CRASH_REGEX =
  /(?:^|\s)(?:BRIGHTSCRIPT:\s*ERROR:|Runtime Error\s*\(code\s*\d+\)|ERR_.*STOP)/i;

export function isCrashLine(line: string): boolean {
  return CRASH_REGEX.test(line);
}

export function extractCrashEvent(
  lines: string[],
  triggerIndex?: number,
  timestamp?: string
): CrashEvent {
  let trigIdx = triggerIndex;

  if (trigIdx === undefined || trigIdx < 0 || trigIdx >= lines.length) {
    trigIdx = lines.findIndex((l) => isCrashLine(l));
  }

  const triggerLine =
    trigIdx !== -1 && trigIdx < lines.length
      ? lines[trigIdx]
      : "Unknown BrightScript Crash";

  const start = Math.max(0, (trigIdx !== -1 ? trigIdx : 0) - 50);
  const end = Math.min(lines.length, (trigIdx !== -1 ? trigIdx : 0) + 50);
  const contextLines = lines.slice(start, end);

  const fullContextText = contextLines.join("\n");
  const backtrace = parseBacktrace(fullContextText);

  return {
    detected_at: timestamp || new Date().toISOString(),
    trigger_line: triggerLine,
    context_lines: contextLines,
    backtrace,
  };
}
