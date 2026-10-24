/**
 * Verificação de reajuste logo após uma nota ser processada (issue #45). Pega os produtos dos itens
 * da nota e roda no motor só a regra de reajuste, restrita a eles. O comerciante é sempre o do job,
 * que vem da extração do documento, nunca de texto da nota (regras invioláveis 3 e 6). Só grava
 * candidato: o envio fica no relatório diário (regra inviolável 9).
 */
import { and, eq, isNotNull } from "drizzle-orm";
import type { Executor } from "../../infra/database/database.module";
import { compra, itemDeCompra } from "../../infra/database/schema";
import type { MotorDeAlertas } from "../motor-de-alertas";

export interface JobReajuste {
  documentoId: string;
  comercianteId: string;
}

export interface ResultadoVerificacao {
  /** Produtos da nota que entraram na checagem. */
  produtos: number;
  /** Candidatos de reajuste gravados nesta execução (zero numa repetição). */
  gravados: number;
}

export class VerificadorDeReajuste {
  constructor(
    private readonly db: Executor,
    private readonly motor: MotorDeAlertas,
    /** Dia dos avisos (AAAA-MM-DD; o módulo passa ontem): o reajuste só vale para compra recente em relação a ele. */
    private readonly hoje: () => string,
  ) {}

  async verificar(job: JobReajuste, dataReferencia: string = this.hoje()): Promise<ResultadoVerificacao> {
    const { documentoId, comercianteId } = job;
    const linhas = await this.db
      .selectDistinct({ produtoId: itemDeCompra.produtoId })
      .from(itemDeCompra)
      .innerJoin(compra, and(eq(compra.id, itemDeCompra.compraId), eq(compra.comercianteId, comercianteId)))
      .where(
        and(
          eq(compra.documentoId, documentoId),
          eq(itemDeCompra.comercianteId, comercianteId),
          isNotNull(itemDeCompra.produtoId),
        ),
      );
    const produtoIds = new Set(linhas.flatMap((l) => (l.produtoId ? [l.produtoId] : [])));
    if (produtoIds.size === 0) return { produtos: 0, gravados: 0 };

    const resultado = await this.motor.executar(
      { comercianteId, dataReferencia },
      { tipos: ["reajuste_de_custo"], produtoIds, semRepetirGravados: true },
    );
    return { produtos: produtoIds.size, gravados: resultado.gravados };
  }
}
