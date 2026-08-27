import { InstallerAdapter } from "../adapters/installer.js";
import { EcpAdapter } from "../adapters/ecp.js";
import { SgDebugAdapter } from "../adapters/sg-debug.js";
import { BsConsoleAdapter } from "../adapters/bs-console.js";
import {
  CaptureStateInput,
  CaptureStateResult,
  ScreenshotData,
} from "../types/tools.js";
import { ActiveApp, CrashEvent, LogEntry, SGTreeResult } from "../types/roku.js";

export interface CaptureStateContext {
  installer: InstallerAdapter;
  ecp: EcpAdapter;
  sgDebug: SgDebugAdapter;
  bsConsole: BsConsoleAdapter;
}

export async function handleCaptureState(
  input: CaptureStateInput,
  context: CaptureStateContext
): Promise<CaptureStateResult> {
  const capturedAt = new Date().toISOString();
  const logLinesCount = input.log_lines ?? 50;

  // 1. Log snapshot
  const rawLogs = context.bsConsole.getRecentLogs(logLinesCount);
  const log = {
    lines: rawLogs,
    total_buffered: context.bsConsole.totalBuffered,
    buffer_capacity: context.bsConsole.bufferCapacity,
  };

  // 2. Active app query
  let activeApp: ActiveApp | null = null;
  try {
    activeApp = await context.ecp.getActiveApp();
  } catch {
    // Non-fatal if active app query fails
  }

  // 3. Screenshot capture (optional)
  let screenshot: ScreenshotData | null = null;
  if (input.include_screenshot !== false) {
    try {
      screenshot = await context.installer.captureScreenshot();
    } catch {
      // Non-fatal if screenshot capture fails (e.g. no sideloaded app active)
    }
  }

  // 4. UI tree (optional)
  let uiTree: SGTreeResult | null = null;
  if (input.include_ui_tree) {
    try {
      uiTree = await context.sgDebug.getUiTree();
    } catch {
      // Non-fatal
    }
  }

  // 5. Crash check
  const crashDetected = context.bsConsole.hasCrash();
  const crashDetails: CrashEvent | null = context.bsConsole.getLastCrash();

  return {
    captured_at: capturedAt,
    active_app: activeApp,
    log,
    screenshot,
    crash_detected: crashDetected,
    crash_details: crashDetails,
    ui_tree: uiTree,
  };
}
