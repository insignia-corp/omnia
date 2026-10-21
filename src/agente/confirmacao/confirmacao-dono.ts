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
  /** Encerra a proposta pendente quando a conversa seguiu para outro assunto (ela só vale para a resposta imediata). */
  invalidarPendentes(contexto: ContextoSessao): Promise<void>;
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

    // Tudo numa transação: o `for update` segura a proposta, a escrita da ferramenta entra na mesma transação
    // e o status só muda junto com ela. Dois "sim" simultâneos esperam um pelo outro (e o segundo já não
    // encontra proposta pendente); se o processo cair no meio, nada foi gravado e o mesmo "sim" ainda vale.
    return this.db.transaction(async (tx) => {
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
      const marcar = (status: "respondida" | "cancelada" | "expirada", resp: string) =>
        tx
          .update(perguntaDono)
          .set({ status, resposta: resp, respondidaEm: new Date() })
          .where(and(eq(perguntaDono.id, pergunta.id), eq(perguntaDono.comercianteId, comercianteId)));
      const acao = acaoPendenteSchema.safeParse(pergunta.contexto);
      if (!acao.success) {
        await marcar("cancelada", "proposta ilegível");
        return null;
      }
      const chamada = (saida: unknown, erro: string | null): ChamadaRegistrada => ({
        ordem: 1,
        ferramenta: "confirm_pending_action",
        entrada: { pergunta_id: pergunta.id, ferramenta: acao.data.ferramenta, resposta },
        saida,
        erro,
        menorConfianca: null,
        latenciaMs: latencia(),
      });

      if (new Date(acao.data.expira_em) <= this.agora()) {
        await marcar("expirada", resposta);
        return {
          mensagem: FALA_CONFIRMACAO.expirada,
          chamada: chamada({ status: "expirada" }, null),
          sucesso: true,
        };
      }
      if (resposta === "nao") {
        await marcar("cancelada", "nao");
        return {
          mensagem: FALA_CONFIRMACAO.cancelada,
          chamada: chamada({ status: "cancelada" }, null),
          sucesso: true,
        };
      }

      const r = await this.ferramentas.executarConfirmada(
        { ...contexto, executor: tx },
        acao.data.ferramenta,
        acao.data.entrada,
      );
      if (!r.ok) {
        // A escrita da ferramenta foi desfeita (ponto de salvamento); a proposta não volta a valer.
        await marcar("cancelada", `falha: ${r.erro}`.slice(0, 500));
        return { mensagem: FALA_CONFIRMACAO.falha, chamada: chamada(null, r.erro), sucesso: false };
      }
      await marcar("respondida", "sim");
      return {
        mensagem: this.aviso(acao.data.resumo, r.saida, acao.data.entrada, contexto),
        chamada: chamada({ status: "executada", resultado: r.saida }, null),
        sucesso: true,
      };
    });
  }

  async invalidarPendentes(contexto: ContextoSessao): Promise<void> {
    await this.db
      .update(perguntaDono)
      .set({ status: "cancelada", resposta: "superada", respondidaEm: new Date() })
      .where(
        and(
          eq(perguntaDono.comercianteId, contexto.comercianteId),
          eq(perguntaDono.tipo, "confirmar_acao"),
          eq(perguntaDono.status, "pendente"),
        ),
      );
  }

  /**
   * Mesma regra 8 do resto: o aviso só carrega número que a própria execução devolveu ou que o dono viu.
   * O nome do produto (cadastro, pode ter "5kg" ou "Três") fica fora da conferência.
   */
  private aviso(resumo: string, saida: unknown, entrada: unknown, contexto: ContextoSessao): string {
    const nome =
      saida && typeof saida === "object" && "produto_nome" in saida && typeof saida.produto_nome === "string"
        ? saida.produto_nome
        : "";
    const conferido = nome ? resumo.replaceAll(nome, " ") : resumo;
    const fontes = new NumerosAutorizados([saida, entrada, contexto.dataReferencia]);
    return verificarNumeros(conferido, fontes).aprovado ? resumo : FALA_CONFIRMACAO.generica;
  }
}
