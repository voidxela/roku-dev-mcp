import { SgDebugAdapter } from "../adapters/sg-debug.js";
import { SGTreeResult } from "../types/roku.js";
import { GetUiTreeInput } from "../types/tools.js";

export interface GetUiTreeContext {
  sgDebug: SgDebugAdapter;
}

export async function handleGetUiTree(
  input: GetUiTreeInput,
  context: GetUiTreeContext
): Promise<SGTreeResult> {
  return context.sgDebug.getUiTree({
    filterId: input.filter_id,
    includeFields: input.include_fields,
    maxDepth: input.max_depth,
  });
}
