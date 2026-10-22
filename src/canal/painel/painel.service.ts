import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { MotorDeAlertas } from "../../alertas/motor-de-alertas";
import type { TipoAlerta } from "../../alertas/tipos";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { DB, type Db } from "../../infra/database/database.module";
import { comerciante, produto } from "../../infra/database/schema";
import { somarDias } from "../../lib/datas/datas";
import { MetricasService } from "../../metricas/metricas.service";
import { dataLocal, RELOGIO, type Relogio } from "../relogio";

export const ROTULO_ALERTA: Record<TipoAlerta, string> = {
  reajuste_de_custo: "Reajuste de custo",
  margem_abaixo_da_meta: "Margem abaixo da meta",
  espaco_para_subir_preco: "Espaço para subir preço",
  giro_em_alta: "Giro em alta",
  estoque_parado: "Estoque parado",
  ticket_medio_em_queda: "Ticket médio em queda",
  gasto_fora_do_padrao: "Gasto fora do padrão",
};

/**
 * Números do painel do dono (issue #182), destino do botão "Abrir painel". Tudo sai das mesmas
 * funções determinísticas que as ferramentas do agente usam (regra inviolável 1), para o dia anterior
 * (o último dia fechado), a semana e o mês até ele; os avisos são os candidatos do motor de hoje. Dado
 * ausente vai como veio, para a página dizer "sem dado" em vez de zero.
 */
@Injectable()
export class PainelService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    private readonly metricas: MetricasService,
    private readonly motor: MotorDeAlertas,
  ) {}

  async montar(comercianteId: string) {
    const [dono] = await this.db
      .select({ nome: comerciante.nome })
      .from(comerciante)
      .where(eq(comerciante.id, comercianteId))
      .limit(1);
    if (!dono) throw new NotFoundException("Comerciante não encontrado");

    const hoje = dataLocal(this.relogio.agora(), this.env.FUSO_HORARIO);
    const ontem = somarDias(hoje, -1);
    const contexto = { comercianteId, dataReferencia: ontem };
    const [dia, semana, mes, margens, alertas] = await Promise.all([
      this.metricas.resumoDiario(contexto, ontem),
      this.metricas.resumoDePeriodo(contexto, "semana", ontem),
      this.metricas.resumoDePeriodo(contexto, "mes", ontem),
      this.metricas.margensAbaixoDaMeta(contexto),
      this.motor.executar({ comercianteId, dataReferencia: hoje }),
    ]);

    // Cada margem leva a menor confiança e a origem dos dados (regra 4): custo lido de foto duvidosa
    // aparece marcado na página, não como número definitivo.
    const abaixoDaMeta = margens.map(({ valor: m, menor_confianca, origens }) => ({
      produto: m.nome,
      margem_bps: m.margem_bps,
      meta_bps: m.meta_bps,
      preco_medio_venda_centavos: m.preco_medio_venda_centavos,
      custo_compra_mais_recente_centavos: m.custo_compra_mais_recente_centavos,
      menor_confianca,
      origens,
    }));

    const idsProdutos = [...new Set(alertas.candidatos.flatMap((c) => (c.produtoId ? [c.produtoId] : [])))];
    const nomes = new Map(
      idsProdutos.length === 0
        ? []
        : (
            await this.db
              .select({ id: produto.id, nome: produto.nome })
              .from(produto)
              .where(and(eq(produto.comercianteId, comercianteId), inArray(produto.id, idsProdutos)))
          ).map((p) => [p.id, p.nome]),
    );

    return {
      comercio: dono.nome,
      data_referencia: hoje,
      /** Abaixo disto a página marca o dado como incerto (o mesmo limite de item de nota). */
      limite_confianca: this.env.LIMITE_CONFIANCA_ITEM,
      ate: ontem,
      dia,
      semana,
      mes,
      margens_abaixo_da_meta: abaixoDaMeta,
      avisos: alertas.candidatos.map((c) => ({
        tipo: c.tipo,
        rotulo: ROTULO_ALERTA[c.tipo],
        prioridade: c.prioridade,
        produto: c.produtoId ? (nomes.get(c.produtoId) ?? null) : null,
      })),
    };
  }
}
