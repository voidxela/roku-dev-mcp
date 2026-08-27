import { EcpAdapter } from "../adapters/ecp.js";
import { LaunchInput, LaunchResult } from "../types/tools.js";

export interface LaunchContext {
  ecp: EcpAdapter;
}

export async function handleLaunch(
  input: LaunchInput,
  context: LaunchContext
): Promise<LaunchResult> {
  return context.ecp.launch("dev", {
    contentId: input.content_id,
    mediaType: input.media_type,
    params: input.params,
  });
}
