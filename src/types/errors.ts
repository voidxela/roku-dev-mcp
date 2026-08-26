export enum ErrorCode {
  DEVICE_UNREACHABLE = "DEVICE_UNREACHABLE",
  AUTH_FAILED = "AUTH_FAILED",
  MANIFEST_NOT_FOUND = "MANIFEST_NOT_FOUND",
  INSTALL_FAILED = "INSTALL_FAILED",
  INVALID_KEY = "INVALID_KEY",
  PORT_BUSY = "PORT_BUSY",
  TIMEOUT = "TIMEOUT",
  PARSE_ERROR = "PARSE_ERROR",
  NO_SIDELOADED_APP = "NO_SIDELOADED_APP",
  INVALID_CONDITION = "INVALID_CONDITION",
  CONNECTION_LOST = "CONNECTION_LOST",
}

export interface ErrorDetails {
  [key: string]: unknown;
}

export interface RokuErrorPayload {
  error: ErrorCode;
  message: string;
  recovery_hint?: string;
  details?: ErrorDetails;
}

export class RokuDevError extends Error {
  public readonly code: ErrorCode;
  public readonly recoveryHint?: string;
  public readonly details?: ErrorDetails;

  constructor(
    code: ErrorCode,
    message: string,
    recoveryHint?: string,
    details?: ErrorDetails
  ) {
    super(message);
    this.name = "RokuDevError";
    this.code = code;
    this.recoveryHint = recoveryHint;
    this.details = details;
  }

  public toJSON(): RokuErrorPayload {
    return {
      error: this.code,
      message: this.message,
      ...(this.recoveryHint ? { recovery_hint: this.recoveryHint } : {}),
      ...(this.details ? { details: this.details } : {}),
    };
  }

  public toMcpResult() {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(this.toJSON(), null, 2),
        },
      ],
      isError: true,
    };
  }
}

export const RECOVERY_HINTS: Record<ErrorCode, string> = {
  [ErrorCode.DEVICE_UNREACHABLE]:
    "Verify the Roku device IP is correct, powered on, and reachable on the local network without firewall blocks on ports 80, 8060, 8080, 8085.",
  [ErrorCode.AUTH_FAILED]:
    "Verify that the ROKU_DEV_PASSWORD environment variable matches the password set on the Roku device during Developer Mode activation.",
  [ErrorCode.MANIFEST_NOT_FOUND]:
    "Ensure that the source directory contains a valid 'manifest' file at its root level.",
  [ErrorCode.INSTALL_FAILED]:
    "Check the BrightScript compiler error or manifest requirements. Ensure all required files and assets are present.",
  [ErrorCode.INVALID_KEY]:
    "Use a supported ECP key name: Home, Up, Down, Left, Right, Select, Back, Play, Rev, Fwd, InstantReplay, Info, Backspace, Search, Enter, VolumeUp, VolumeDown, VolumeMute, PowerOff, ChannelUp, ChannelDown, InputTuner, InputHDMI1-4, InputAV1, FindRemote, Lit_{char}.",
  [ErrorCode.PORT_BUSY]:
    "Wait for the concurrent operation on port 8080 to finish, or increase the command timeout.",
  [ErrorCode.TIMEOUT]:
    "Increase the timeout parameter or check whether the device or app is currently unresponsive.",
  [ErrorCode.PARSE_ERROR]:
    "Verify the response format from the Roku device. Ensure the channel is behaving properly.",
  [ErrorCode.NO_SIDELOADED_APP]:
    "Deploy a sideloaded application first using roku_build_and_deploy before running operations requiring the dev channel.",
  [ErrorCode.INVALID_CONDITION]:
    "Check condition syntax: 'node_exists: {id}', 'node_field: {id}.{field}={value}', 'playback_state: {state}', 'app_active: {appId}', 'log_contains: {regex}', or 'crash_detected'.",
  [ErrorCode.CONNECTION_LOST]:
    "The Telnet connection to port 8085 was lost. Ensure the device did not reboot or close the debug session.",
};

export function createRokuError(
  code: ErrorCode,
  message: string,
  details?: ErrorDetails,
  customHint?: string
): RokuDevError {
  const hint = customHint || RECOVERY_HINTS[code];
  return new RokuDevError(code, message, hint, details);
}
