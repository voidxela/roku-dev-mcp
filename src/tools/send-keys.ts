import { EcpAdapter } from "../adapters/ecp.js";
import { SendKeysInput, SendKeysResult } from "../types/tools.js";

export interface SendKeysContext {
  ecp: EcpAdapter;
}

export async function handleSendKeys(
  input: SendKeysInput,
  context: SendKeysContext
): Promise<SendKeysResult> {
  return context.ecp.sendKeys(input.keys, input.delay_ms);
}
