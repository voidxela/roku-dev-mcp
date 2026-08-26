import { z } from "zod";
import { ActiveApp, CrashEvent, LogEntry, MediaPlayerInfo, SGTreeResult } from "./roku.js";

// Tool 1: roku_build_and_deploy
export const BuildAndDeployInputSchema = z.object({
  source_dir: z
    .string()
    .describe(
      "Absolute path to the BrightScript/SceneGraph project root. Must contain a 'manifest' file."
    ),
  action: z
    .enum(["Install", "Replace"])
    .default("Install")
    .describe(
      "Install: replace any existing sideloaded app. Replace: update the current sideloaded app in-place."
    ),
  exclude_patterns: z
    .array(z.string())
    .optional()
    .describe(
      "Additional glob patterns to exclude from the zip (beyond the defaults: .git, node_modules, .env, *.log)."
    ),
});

export type BuildAndDeployInput = z.infer<typeof BuildAndDeployInputSchema>;

export interface BuildAndDeployResult {
  success: boolean;
  message: string;
  install_time_ms: number;
  zip_size_bytes: number;
  startup_log: string[];
  crash_detected: boolean;
}

// Tool 2: roku_send_keys
export const SendKeysInputSchema = z.object({
  keys: z
    .array(z.string())
    .min(1)
    .describe(
      "Ordered list of ECP key names to press sequentially. Supported: Home, Up, Down, Left, Right, Select, Back, Play, Rev, Fwd, InstantReplay, Info, Backspace, Search, Enter, VolumeUp, VolumeDown, VolumeMute, PowerOff, ChannelUp, ChannelDown, InputTuner, InputHDMI1-4, InputAV1, FindRemote, Lit_{char}."
    ),
  delay_ms: z
    .number()
    .int()
    .min(0)
    .max(5000)
    .optional()
    .describe(
      "Delay in milliseconds between each keypress. Default: value of ROKU_KEYPRESS_DELAY_MS env var (100ms). Increase for slow UIs or complex animations."
    ),
});

export type SendKeysInput = z.infer<typeof SendKeysInputSchema>;

export interface SendKeysResult {
  keys_sent: string[];
  total_keys: number;
  delay_ms: number;
  elapsed_ms: number;
  errors: string[];
}

// Tool 3: roku_get_ui_tree
export const GetUiTreeInputSchema = z.object({
  filter_id: z
    .string()
    .optional()
    .describe(
      "If provided, returns only the subtree rooted at the node with this ID. Uses 'sgnodes {id}' instead of 'sgnodes all'."
    ),
  include_fields: z
    .boolean()
    .default(true)
    .describe(
      "Whether to include node field key-value pairs in the output. Set false for a compact tree overview."
    ),
  max_depth: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Maximum tree depth to return. Useful for limiting output size on deeply nested UIs."
    ),
});

export type GetUiTreeInput = z.infer<typeof GetUiTreeInputSchema>;

// Tool 4: roku_capture_state
export const CaptureStateInputSchema = z.object({
  log_lines: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(50)
    .describe(
      "Number of most recent BrightScript console log lines to include from the ring buffer."
    ),
  include_screenshot: z
    .boolean()
    .default(true)
    .describe(
      "Whether to capture and include a base64 screenshot. Set false to reduce response size."
    ),
  include_ui_tree: z
    .boolean()
    .default(false)
    .describe(
      "Whether to also capture the SG node tree (expensive operation). Use roku_get_ui_tree for dedicated tree inspection."
    ),
});

export type CaptureStateInput = z.infer<typeof CaptureStateInputSchema>;

export interface ScreenshotData {
  format: string;
  width: number;
  height: number;
  base64: string;
}

export interface CaptureStateResult {
  captured_at: string;
  active_app: ActiveApp | null;
  log: {
    lines: LogEntry[];
    total_buffered: number;
    buffer_capacity: number;
  };
  screenshot: ScreenshotData | null;
  crash_detected: boolean;
  crash_details: CrashEvent | null;
  ui_tree: SGTreeResult | null;
}

// Tool 5: roku_assert_playback
export const AssertPlaybackInputSchema = z.object({});

export type AssertPlaybackInput = z.infer<typeof AssertPlaybackInputSchema>;

export interface AssertPlaybackResult extends MediaPlayerInfo {
  is_playing: boolean;
  is_buffering: boolean;
  is_paused: boolean;
  is_stopped: boolean;
  progress_percent: number;
}

// Tool 6: roku_wait_for_condition
export const WaitForConditionInputSchema = z.object({
  condition: z
    .string()
    .describe(
      "Condition expression to evaluate. Supported formats:\n" +
        "- 'node_exists: {nodeId}' — polls sgnodes until a node with the given ID appears in the tree.\n" +
        "- 'node_field: {nodeId}.{field}={value}' — polls until a specific node field matches the expected value.\n" +
        "- 'playback_state: {state}' — polls /query/media-player until the player reaches the given state (play, pause, buffering, stop).\n" +
        "- 'app_active: {appId}' — polls /query/active-app until the given app is in the foreground.\n" +
        "- 'log_contains: {pattern}' — scans the log buffer for a line matching the given regex pattern.\n" +
        "- 'crash_detected' — returns immediately if a crash has been captured, or waits until one occurs."
    ),
  timeout_seconds: z
    .number()
    .min(1)
    .max(120)
    .default(10)
    .describe("Maximum seconds to wait before returning a timeout error."),
  poll_interval_ms: z
    .number()
    .int()
    .min(100)
    .max(5000)
    .default(500)
    .describe("Milliseconds between each poll attempt."),
});

export type WaitForConditionInput = z.infer<typeof WaitForConditionInputSchema>;

export interface WaitForConditionResult {
  satisfied: boolean;
  condition: string;
  elapsed_ms: number;
  polls: number;
  timeout: boolean;
  snapshot: unknown | null;
}

// Tool 7: roku_launch
export const LaunchInputSchema = z.object({
  content_id: z
    .string()
    .optional()
    .describe(
      "Content ID for deep linking (passed as contentId query parameter)."
    ),
  media_type: z
    .string()
    .optional()
    .describe(
      "Media type hint for deep linking (passed as mediaType query parameter). Common values: series, movie, episode, short-form."
    ),
  params: z
    .record(z.string())
    .optional()
    .describe(
      "Additional arbitrary query parameters to include in the launch URL."
    ),
});

export type LaunchInput = z.infer<typeof LaunchInputSchema>;

export interface LaunchResult {
  launched: boolean;
  app_id: string;
  content_id?: string;
  media_type?: string;
  active_app_confirmed: boolean;
  elapsed_ms: number;
}
