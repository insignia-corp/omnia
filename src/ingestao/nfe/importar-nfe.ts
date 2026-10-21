import type { Db } from "../../infra/database/database.module";
import { gravarCompra, type CompraGravada } from "../gravar-compra";
import { validarNota } from "../validacao/validar-nota";
import type { LeituraNfe } from "./ler-nfe";

export interface EntradaImportacaoNfe {
  comercianteId: string;
  documentoId: string;
  leitura: Extract<LeituraNfe, { ok: true }>;
  /** Data de hoje (AAAA-MM-DD), para a conferência de data. */
  hoje: string;
  limiteConfiancaItem: number;
  limiteSimilaridade: number;
}

/**
 * Grava a compra de uma NF-e já lida. Passa pelas mesmas conferências em código da foto (soma,
 * quantidade x unitário, CNPJ e data) e pelo mesmo gravador, então vínculo, perguntas ao dono e
 * histórico de custo seguem o caminho de sempre, só com origem `nfe`. Não há chamada de modelo.
 */
export async function importarNfe(db: Db, e: EntradaImportacaoNfe): Promise<CompraGravada> {
  const validada = validarNota(e.leitura.extracao, {
    hoje: e.hoje,
    limiteConfiancaItem: e.limiteConfiancaItem,
    itensConferidosNaOrigem: e.leitura.itensConferidos,
  });
  return gravarCompra(db, {
    comercianteId: e.comercianteId,
    documentoId: e.documentoId,
    extracaoOriginal: e.leitura.extracao,
    validada,
    origem: "nfe",
    numeroDocumento: e.leitura.numeroDocumento,
    limiteConfiancaItem: e.limiteConfiancaItem,
    limiteSimilaridade: e.limiteSimilaridade,
  });
}
