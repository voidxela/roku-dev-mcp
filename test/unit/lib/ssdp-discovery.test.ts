import { describe, it, expect } from "vitest";
import { parseSsdpResponse } from "../../../src/lib/ssdp-discovery.js";

describe("ssdp-discovery", () => {
  it("parses valid SSDP M-SEARCH response from Roku", () => {
    const raw = [
      "HTTP/1.1 200 OK",
      "Cache-Control: max-age=3600",
      "ST: roku:ecp",
      "USN: uuid:roku:ecp:1234567890",
      "LOCATION: http://192.168.1.100:8060/",
      "SERVER: Roku/14.0.0 UPnP/1.0 Roku/14.0.0",
    ].join("\r\n");

    const result = parseSsdpResponse(raw);
    expect(result).not.toBeNull();
    expect(result?.ip).toBe("192.168.1.100");
    expect(result?.location).toBe("http://192.168.1.100:8060/");
    expect(result?.usn).toBe("uuid:roku:ecp:1234567890");
    expect(result?.server).toContain("Roku");
  });

  it("returns null for non-roku or missing location responses", () => {
    const rawNoLocation = [
      "HTTP/1.1 200 OK",
      "ST: roku:ecp",
    ].join("\r\n");
    expect(parseSsdpResponse(rawNoLocation)).toBeNull();

    const rawOtherDevice = [
      "HTTP/1.1 200 OK",
      "ST: upnp:rootdevice",
      "LOCATION: http://192.168.1.200:5000/",
    ].join("\r\n");
    expect(parseSsdpResponse(rawOtherDevice)).toBeNull();
  });
});
