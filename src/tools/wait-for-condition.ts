import { EcpAdapter } from "../adapters/ecp.js";
import { SgDebugAdapter } from "../adapters/sg-debug.js";
import { BsConsoleAdapter } from "../adapters/bs-console.js";
import { SGNode } from "../types/roku.js";
import { createRokuError, ErrorCode } from "../types/errors.js";
import {
  WaitForConditionInput,
  WaitForConditionResult,
} from "../types/tools.js";

export interface WaitForConditionContext {
  ecp: EcpAdapter;
  sgDebug: SgDebugAdapter;
  bsConsole: BsConsoleAdapter;
}

interface ParsedCondition {
  type:
    | "node_exists"
    | "node_field"
    | "playback_state"
    | "app_active"
    | "log_contains"
    | "crash_detected";
  nodeId?: string;
  field?: string;
  value?: string;
  expectedState?: string;
  appId?: string;
  pattern?: string;
}

export function parseConditionExpression(expression: string): ParsedCondition {
  const trimmed = expression.trim();

  if (trimmed.toLowerCase() === "crash_detected") {
    return { type: "crash_detected" };
  }

  const nodeExistsMatch = trimmed.match(/^node_exists:\s*(.+)$/i);
  if (nodeExistsMatch) {
    return { type: "node_exists", nodeId: nodeExistsMatch[1].trim() };
  }

  const nodeFieldMatch = trimmed.match(/^node_field:\s*([^.]+)\.([^=]+)=(.*)$/i);
  if (nodeFieldMatch) {
    return {
      type: "node_field",
      nodeId: nodeFieldMatch[1].trim(),
      field: nodeFieldMatch[2].trim(),
      value: nodeFieldMatch[3].trim(),
    };
  }

  const playbackStateMatch = trimmed.match(/^playback_state:\s*(.+)$/i);
  if (playbackStateMatch) {
    return {
      type: "playback_state",
      expectedState: playbackStateMatch[1].trim().toLowerCase(),
    };
  }

  const appActiveMatch = trimmed.match(/^app_active:\s*(.+)$/i);
  if (appActiveMatch) {
    return { type: "app_active", appId: appActiveMatch[1].trim() };
  }

  const logContainsMatch = trimmed.match(/^log_contains:\s*(.+)$/i);
  if (logContainsMatch) {
    return { type: "log_contains", pattern: logContainsMatch[1].trim() };
  }

  throw createRokuError(
    ErrorCode.INVALID_CONDITION,
    `Unrecognized condition expression format: '${expression}'`
  );
}

function findNode(nodes: SGNode[], targetId: string): SGNode | null {
  const lowerId = targetId.toLowerCase();
  for (const node of nodes) {
    if (node.id && node.id.toLowerCase() === lowerId) {
      return node;
    }
    const found = findNode(node.children, targetId);
    if (found) return found;
  }
  return null;
}

export async function evaluateCondition(
  parsed: ParsedCondition,
  context: WaitForConditionContext
): Promise<{ satisfied: boolean; snapshot: unknown | null }> {
  switch (parsed.type) {
    case "node_exists": {
      try {
        const treeResult = await context.sgDebug.getUiTree();
        const matched = findNode(treeResult.tree, parsed.nodeId!);
        if (matched) {
          return {
            satisfied: true,
            snapshot: {
              matched_node: {
                type: matched.type,
                id: matched.id,
                subtype: matched.subtype,
              },
            },
          };
        }
      } catch {
        // SG debug server might not be ready yet
      }
      return { satisfied: false, snapshot: null };
    }

    case "node_field": {
      try {
        const treeResult = await context.sgDebug.getUiTree();
        const matched = findNode(treeResult.tree, parsed.nodeId!);
        if (matched) {
          const fieldName = parsed.field!;
          const expectedVal = parsed.value!;

          let actualVal: string | undefined;
          if (matched.fields && matched.fields[fieldName] !== undefined) {
            actualVal = matched.fields[fieldName];
          } else if (fieldName === "subtype") {
            actualVal = matched.subtype;
          } else if (fieldName === "type") {
            actualVal = matched.type;
          }

          if (actualVal !== undefined && actualVal.toLowerCase() === expectedVal.toLowerCase()) {
            return {
              satisfied: true,
              snapshot: {
                matched_node: {
                  type: matched.type,
                  id: matched.id,
                  field: fieldName,
                  value: actualVal,
                },
              },
            };
          }
        }
      } catch {
        // Ignore
      }
      return { satisfied: false, snapshot: null };
    }

    case "playback_state": {
      try {
        const media = await context.ecp.getMediaPlayer();
        if (String(media.state).toLowerCase() === parsed.expectedState) {
          return {
            satisfied: true,
            snapshot: {
              state: media.state,
              position_ms: media.position_ms,
              duration_ms: media.duration_ms,
            },
          };
        }
      } catch {
        // Ignore
      }
      return { satisfied: false, snapshot: null };
    }

    case "app_active": {
      try {
        const activeApp = await context.ecp.getActiveApp();
        if (activeApp.id.toLowerCase() === parsed.appId!.toLowerCase()) {
          return {
            satisfied: true,
            snapshot: { active_app: activeApp },
          };
        }
      } catch {
        // Ignore
      }
      return { satisfied: false, snapshot: null };
    }

    case "log_contains": {
      const logs = context.bsConsole.getAllLogs();
      const regex = new RegExp(parsed.pattern!, "i");
      const matched = logs.find((l) => regex.test(l.text));
      if (matched) {
        return {
          satisfied: true,
          snapshot: {
            matching_line: matched.text,
            seq: matched.seq,
          },
        };
      }
      return { satisfied: false, snapshot: null };
    }

    case "crash_detected": {
      if (context.bsConsole.hasCrash()) {
        return {
          satisfied: true,
          snapshot: {
            crash: context.bsConsole.getLastCrash(),
          },
        };
      }
      return { satisfied: false, snapshot: null };
    }
  }
}

export async function handleWaitForCondition(
  input: WaitForConditionInput,
  context: WaitForConditionContext
): Promise<WaitForConditionResult> {
  const startTime = Date.now();
  const parsed = parseConditionExpression(input.condition);
  const timeoutMs = (input.timeout_seconds ?? 10) * 1000;
  const pollIntervalMs = input.poll_interval_ms ?? 500;

  let polls = 0;

  while (Date.now() - startTime < timeoutMs) {
    polls++;
    const check = await evaluateCondition(parsed, context);
    if (check.satisfied) {
      return {
        satisfied: true,
        condition: input.condition,
        elapsed_ms: Date.now() - startTime,
        polls,
        timeout: false,
        snapshot: check.snapshot,
      };
    }

    const remaining = timeoutMs - (Date.now() - startTime);
    if (remaining <= 0) break;

    const sleepTime = Math.min(pollIntervalMs, remaining);
    await new Promise((resolve) => setTimeout(resolve, sleepTime));
  }

  // Final check at deadline
  polls++;
  const finalCheck = await evaluateCondition(parsed, context);
  if (finalCheck.satisfied) {
    return {
      satisfied: true,
      condition: input.condition,
      elapsed_ms: Date.now() - startTime,
      polls,
      timeout: false,
      snapshot: finalCheck.snapshot,
    };
  }

  return {
    satisfied: false,
    condition: input.condition,
    elapsed_ms: Date.now() - startTime,
    polls,
    timeout: true,
    snapshot: null,
  };
}
