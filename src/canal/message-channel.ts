/**
 * Interface de canal (issue #106). O agente e as ferramentas falam só com isto; chat web e
 * WhatsApp Cloud API são implementações trocadas por `CANAL` no .env.
 */

export interface MensagemRecebida {
  /** Identificador do remetente no canal (número do WhatsApp, sessão do chat web). */
  remetente: string;
  /** Id da mensagem no canal, usado como chave de idempotência. */
  idExterno: string;
  texto?: string;
  midia?: { tipo: "imagem" | "audio" | "documento"; url: string; mimeType: string };
  recebidaEm: Date;
}

export interface EnvioTemplate {
  nome: string;
  idioma: string;
  variaveis: string[];
}

export interface ResultadoEnvio {
  idExterno: string;
  /** Categoria cobrada pelo canal (WhatsApp: utility, marketing, service). */
  categoria: string | null;
  custoEstimadoMicrodolares: number;
}

export interface MessageChannel {
  readonly nome: "web" | "whatsapp" | "memoria";
  /** Texto livre. No WhatsApp só vale dentro da janela de 24 horas. */
  enviarTexto(destinatario: string, texto: string): Promise<ResultadoEnvio>;
  /** Template aprovado, para mensagens fora da janela de atendimento. */
  enviarTemplate(destinatario: string, template: EnvioTemplate): Promise<ResultadoEnvio>;
  /**
   * Mensagem interativa (botões, lista ou botão de link) no formato da Cloud API, já conferida pelas
   * regras da Meta (`whatsapp/regras-meta.ts`). Só vale dentro da janela de 24 horas, como o texto.
   */
  enviarInterativo(destinatario: string, interativo: Record<string, unknown>): Promise<ResultadoEnvio>;
  aoReceber(tratador: (mensagem: MensagemRecebida) => Promise<void>): void;
}

export const MESSAGE_CHANNEL = Symbol("MESSAGE_CHANNEL");

/** Canal em memória para testes e avaliação. */
export class CanalMemoria implements MessageChannel {
  readonly nome = "memoria" as const;
  readonly enviadas: {
    destinatario: string;
    texto?: string;
    template?: EnvioTemplate;
    interativo?: Record<string, unknown>;
  }[] = [];
  private tratador: ((m: MensagemRecebida) => Promise<void>) | undefined;
  private contador = 0;

  enviarTexto(destinatario: string, texto: string): Promise<ResultadoEnvio> {
    this.enviadas.push({ destinatario, texto });
    return Promise.resolve(this.resultado());
  }

  enviarTemplate(destinatario: string, template: EnvioTemplate): Promise<ResultadoEnvio> {
    this.enviadas.push({ destinatario, template });
    return Promise.resolve(this.resultado());
  }

  enviarInterativo(destinatario: string, interativo: Record<string, unknown>): Promise<ResultadoEnvio> {
    this.enviadas.push({ destinatario, interativo });
    return Promise.resolve(this.resultado());
  }

  aoReceber(tratador: (mensagem: MensagemRecebida) => Promise<void>): void {
    this.tratador = tratador;
  }

  /** Simula uma mensagem chegando do dono. */
  async simularRecebida(mensagem: Omit<MensagemRecebida, "idExterno" | "recebidaEm">): Promise<void> {
    if (!this.tratador) throw new Error("Nenhum tratador registrado no canal");
    await this.tratador({ ...mensagem, idExterno: `mem-${++this.contador}`, recebidaEm: new Date() });
  }

  private resultado(): ResultadoEnvio {
    return { idExterno: `mem-envio-${++this.contador}`, categoria: null, custoEstimadoMicrodolares: 0 };
  }
}
