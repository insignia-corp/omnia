import { randomUUID } from "node:crypto";
import type { EnvioTemplate, MessageChannel, ResultadoEnvio } from "../message-channel";

/**
 * Canal do chat web. Entregar é gravar a linha em `mensagem` (feito pela `CaixaMensagens`) e o
 * navegador lê dali, então enviar só devolve um id. A entrada chega por HTTP (`ChatWebController`),
 * por isso `aoReceber` não guarda tratador.
 */
export class CanalWeb implements MessageChannel {
  readonly nome = "web" as const;

  enviarTexto(): Promise<ResultadoEnvio> {
    return Promise.resolve(this.resultado());
  }

  enviarTemplate(_destinatario: string, _template: EnvioTemplate): Promise<ResultadoEnvio> {
    return Promise.resolve(this.resultado());
  }

  enviarInterativo(_destinatario: string, _interativo: Record<string, unknown>): Promise<ResultadoEnvio> {
    return Promise.resolve(this.resultado());
  }

  aoReceber(): void {
    // Nada a registrar: o chat web recebe pelo controller.
  }

  private resultado(): ResultadoEnvio {
    return { idExterno: `web-${randomUUID()}`, categoria: null, custoEstimadoMicrodolares: 0 };
  }
}
