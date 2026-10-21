import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { DB, type Db } from "../infra/database/database.module";
import { mensagem } from "../infra/database/schema";
import { categoriaDoCanal } from "./categoria-canal";
import { MESSAGE_CHANNEL, type MessageChannel } from "./message-channel";
import { dataLocal, RELOGIO, type Relogio } from "./relogio";

export interface MensagemGravada {
  id: string;
  direcao: "enviada" | "recebida";
  texto: string;
  proativa: boolean;
  criadaEm: Date;
}

/**
 * Único dono das escritas em `mensagem`. Grava a linha antes de mandar ao canal: as restrições do
 * banco (chave de idempotência, uma proativa por dia, id externo) decidem quem envia, então duas
 * execuções iguais ao mesmo tempo mandam uma só mensagem (regra inviolável 9). O canal só transporta.
 */
@Injectable()
export class CaixaMensagens {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(MESSAGE_CHANNEL) private readonly canal: MessageChannel,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /** Mensagem do dono. `nova` é falso quando o mesmo id do canal já tinha entrado (reentrega). */
  async registrarRecebida(p: {
    comercianteId: string;
    idExterno: string;
    texto: string;
  }): Promise<{ id: string; nova: boolean }> {
    const canal = this.canalGravado();
    const [criada] = await this.db
      .insert(mensagem)
      .values({
        comercianteId: p.comercianteId,
        direcao: "recebida",
        canal,
        texto: p.texto,
        dataEnvio: this.hoje(),
        idExterno: p.idExterno,
      })
      .onConflictDoNothing()
      .returning({ id: mensagem.id });
    if (criada) return { id: criada.id, nova: true };
    const [existente] = await this.db
      .select({ id: mensagem.id })
      .from(mensagem)
      .where(
        and(
          eq(mensagem.comercianteId, p.comercianteId),
          eq(mensagem.canal, canal),
          eq(mensagem.idExterno, p.idExterno),
        ),
      )
      .limit(1);
    return { id: existente!.id, nova: false };
  }

  /** Resposta à mensagem do dono, idempotente pela `chave`. */
  async enviarResposta(p: {
    comercianteId: string;
    texto: string;
    execucaoId: string | null;
    chave: string;
  }): Promise<{ id: string; nova: boolean }> {
    return this.gravarEEnviar({ ...p, proativa: false, dataEnvio: this.hoje() });
  }

  /**
   * Mensagem iniciada pelo sistema. Vale no máximo uma por comerciante e dia, qualquer que seja a
   * chave: quem chegar depois (outro job, o alerta de reajuste) recebe `duplicada`.
   */
  async enviarProativa(p: {
    comercianteId: string;
    texto: string;
    execucaoId: string | null;
    dataEnvio: string;
    chave: string;
  }): Promise<"enviada" | "duplicada"> {
    const r = await this.gravarEEnviar({ ...p, proativa: true });
    return r.nova ? "enviada" : "duplicada";
  }

  async jaTemProativa(comercianteId: string, dataEnvio: string): Promise<boolean> {
    const [linha] = await this.db
      .select({ id: mensagem.id })
      .from(mensagem)
      .where(
        and(
          eq(mensagem.comercianteId, comercianteId),
          eq(mensagem.dataEnvio, dataEnvio),
          eq(mensagem.proativa, true),
          eq(mensagem.direcao, "enviada"),
        ),
      )
      .limit(1);
    return linha !== undefined;
  }

  /** Resposta já gravada para a chave, se houver. */
  async buscarPorChave(comercianteId: string, chave: string): Promise<MensagemGravada | undefined> {
    const [linha] = await this.db
      .select()
      .from(mensagem)
      .where(and(eq(mensagem.comercianteId, comercianteId), eq(mensagem.chaveIdempotencia, chave)))
      .limit(1);
    return linha && this.paraGravada(linha);
  }

  /** As últimas mensagens do comerciante, da mais antiga para a mais nova. */
  async listar(comercianteId: string, limite: number): Promise<MensagemGravada[]> {
    const linhas = await this.db
      .select()
      .from(mensagem)
      .where(eq(mensagem.comercianteId, comercianteId))
      .orderBy(desc(mensagem.criadoEm), desc(mensagem.id))
      .limit(limite);
    return linhas.reverse().map((l) => this.paraGravada(l));
  }

  private async gravarEEnviar(p: {
    comercianteId: string;
    texto: string;
    execucaoId: string | null;
    chave: string;
    proativa: boolean;
    dataEnvio: string;
  }): Promise<{ id: string; nova: boolean }> {
    const [criada] = await this.db
      .insert(mensagem)
      .values({
        comercianteId: p.comercianteId,
        direcao: "enviada",
        canal: this.canalGravado(),
        texto: p.texto,
        proativa: p.proativa,
        dataEnvio: p.dataEnvio,
        chaveIdempotencia: p.chave,
        execucaoId: p.execucaoId,
      })
      .onConflictDoNothing()
      .returning({ id: mensagem.id });
    if (!criada) {
      const existente = await this.buscarPorChave(p.comercianteId, p.chave);
      return { id: existente?.id ?? "", nova: false };
    }
    const envio = await this.canal.enviarTexto(p.comercianteId, p.texto);
    await this.db
      .update(mensagem)
      .set({
        idExterno: envio.idExterno,
        custoEstimadoMicrodolares: envio.custoEstimadoMicrodolares,
        categoriaTemplate: categoriaDoCanal(envio.categoria),
      })
      .where(and(eq(mensagem.id, criada.id), eq(mensagem.comercianteId, p.comercianteId)));
    return { id: criada.id, nova: true };
  }

  private canalGravado(): "web" | "whatsapp" {
    return this.canal.nome === "whatsapp" ? "whatsapp" : "web";
  }

  private hoje(): string {
    return dataLocal(this.relogio.agora(), this.env.FUSO_HORARIO);
  }

  private paraGravada(l: typeof mensagem.$inferSelect): MensagemGravada {
    return { id: l.id, direcao: l.direcao, texto: l.texto, proativa: l.proativa, criadaEm: l.criadoEm };
  }
}
