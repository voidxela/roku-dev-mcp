import { BacktraceFrame } from "../types/roku.js";

export function parseBacktrace(text: string): BacktraceFrame[] {
  const frames: BacktraceFrame[] = [];
  const lines = text.split(/\r?\n/);

  let currentFrameNumber: number | null = null;
  let currentFunction: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Match frame header: #0 Function oncontentloaded() As Void, or #1 Sub init()
    const frameMatch = line.match(/^#(\d+)\s+(?:(Function|Sub)\s+)?(.*)$/i);
    if (frameMatch) {
      currentFrameNumber = parseInt(frameMatch[1], 10);
      const prefix = frameMatch[2] ? `${frameMatch[2]} ` : "";
      currentFunction = `${prefix}${frameMatch[3]}`.trim();
      continue;
    }

    // Match file/line: file/line: pkg:/components/HomeScene.brs(42) or file/line: pkg:/source/main.brs:5
    const fileLineMatch = line.match(/file\/line:\s*(.+?)(?:\((\d+)\)|:(\d+))\s*$/i);
    if (fileLineMatch && currentFrameNumber !== null && currentFunction !== null) {
      const file = fileLineMatch[1].trim();
      const lineNumber = parseInt(fileLineMatch[2] || fileLineMatch[3], 10);

      frames.push({
        frame: currentFrameNumber,
        function: currentFunction,
        file,
        line: lineNumber,
      });

      currentFrameNumber = null;
      currentFunction = null;
    }
  }

  return frames;
}
