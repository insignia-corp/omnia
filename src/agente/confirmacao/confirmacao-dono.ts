import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../infra/database/database.module";
import { perguntaDono } from "../../infra/database/schema";
import { NumerosAutorizados, verificarNumeros } from "../../lib/verificador-numeros/verificador-numeros";
import type { ChamadaRegistrada } from "../execucao/registro-execucoes";
import type { ContextoSessao } from "../ferramentas/ferramenta";
import type { RegistroFerramentas } from "../ferramentas/registro-ferramentas";
import { acaoPendenteSchema, type Relogio } from "./confirmacoes-postgres";
import { interpretarResposta } from "./interpretar-resposta";

export interface ResultadoConfirmacao {
  /** Mensagem pronta para o canal, montada em código. */
  mensagem: string;
  /** A resolução aparece na execução como chamada de `confirm_pending_action`, feita pelo código. */
  chamada: ChamadaRegistrada;
  /** Falso quando a escrita falhou: a execução é registrada como erro. */
  sucesso: boolean;
}

/** Porta usada pelo `AgenteService`; permite dublê nos testes do loop. */
export interface ResolveConfirmacao {
  tratar(contexto: ContextoSessao, texto: string): Promise<ResultadoConfirmacao | null>;
}

export const FALA_CONFIRMACAO = {
  cancelada: "Tudo bem, não registrei nada.",
  expirada: "Essa proposta expirou e não registrei nada. Se ainda quiser, me peça de novo.",
  falha: "Não consegui registrar agora e não alterei nada. Pode pedir de novo?",
  generica: "Pronto, registrei.",
} as const;

/**
 * Resolve o "sim" do dono em código, sem modelo (issue #104, decisão 0003). Se há uma ação à espera e a
 * mensagem inteira é uma confirmação explícita, executa a escrita uma única vez; um "não" cancela.
 * Qualquer outra mensagem não mexe em nada e segue para o agente.
 */
export class ConfirmacaoDoDono implements ResolveConfirmacao {
  constructor(
    private readonly db: Db,
    private readonly ferramentas: RegistroFerramentas,
    private readonly agora: Relogio = () => new Date(),
  ) {}

  async tratar(contexto: ContextoSessao, texto: string): Promise<ResultadoConfirmacao | null> {
    const resposta = interpretarResposta(texto);
    if (resposta === "outra") return null;
    const inicio = performance.now();
    const latencia = () => Math.round(performance.now() - inicio);
    const { comercianteId } = contexto;

    // A reivindicação é atômica: o `for update` e a troca de status valem para um "sim" só, mesmo com
    // duas mensagens ao mesmo tempo. A escrita roda depois, fora desta transação.
    const decisao = await this.db.transaction(async (tx) => {
      const [pergunta] = await tx
        .select()
        .from(perguntaDono)
        .where(
          and(
            eq(perguntaDono.comercianteId, comercianteId),
            eq(perguntaDono.tipo, "confirmar_acao"),
            eq(perguntaDono.status, "pendente"),
          ),
        )
        .orderBy(desc(perguntaDono.criadoEm))
        .for("update")
        .limit(1);
      if (!pergunta) return null;
      const acao = acaoPendenteSchema.safeParse(pergunta.contexto);
      const quando = new Date();
      const marcar = (status: "respondida" | "cancelada" | "expirada", resp: string) =>
        tx
          .update(perguntaDono)
          .set({ status, resposta: resp, respondidaEm: quando })
          .where(and(eq(perguntaDono.id, pergunta.id), eq(perguntaDono.comercianteId, comercianteId)));
      if (!acao.success) {
        await marcar("cancelada", "proposta ilegível");
        return null;
      }
      if (new Date(acao.data.expira_em) <= this.agora()) {
        await marcar("expirada", resposta);
        return { tipo: "expirada" as const, perguntaId: pergunta.id, acao: acao.data };
      }
      if (resposta === "nao") {
        await marcar("cancelada", "nao");
        return { tipo: "cancelada" as const, perguntaId: pergunta.id, acao: acao.data };
      }
      await marcar("respondida", "sim");
      return { tipo: "confirmada" as const, perguntaId: pergunta.id, acao: acao.data };
    });
    if (!decisao) return null;

    const chamada = (saida: unknown, erro: string | null): ChamadaRegistrada => ({
      ordem: 1,
      ferramenta: "confirm_pending_action",
      entrada: { pergunta_id: decisao.perguntaId, ferramenta: decisao.acao.ferramenta, resposta },
      saida,
      erro,
      menorConfianca: null,
      latenciaMs: latencia(),
    });

    if (decisao.tipo === "expirada") {
      return {
        mensagem: FALA_CONFIRMACAO.expirada,
        chamada: chamada({ status: "expirada" }, null),
        sucesso: true,
      };
    }
    if (decisao.tipo === "cancelada") {
      return {
        mensagem: FALA_CONFIRMACAO.cancelada,
        chamada: chamada({ status: "cancelada" }, null),
        sucesso: true,
      };
    }

    const r = await this.ferramentas.executarConfirmada(
      contexto,
      decisao.acao.ferramenta,
      decisao.acao.entrada,
    );
    if (!r.ok) {
      // Uma vez reivindicada, a proposta não volta a ficar pendente: no máximo o dono pede de novo.
      await this.db
        .update(perguntaDono)
        .set({ status: "cancelada", resposta: `falha: ${r.erro}`.slice(0, 500) })
        .where(and(eq(perguntaDono.id, decisao.perguntaId), eq(perguntaDono.comercianteId, comercianteId)));
      return { mensagem: FALA_CONFIRMACAO.falha, chamada: chamada(null, r.erro), sucesso: false };
    }
    // Mesma regra 8 do resto: o aviso só carrega número que a própria execução devolveu ou que o dono viu.
    const fontes = new NumerosAutorizados([r.saida, decisao.acao.entrada, contexto.dataReferencia]);
    const mensagem = verificarNumeros(decisao.acao.resumo, fontes).aprovado
      ? decisao.acao.resumo
      : FALA_CONFIRMACAO.generica;
    return { mensagem, chamada: chamada({ status: "executada", resultado: r.saida }, null), sucesso: true };
  }
}
