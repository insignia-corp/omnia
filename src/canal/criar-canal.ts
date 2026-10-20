import type { Env } from "../config/env";
import type { MessageChannel } from "./message-channel";
import { CanalWeb } from "./web/canal-web";

/** Escolhe a implementação de `MessageChannel` por `CANAL` (issue #106). O agente não sabe qual é. */
export function criarCanal(env: Pick<Env, "CANAL">): MessageChannel {
  switch (env.CANAL) {
    case "web":
      return new CanalWeb();
    case "whatsapp":
      throw new Error("Canal whatsapp ainda não implementado (issues #61 e #62). Use CANAL=web.");
  }
}
