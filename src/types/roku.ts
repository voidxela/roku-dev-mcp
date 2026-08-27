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
  "Pause",
  "Stop",
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
  "Power",
  "PowerOff",
  "PowerOn",
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

export const ECP_KEY_ALIASES: Record<string, string> = {
  // Navigation
  home: "Home",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  select: "Select",
  ok: "Select",
  back: "Back",
  // Playback
  play: "Play",
  pause: "Pause",
  playpause: "Play",
  "play/pause": "Play",
  stop: "Stop",
  rev: "Rev",
  rewind: "Rev",
  fwd: "Fwd",
  fastforward: "Fwd",
  fast_forward: "Fwd",
  ff: "Fwd",
  instantreplay: "InstantReplay",
  instant_replay: "InstantReplay",
  replay: "InstantReplay",
  // Input
  info: "Info",
  options: "Info",
  star: "Info",
  asterisk: "Info",
  "*": "Info",
  backspace: "Backspace",
  delete: "Backspace",
  search: "Search",
  enter: "Enter",
  // Volume (TV only)
  volumeup: "VolumeUp",
  volup: "VolumeUp",
  vol_up: "VolumeUp",
  volume_up: "VolumeUp",
  volumedown: "VolumeDown",
  voldown: "VolumeDown",
  vol_down: "VolumeDown",
  volume_down: "VolumeDown",
  volumemute: "VolumeMute",
  mute: "VolumeMute",
  vol_mute: "VolumeMute",
  volume_mute: "VolumeMute",
  // Power (TV only)
  power: "Power",
  poweroff: "PowerOff",
  power_off: "PowerOff",
  poweron: "PowerOn",
  power_on: "PowerOn",
  // TV Input (TV only)
  channelup: "ChannelUp",
  channel_up: "ChannelUp",
  channeldown: "ChannelDown",
  channel_down: "ChannelDown",
  inputtuner: "InputTuner",
  tuner: "InputTuner",
  inputhdmi1: "InputHDMI1",
  hdmi1: "InputHDMI1",
  inputhdmi2: "InputHDMI2",
  hdmi2: "InputHDMI2",
  inputhdmi3: "InputHDMI3",
  hdmi3: "InputHDMI3",
  inputhdmi4: "InputHDMI4",
  hdmi4: "InputHDMI4",
  inputav1: "InputAV1",
  av1: "InputAV1",
  // Misc
  findremote: "FindRemote",
  find_remote: "FindRemote",
};

export function normalizeECPKey(key: string): string | null {
  if (typeof key !== "string" || !key) {
    return null;
  }
  if (VALID_ECP_KEYS.has(key)) {
    return key;
  }
  const lower = key.toLowerCase();
  if (ECP_KEY_ALIASES[lower]) {
    return ECP_KEY_ALIASES[lower];
  }
  if (lower.startsWith("lit_") && key.length > 4) {
    return "Lit_" + key.slice(4);
  }
  return null;
}

export function isValidECPKey(key: string): boolean {
  return normalizeECPKey(key) !== null;
}

