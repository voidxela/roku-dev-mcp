import { EcpAdapter } from "../adapters/ecp.js";
import { computePlaybackAssertResult } from "../parsers/ecp-xml-parser.js";
import { AssertPlaybackResult } from "../types/tools.js";

export interface AssertPlaybackContext {
  ecp: EcpAdapter;
}

export async function handleAssertPlayback(
  context: AssertPlaybackContext
): Promise<AssertPlaybackResult> {
  const info = await context.ecp.getMediaPlayer();
  return computePlaybackAssertResult(info);
}
