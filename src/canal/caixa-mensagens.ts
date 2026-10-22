import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { DB, type Db } from "../infra/database/database.module";
import { mensagem } from "../infra/database/schema";
import { categoriaDoCanal } from "./categoria-canal";
import { MESSAGE_CHANNEL, type MessageChannel } from "./message-channel";
import { dataLocal, RELOGIO, type Relogio } from "./relogio";
import {
  conteudoDaSaida,
  textoDaSaida,
  type SaidaWhatsapp,
  type StatusMensagem,
  type TipoMensagem,
} from "./whatsapp/formato";
import { corpoDoModelo } from "./whatsapp/modelos";
import { LIMITES_META } from "./whatsapp/regras-meta";

export interface MensagemGravada {
  id: string;
  direcao: "enviada" | "recebida";
  texto: string;
  proativa: boolean;
  criadaEm: Date;
  idExterno: string | null;
  tipo: TipoMensagem;
  conteudo: Record<string, unknown> | null;
  contextoId: string | null;
  status: StatusMensagem | null;
}

/** O que sai: texto puro ou uma mensagem no formato da Cloud API (botões, lista, link, modelo). */
export type ConteudoEnvio = { texto: string } | { saida: SaidaWhatsapp };

/** Status anteriores a cada um: o status só avança (`failed` vale sempre). */
const ANTERIORES: Record<StatusMensagem, StatusMensagem[]> = {
  sent: [],
  delivered: ["sent"],
  read: ["sent", "delivered"],
  failed: ["sent", "delivered", "read"],
};

const saidaDe = (c: ConteudoEnvio): SaidaWhatsapp =>
  "saida" in c ? c.saida : { type: "text", text: { body: c.texto } };

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

  /**
   * Mensagem do dono. `nova` é falso quando o mesmo id do canal já tinha entrado (reentrega). Gravar é
   * o "entregue" da Cloud API: a linha nasce com status `delivered`.
   */
  async registrarRecebida(p: {
    comercianteId: string;
    idExterno: string;
    texto: string;
    tipo?: TipoMensagem;
    conteudo?: Record<string, unknown> | null;
    contextoId?: string | null;
  }): Promise<{ id: string; nova: boolean }> {
    const canal = this.canalGravado();
    const [criada] = await this.db
      .insert(mensagem)
      .values({
        comercianteId: p.comercianteId,
        direcao: "recebida",
        canal,
        texto: p.texto,
        tipo: p.tipo ?? "text",
        conteudo: p.conteudo ?? null,
        contextoId: p.contextoId ?? null,
        status: "delivered",
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
  async enviarResposta(
    p: ConteudoEnvio & {
      comercianteId: string;
      execucaoId: string | null;
      chave: string;
      contextoId?: string | null;
    },
  ): Promise<{ id: string; nova: boolean }> {
    return this.gravarEEnviar({ ...p, saida: saidaDe(p), proativa: false, dataEnvio: this.hoje() });
  }

  /** Avança o status de uma mensagem do comerciante (nunca volta: `read` não vira `delivered`). */
  async marcarStatus(comercianteId: string, id: string, status: StatusMensagem): Promise<void> {
    await this.db
      .update(mensagem)
      .set({ status })
      .where(
        and(
          eq(mensagem.id, id),
          eq(mensagem.comercianteId, comercianteId),
          or(isNull(mensagem.status), inArray(mensagem.status, ANTERIORES[status])),
        ),
      );
  }

  /** Janela de atendimento da Cloud API: o dono escreveu nas últimas 24 horas (relógio do banco). */
  async janelaAberta(comercianteId: string): Promise<boolean> {
    const [linha] = await this.db
      .select({ id: mensagem.id })
      .from(mensagem)
      .where(
        and(
          eq(mensagem.comercianteId, comercianteId),
          eq(mensagem.direcao, "recebida"),
          gt(mensagem.criadoEm, sql`now() - make_interval(hours => ${LIMITES_META.janelaAtendimentoHoras})`),
        ),
      )
      .limit(1);
    return linha !== undefined;
  }

  /** Mensagens gravadas para estas chaves, na ordem das chaves (as que não existem ficam de fora). */
  async buscarPorChaves(comercianteId: string, chaves: string[]): Promise<MensagemGravada[]> {
    if (chaves.length === 0) return [];
    const linhas = await this.db
      .select()
      .from(mensagem)
      .where(and(eq(mensagem.comercianteId, comercianteId), inArray(mensagem.chaveIdempotencia, chaves)));
    const ordem = (l: (typeof linhas)[number]) => chaves.indexOf(l.chaveIdempotencia ?? "");
    return linhas.sort((a, b) => ordem(a) - ordem(b)).map((l) => this.paraGravada(l));
  }

  /** Mensagem do dono pelo id que o canal deu a ela. */
  async buscarRecebida(comercianteId: string, idExterno: string): Promise<MensagemGravada | undefined> {
    const [linha] = await this.db
      .select()
      .from(mensagem)
      .where(
        and(
          eq(mensagem.comercianteId, comercianteId),
          eq(mensagem.canal, this.canalGravado()),
          eq(mensagem.idExterno, idExterno),
          eq(mensagem.direcao, "recebida"),
        ),
      )
      .limit(1);
    return linha && this.paraGravada(linha);
  }

  /**
   * Mensagem iniciada pelo sistema. Vale no máximo uma por comerciante e dia, qualquer que seja a
   * chave: quem chegar depois (outro job, o alerta de reajuste) recebe `duplicada`.
   */
  async enviarProativa(
    p: ConteudoEnvio & {
      comercianteId: string;
      execucaoId: string | null;
      dataEnvio: string;
      chave: string;
    },
  ): Promise<"enviada" | "duplicada"> {
    const r = await this.gravarEEnviar({ ...p, saida: saidaDe(p), proativa: true });
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
    saida: SaidaWhatsapp;
    execucaoId: string | null;
    chave: string;
    contextoId?: string | null;
    proativa: boolean;
    dataEnvio: string;
  }): Promise<{ id: string; nova: boolean }> {
    const [criada] = await this.db
      .insert(mensagem)
      .values({
        comercianteId: p.comercianteId,
        direcao: "enviada",
        canal: this.canalGravado(),
        texto: textoDaSaida(p.saida, corpoDoModelo),
        tipo: p.saida.type,
        conteudo: conteudoDaSaida(p.saida),
        contextoId: p.contextoId ?? null,
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
    let envio: Awaited<ReturnType<MessageChannel["enviarTexto"]>>;
    try {
      envio = await this.transportar(p.comercianteId, p.saida);
    } catch (e) {
      await this.marcarStatus(p.comercianteId, criada.id, "failed");
      throw e;
    }
    await this.db
      .update(mensagem)
      .set({
        status: "sent",
        idExterno: envio.idExterno,
        custoEstimadoMicrodolares: envio.custoEstimadoMicrodolares,
        categoriaTemplate: categoriaDoCanal(envio.categoria),
      })
      .where(and(eq(mensagem.id, criada.id), eq(mensagem.comercianteId, p.comercianteId)));
    return { id: criada.id, nova: true };
  }

  private transportar(destinatario: string, s: SaidaWhatsapp) {
    if (s.type === "text") return this.canal.enviarTexto(destinatario, s.text.body);
    if (s.type === "interactive") return this.canal.enviarInterativo(destinatario, { ...s.interactive });
    const corpo = s.template.components.find((c) => c.type === "body");
    return this.canal.enviarTemplate(destinatario, {
      nome: s.template.name,
      idioma: s.template.language.code,
      variaveis: corpo?.type === "body" ? corpo.parameters.map((v) => v.text) : [],
    });
  }

  private canalGravado(): "web" | "whatsapp" {
    return this.canal.nome === "whatsapp" ? "whatsapp" : "web";
  }

  private hoje(): string {
    return dataLocal(this.relogio.agora(), this.env.FUSO_HORARIO);
  }

  private paraGravada(l: typeof mensagem.$inferSelect): MensagemGravada {
    return {
      id: l.id,
      direcao: l.direcao,
      texto: l.texto,
      proativa: l.proativa,
      criadaEm: l.criadoEm,
      idExterno: l.idExterno,
      tipo: l.tipo,
      conteudo: l.conteudo ?? null,
      contextoId: l.contextoId,
      status: l.status,
    };
  }
}
