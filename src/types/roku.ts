export interface LogEntry {
  seq: number;
  timestamp: string;
  text: string;
}

export interface BacktraceFrame {
  frame: number;
  function: string;
  file: string;
  line: number;
}

export interface CrashEvent {
  detected_at: string;
  trigger_line: string;
  context_lines: string[];
  backtrace: BacktraceFrame[];
}

export interface SGNode {
  type: string;
  id: string;
  subtype?: string;
  osref?: number;
  bscref?: number;
  fields?: Record<string, string>;
  children: SGNode[];
}

export interface SGTreeResult {
  total_nodes: number;
  captured_at: string;
  tree: SGNode[];
}

export interface ActiveApp {
  id: string;
  name: string;
  version?: string;
}

export interface InstalledApp {
  id: string;
  name: string;
  type?: string;
  version?: string;
}

export interface DeviceInfo {
  model_name?: string;
  model_number?: string;
  software_version?: string;
  serial_number?: string;
  user_device_name?: string;
  vendor_name?: string;
  [key: string]: unknown;
}

export type PlayerState = "play" | "pause" | "buffering" | "stop" | "close" | "none";

export interface MediaPlayerInfo {
  state: PlayerState | string;
  error: boolean;
  plugin?: {
    id: string;
    name: string;
    bandwidth?: string;
  };
  position_ms: number;
  duration_ms: number;
  is_live: boolean;
  buffering?: {
    target: number;
    current: number;
    max: number;
  };
  format?: {
    audio?: string;
    video?: string;
    drm?: string;
    captions?: string;
  };
  stream_segment?: {
    bitrate?: number;
    width?: number;
    height?: number;
    media_sequence?: string;
    time?: string;
  };
}

export const VALID_ECP_KEYS = new Set<string>([
  // Navigation
  "Home",
  "Up",
  "Down",
  "Left",
  "Right",
  "Select",
  "Back",
  // Playback
  "Play",
  "Rev",
  "Fwd",
  "InstantReplay",
  // Input
  "Info",
  "Backspace",
  "Search",
  "Enter",
  // Volume (TV only)
  "VolumeUp",
  "VolumeDown",
  "VolumeMute",
  // Power (TV only)
  "PowerOff",
  // TV Input (TV only)
  "ChannelUp",
  "ChannelDown",
  "InputTuner",
  "InputHDMI1",
  "InputHDMI2",
  "InputHDMI3",
  "InputHDMI4",
  "InputAV1",
  // Misc
  "FindRemote",
]);

export function isValidECPKey(key: string): boolean {
  if (VALID_ECP_KEYS.has(key)) {
    return true;
  }
  // Check Lit_{char} pattern
  if (key.startsWith("Lit_") && key.length > 4) {
    return true;
  }
  return false;
}
