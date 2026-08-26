import { describe, it, expect } from "vitest";
import {
  parseDigestChallenge,
  createDigestAuthHeader,
} from "../../../src/lib/digest-auth.js";

describe("digest-auth", () => {
  it("parses WWW-Authenticate challenge header", () => {
    const header =
      'Digest realm="rokudev", nonce="1740614144:b3c7b640", qop="auth", opaque="e8a10f", algorithm=MD5';
    const challenge = parseDigestChallenge(header);

    expect(challenge.realm).toBe("rokudev");
    expect(challenge.nonce).toBe("1740614144:b3c7b640");
    expect(challenge.qop).toBe("auth");
    expect(challenge.opaque).toBe("e8a10f");
    expect(challenge.algorithm).toBe("MD5");
  });

  it("throws on invalid challenge header", () => {
    expect(() => parseDigestChallenge("Basic realm=\"rokudev\"")).toThrow();
    expect(() => parseDigestChallenge("Digest invalid_params")).toThrow();
  });

  it("generates correct digest auth header with qop=auth", () => {
    const challenge = {
      realm: "rokudev",
      nonce: "123456",
      qop: "auth",
      opaque: "abcdef",
    };

    const header = createDigestAuthHeader({
      username: "rokudev",
      password: "secretpassword",
      method: "POST",
      uri: "/plugin_install",
      challenge,
      nc: 1,
      cnonce: "0a4f113b",
    });

    expect(header).toContain('Digest username="rokudev"');
    expect(header).toContain('realm="rokudev"');
    expect(header).toContain('nonce="123456"');
    expect(header).toContain('uri="/plugin_install"');
    expect(header).toContain("qop=auth");
    expect(header).toContain("nc=00000001");
    expect(header).toContain('cnonce="0a4f113b"');
    expect(header).toContain('opaque="abcdef"');
    expect(header).toMatch(/response="[a-f0-9]{32}"/);
  });
});
