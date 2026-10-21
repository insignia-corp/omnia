import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../infra/database/database.module";
import { perguntaDono } from "../../infra/database/schema";
import type { ContextoSessao, Ferramenta } from "../ferramentas/ferramenta";
import type { ConfirmacoesConfig, PropostaConfirmacao } from "../ferramentas/registro-ferramentas";

/** O que fica em `pergunta_dono.contexto` de uma ação à espera do "sim". Só dados escolhidos em código. */
export const acaoPendenteSchema = z.object({
  ferramenta: z.string().min(1),
  entrada: z.unknown(),
  resumo: z.string().min(1),
  expira_em: z.iso.datetime(),
});
export type AcaoPendente = z.infer<typeof acaoPendenteSchema>;

export type Relogio = () => Date;

/**
 * Confirmação de escritas do agente (issue #104, regra inviolável 7). O modelo nunca executa uma
 * escrita: o pedido vira uma `pergunta_dono` `confirmar_acao` pendente e a execução fica com o
 * código, quando o dono responde "sim" (ver `ConfirmacaoDoDono`). Por isso `consumir` sempre recusa.
 *
 * Só uma proposta fica pendente por comerciante: a nova cancela a anterior, para um "sim" nunca
 * ser ambíguo. Pedir a mesma coisa de novo reaproveita a proposta aberta e ainda válida.
 */
export class ConfirmacoesPostgres implements ConfirmacoesConfig {
  constructor(
    private readonly db: Db,
    private readonly validadeMinutos: number,
    private readonly agora: Relogio = () => new Date(),
  ) {}

  consumir(): Promise<boolean> {
    return Promise.resolve(false);
  }

  async propor(
    contexto: ContextoSessao,
    ferramenta: Ferramenta,
    entrada: unknown,
  ): Promise<PropostaConfirmacao | null> {
    if (!ferramenta.descreverConfirmacao) return null;
    const descricao = await ferramenta.descreverConfirmacao(contexto, entrada as never);
    const { comercianteId } = contexto;
    const agora = this.agora();
    const expiraEm = new Date(agora.getTime() + this.validadeMinutos * 60_000).toISOString();

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`confirmar_acao:${comercianteId}`}))`);
      const abertas = await tx
        .select()
        .from(perguntaDono)
        .where(
          and(
            eq(perguntaDono.comercianteId, comercianteId),
            eq(perguntaDono.tipo, "confirmar_acao"),
            eq(perguntaDono.status, "pendente"),
          ),
        );
      for (const a of abertas) {
        const dados = acaoPendenteSchema.safeParse(a.contexto);
        const igual =
          dados.success &&
          dados.data.ferramenta === ferramenta.nome &&
          JSON.stringify(dados.data.entrada) === JSON.stringify(entrada) &&
          new Date(dados.data.expira_em) > agora;
        if (igual) return { perguntaId: a.id, pergunta: a.pergunta };
      }
      if (abertas.length > 0) {
        await tx
          .update(perguntaDono)
          .set({ status: "cancelada" })
          .where(
            and(
              eq(perguntaDono.comercianteId, comercianteId),
              eq(perguntaDono.tipo, "confirmar_acao"),
              eq(perguntaDono.status, "pendente"),
            ),
          );
      }
      const contextoPendente: AcaoPendente = {
        ferramenta: ferramenta.nome,
        entrada,
        resumo: descricao.resumo,
        expira_em: expiraEm,
      };
      const [criada] = await tx
        .insert(perguntaDono)
        .values({
          comercianteId,
          tipo: "confirmar_acao",
          pergunta: descricao.pergunta,
          contexto: contextoPendente,
        })
        .returning({ id: perguntaDono.id });
      return { perguntaId: criada!.id, pergunta: descricao.pergunta };
    });
  }
}
