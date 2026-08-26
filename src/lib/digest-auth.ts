import crypto from "crypto";
import { createRokuError, ErrorCode } from "../types/errors.js";

export interface DigestChallenge {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
  algorithm?: string;
  domain?: string;
}

export function parseDigestChallenge(header: string): DigestChallenge {
  const challengeMatch = header.match(/^Digest\s+(.+)$/i);
  if (!challengeMatch) {
    throw createRokuError(
      ErrorCode.PARSE_ERROR,
      `Invalid WWW-Authenticate header: ${header}`
    );
  }

  const rawParams = challengeMatch[1];
  const params: Record<string, string> = {};

  const regex = /(\w+)=(?:"([^"]*)"|([^\s,]+))/g;
  let match;
  while ((match = regex.exec(rawParams)) !== null) {
    const key = match[1];
    const value = match[2] !== undefined ? match[2] : match[3];
    params[key] = value;
  }

  if (!params.realm || !params.nonce) {
    throw createRokuError(
      ErrorCode.PARSE_ERROR,
      `Missing required realm or nonce in challenge: ${header}`
    );
  }

  return {
    realm: params.realm,
    nonce: params.nonce,
    qop: params.qop,
    opaque: params.opaque,
    algorithm: params.algorithm,
    domain: params.domain,
  };
}

function md5(data: string): string {
  return crypto.createHash("md5").update(data).digest("hex");
}

export interface DigestAuthOptions {
  username: string;
  password?: string;
  method: string;
  uri: string;
  challenge: DigestChallenge;
  nc?: number;
  cnonce?: string;
}

export function createDigestAuthHeader(options: DigestAuthOptions): string {
  const {
    username,
    password = "",
    method,
    uri,
    challenge,
    nc = 1,
    cnonce = crypto.randomBytes(8).toString("hex"),
  } = options;

  const ncString = nc.toString(16).padStart(8, "0");
  const ha1 = md5(`${username}:${challenge.realm}:${password}`);
  const ha2 = md5(`${method.toUpperCase()}:${uri}`);

  let response: string;
  if (challenge.qop) {
    const qop = challenge.qop.split(",")[0].trim();
    response = md5(`${ha1}:${challenge.nonce}:${ncString}:${cnonce}:${qop}:${ha2}`);
  } else {
    response = md5(`${ha1}:${challenge.nonce}:${ha2}`);
  }

  const parts: string[] = [
    `username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];

  if (challenge.qop) {
    const qop = challenge.qop.split(",")[0].trim();
    parts.push(`qop=${qop}`);
    parts.push(`nc=${ncString}`);
    parts.push(`cnonce="${cnonce}"`);
  }

  if (challenge.opaque) {
    parts.push(`opaque="${challenge.opaque}"`);
  }

  if (challenge.algorithm) {
    parts.push(`algorithm=${challenge.algorithm}`);
  }

  return `Digest ${parts.join(", ")}`;
}

export interface DigestFetchOptions extends Omit<RequestInit, "headers"> {
  username: string;
  password?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export async function digestFetch(
  url: string,
  options: DigestFetchOptions
): Promise<Response> {
  const parsedUrl = new URL(url);
  const uri = parsedUrl.pathname + parsedUrl.search;
  const method = options.method || "GET";
  const timeoutMs = options.timeoutMs ?? 15000;

  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // 1. Initial request without auth
    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: options.headers,
      });
    } catch (err: unknown) {
      if ((err as { name?: string }).name === "AbortError") {
        throw createRokuError(
          ErrorCode.TIMEOUT,
          `Request to ${url} timed out after ${timeoutMs}ms`
        );
      }
      throw createRokuError(
        ErrorCode.DEVICE_UNREACHABLE,
        `Cannot connect to ${parsedUrl.host}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (response.status !== 401) {
      return response;
    }

    const authHeader = response.headers.get("www-authenticate");
    if (!authHeader) {
      throw createRokuError(
        ErrorCode.AUTH_FAILED,
        "Received 401 Unauthorized but no WWW-Authenticate header found",
        { http_status: 401, port: 80 }
      );
    }

    const challenge = parseDigestChallenge(authHeader);
    const digestAuth = createDigestAuthHeader({
      username: options.username,
      password: options.password,
      method,
      uri,
      challenge,
    });

    const headers = {
      ...(options.headers || {}),
      Authorization: digestAuth,
    };

    let authedResponse: Response;
    try {
      authedResponse = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers,
      });
    } catch (err: unknown) {
      if ((err as { name?: string }).name === "AbortError") {
        throw createRokuError(
          ErrorCode.TIMEOUT,
          `Authenticated request to ${url} timed out after ${timeoutMs}ms`
        );
      }
      throw createRokuError(
        ErrorCode.DEVICE_UNREACHABLE,
        `Cannot connect to ${parsedUrl.host}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (authedResponse.status === 401) {
      throw createRokuError(
        ErrorCode.AUTH_FAILED,
        "Digest authentication failed for port 80",
        { http_status: 401, port: 80 }
      );
    }

    return authedResponse;
  } finally {
    clearTimeout(timeoutTimer);
  }
}
