import { XMLParser } from "fast-xml-parser";
import {
  ActiveApp,
  DeviceInfo,
  InstalledApp,
  MediaPlayerInfo,
} from "../types/roku.js";
import { AssertPlaybackResult } from "../types/tools.js";
import { createRokuError, ErrorCode } from "../types/errors.js";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseAttributeValue: true,
});

export function parseActiveAppXml(xmlText: string): ActiveApp {
  try {
    const parsed = xmlParser.parse(xmlText);
    const app = parsed?.["active-app"]?.app;

    if (!app) {
      return { id: "", name: "Unknown" };
    }

    const id = app["@_id"] !== undefined ? String(app["@_id"]) : "";
    const version =
      app["@_version"] !== undefined ? String(app["@_version"]) : undefined;
    const name =
      typeof app === "string"
        ? app
        : app["#text"]
        ? String(app["#text"])
        : id || "Unknown";

    return {
      id,
      name,
      ...(version ? { version } : {}),
    };
  } catch (err) {
    throw createRokuError(
      ErrorCode.PARSE_ERROR,
      `Failed to parse active-app XML: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export function parseAppsXml(xmlText: string): InstalledApp[] {
  try {
    const parsed = xmlParser.parse(xmlText);
    const rawApps = parsed?.apps?.app;

    if (!rawApps) {
      return [];
    }

    const appsArray = Array.isArray(rawApps) ? rawApps : [rawApps];

    return appsArray.map((app) => ({
      id: String(app["@_id"] ?? ""),
      name:
        typeof app === "string"
          ? app
          : app["#text"]
          ? String(app["#text"])
          : String(app["@_id"] ?? "Unknown"),
      type: app["@_type"] !== undefined ? String(app["@_type"]) : undefined,
      version:
        app["@_version"] !== undefined ? String(app["@_version"]) : undefined,
    }));
  } catch (err) {
    throw createRokuError(
      ErrorCode.PARSE_ERROR,
      `Failed to parse apps XML: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export function parseDeviceInfoXml(xmlText: string): DeviceInfo {
  try {
    const parsed = xmlParser.parse(xmlText);
    const info = parsed?.["device-info"];

    if (!info || typeof info !== "object") {
      return {};
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(info)) {
      // Normalize hyphenated keys to underscores
      const normalizedKey = key.replace(/-/g, "_");
      result[normalizedKey] = value;
    }

    return result as DeviceInfo;
  } catch (err) {
    throw createRokuError(
      ErrorCode.PARSE_ERROR,
      `Failed to parse device-info XML: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function parseMs(value: unknown): number {
  if (value === undefined || value === null) {
    return 0;
  }
  if (typeof value === "number") {
    return value;
  }
  const str = String(value).trim().replace(/\s*ms$/i, "");
  const num = Number(str);
  return isNaN(num) ? 0 : num;
}

export function parseMediaPlayerXml(xmlText: string): MediaPlayerInfo {
  try {
    const parsed = xmlParser.parse(xmlText);
    const player = parsed?.player;

    if (!player) {
      return {
        state: "none",
        error: false,
        position_ms: 0,
        duration_ms: 0,
        is_live: false,
      };
    }

    const isError =
      player["@_error"] === true || player["@_error"] === "true";
    const state = String(player["@_state"] || "none");

    const position_ms = parseMs(player.position);
    const duration_ms = parseMs(player.duration);
    const is_live =
      player.is_live === true ||
      player.is_live === "true" ||
      player["@_is_live"] === true ||
      player["@_is_live"] === "true";

    const result: MediaPlayerInfo = {
      state,
      error: isError,
      position_ms,
      duration_ms,
      is_live,
    };

    if (player.plugin) {
      result.plugin = {
        id: String(player.plugin["@_id"] || ""),
        name: String(player.plugin["@_name"] || ""),
        bandwidth: player.plugin["@_bandwidth"]
          ? String(player.plugin["@_bandwidth"])
          : undefined,
      };
    }

    if (player.buffering) {
      result.buffering = {
        target: Number(player.buffering["@_target"] ?? 0),
        current: Number(player.buffering["@_current"] ?? 0),
        max: Number(player.buffering["@_max"] ?? 0),
      };
    }

    if (player.format) {
      result.format = {
        audio: player.format["@_audio"]
          ? String(player.format["@_audio"])
          : undefined,
        video: player.format["@_video"]
          ? String(player.format["@_video"])
          : undefined,
        drm: player.format["@_drm"]
          ? String(player.format["@_drm"])
          : undefined,
        captions: player.format["@_captions"]
          ? String(player.format["@_captions"])
          : undefined,
      };
    }

    if (player.stream_segment) {
      result.stream_segment = {
        bitrate: player.stream_segment["@_bitrate"]
          ? Number(player.stream_segment["@_bitrate"])
          : undefined,
        width: player.stream_segment["@_width"]
          ? Number(player.stream_segment["@_width"])
          : undefined,
        height: player.stream_segment["@_height"]
          ? Number(player.stream_segment["@_height"])
          : undefined,
        media_sequence: player.stream_segment["@_media_sequence"]
          ? String(player.stream_segment["@_media_sequence"])
          : undefined,
        time: player.stream_segment["@_time"]
          ? String(player.stream_segment["@_time"])
          : undefined,
      };
    }

    return result;
  } catch (err) {
    throw createRokuError(
      ErrorCode.PARSE_ERROR,
      `Failed to parse media-player XML: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export function computePlaybackAssertResult(
  info: MediaPlayerInfo
): AssertPlaybackResult {
  const is_playing = info.state === "play";
  const is_buffering = info.state === "buffering";
  const is_paused = info.state === "pause";
  const is_stopped =
    info.state === "stop" || info.state === "close" || info.state === "none";

  let progress_percent = 0;
  if (info.duration_ms > 0) {
    progress_percent = Number(
      ((info.position_ms / info.duration_ms) * 100).toFixed(2)
    );
  }

  return {
    ...info,
    is_playing,
    is_buffering,
    is_paused,
    is_stopped,
    progress_percent,
  };
}
