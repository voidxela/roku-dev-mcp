import { describe, it, expect } from "vitest";
import {
  parseActiveAppXml,
  parseAppsXml,
  parseDeviceInfoXml,
  parseMediaPlayerXml,
  computePlaybackAssertResult,
} from "../../../src/parsers/ecp-xml-parser.js";

describe("ecp-xml-parser", () => {
  it("parses active-app XML", () => {
    const xml = `<active-app><app id="dev" version="1.8.0">Jellyfin</app></active-app>`;
    const result = parseActiveAppXml(xml);
    expect(result.id).toBe("dev");
    expect(result.name).toBe("Jellyfin");
    expect(result.version).toBe("1.8.0");
  });

  it("parses active-app XML when on Roku home", () => {
    const xml = `<active-app><app>Roku</app></active-app>`;
    const result = parseActiveAppXml(xml);
    expect(result.id).toBe("");
    expect(result.name).toBe("Roku");
  });

  it("parses installed apps XML", () => {
    const xml = `
<apps>
  <app id="dev" type="appl" version="1.0.0">MyApp</app>
  <app id="12" type="appl" version="2.5.0">Netflix</app>
</apps>
`;
    const result = parseAppsXml(xml);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: "dev",
      name: "MyApp",
      type: "appl",
      version: "1.0.0",
    });
    expect(result[1]).toEqual({
      id: "12",
      name: "Netflix",
      type: "appl",
      version: "2.5.0",
    });
  });

  it("parses device-info XML", () => {
    const xml = `
<device-info>
  <model-name>Roku Ultra</model-name>
  <model-number>4800X</model-number>
  <software-version>14.0.0</software-version>
  <serial-number>X00000ABCD</serial-number>
</device-info>
`;
    const result = parseDeviceInfoXml(xml);
    expect(result.model_name).toBe("Roku Ultra");
    expect(result.model_number).toBe("4800X");
    expect(result.software_version).toBe("14.0.0");
    expect(result.serial_number).toBe("X00000ABCD");
  });

  it("parses media-player XML and computes playback assertions", () => {
    const xml = `
<player error="false" state="play">
  <plugin id="dev" name="MyApp" bandwidth="4000000 bps"/>
  <format audio="aac_adts" video="mpeg4_15" captions="none" drm="none"/>
  <buffering target="0" current="1000" max="1000"/>
  <new_stream speed="128"/>
  <position>12345 ms</position>
  <duration>887999 ms</duration>
  <is_live>false</is_live>
  <runtime>887999 ms</runtime>
  <stream_segment media_sequence="0" time="0" bitrate="4000000" width="1920" height="1080"/>
</player>
`;
    const info = parseMediaPlayerXml(xml);
    expect(info.state).toBe("play");
    expect(info.error).toBe(false);
    expect(info.plugin?.name).toBe("MyApp");
    expect(info.position_ms).toBe(12345);
    expect(info.duration_ms).toBe(887999);
    expect(info.buffering?.current).toBe(1000);
    expect(info.format?.audio).toBe("aac_adts");
    expect(info.stream_segment?.width).toBe(1920);

    const assertion = computePlaybackAssertResult(info);
    expect(assertion.is_playing).toBe(true);
    expect(assertion.is_buffering).toBe(false);
    expect(assertion.is_paused).toBe(false);
    expect(assertion.is_stopped).toBe(false);
    expect(assertion.progress_percent).toBe(1.39);
  });
});
