import dgram from "dgram";
import { createRokuError, ErrorCode } from "../types/errors.js";

const SSDP_ADDRESS = "239.255.255.250";
const SSDP_PORT = 1900;
const SSDP_SEARCH_TARGET = "roku:ecp";

export interface DiscoveredRoku {
  ip: string;
  location: string;
  server?: string;
  usn?: string;
}

export function parseSsdpResponse(msg: string): DiscoveredRoku | null {
  const headers: Record<string, string> = {};
  const lines = msg.split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      headers[match[1].toUpperCase()] = match[2].trim();
    }
  }

  const location = headers["LOCATION"];
  const st = headers["ST"];

  if (!location) {
    return null;
  }

  if (st && !st.includes(SSDP_SEARCH_TARGET) && !st.includes("roku")) {
    return null;
  }

  try {
    const url = new URL(location);
    return {
      ip: url.hostname,
      location,
      server: headers["SERVER"],
      usn: headers["USN"],
    };
  } catch {
    return null;
  }
}

export async function discoverRokuDevices(
  timeoutMs: number = 5000
): Promise<DiscoveredRoku[]> {
  return new Promise<DiscoveredRoku[]>((resolve) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const discovered = new Map<string, DiscoveredRoku>();

    const searchMessage = Buffer.from(
      [
        "M-SEARCH * HTTP/1.1",
        `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
        'MAN: "ssdp:discover"',
        `ST: ${SSDP_SEARCH_TARGET}`,
        "MX: 3",
        "\r\n",
      ].join("\r\n")
    );

    const cleanup = () => {
      try {
        socket.close();
      } catch {
        // Ignore close errors
      }
      resolve(Array.from(discovered.values()));
    };

    const timer = setTimeout(cleanup, timeoutMs);

    socket.on("message", (msg) => {
      const response = parseSsdpResponse(msg.toString("utf-8"));
      if (response && !discovered.has(response.ip)) {
        discovered.set(response.ip, response);
      }
    });

    socket.on("error", () => {
      // Return whatever we have so far
      clearTimeout(timer);
      cleanup();
    });

    socket.bind(0, () => {
      try {
        socket.send(
          searchMessage,
          0,
          searchMessage.length,
          SSDP_PORT,
          SSDP_ADDRESS
        );
      } catch {
        clearTimeout(timer);
        cleanup();
      }
    });
  });
}

export async function discoverFirstRokuDevice(
  timeoutMs: number = 5000
): Promise<string> {
  const devices = await discoverRokuDevices(timeoutMs);
  if (devices.length === 0) {
    throw createRokuError(
      ErrorCode.DEVICE_UNREACHABLE,
      `No Roku devices found via SSDP discovery within ${timeoutMs}ms.`
    );
  }

  if (devices.length > 1) {
    console.warn(
      `[WARN] Multiple Roku devices discovered (${devices.map((d) => d.ip).join(", ")}). Using first responder: ${devices[0].ip}`
    );
  }

  return devices[0].ip;
}
