import type { Config } from "../config.js";
import { MockLlm } from "./mock.js";
import { OpenRouterClient } from "./openrouter.js";
import type { Llm } from "./types.js";

export * from "./types.js";
export { MockLlm, OpenRouterClient };

export function createLlm(config: Config): Llm {
  return config.MOCK ? new MockLlm() : new OpenRouterClient(config);
}
