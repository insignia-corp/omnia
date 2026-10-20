import { and, eq } from "drizzle-orm";
import type { RegistroExecucoes, ResultadoExecucao } from "../agente/execucao/registro-execucoes";
import { custoMicrodolares } from "../agente/llm/modelo-linguagem";
import type { Db } from "../infra/database/database.module";
import { documento } from "../infra/database/schema";
import type { Armazenamento } from "../infra/armazenamento/armazenamento";
import type { ExtratorNotas, ResultadoExtracao } from "./extracao/extrator-notas";
import type { TipoImagem } from "./extracao/cliente-visao";
import { gravarCompra } from "./gravar-compra";
import { validarNota } from "./validacao/validar-nota";

export interface DependenciasProcessador {
  db: Db;
  armazenamento: Armazenamento;
  extrator: ExtratorNotas;
  registro: RegistroExecucoes;
  limiteConfiancaItem: number;
  /** Modelo configurado, para registrar a execução mesmo quando a chamada nem chegou a responder. */
  modeloConfigurado: string;
  /** Data de hoje (AAAA-MM-DD). Injetável para os testes. */
  hoje?: () => string;
}

export interface ResultadoProcessamento {
  status: "extraido" | "revisao" | "falha" | "ignorado";
  compraId?: string;
  itensEmRevisao?: Array<{ id: string; ordem: number }>;
}

const IMAGEM_POR_EXTENSAO: Record<string, TipoImagem> = { jpg: "image/jpeg", png: "image/png" };

/**
 * Passo a passo do job `extrair-nota` (guia, "Ingestão e extração de notas"): lê o arquivo, chama o
 * Extrator, confere em código, grava com confiança e registra a execução (tokens, custo, latência).
 *
 * Nenhuma falha deixa o documento sem estado: erro não transitório vira `falha`; erro transitório
 * sobe para o BullMQ repetir e só vira `falha` na última tentativa.
 */
export class ProcessadorExtracao {
  constructor(private readonly dep: DependenciasProcessador) {}

  async processar(
    entrada: { documentoId: string; comercianteId: string },
    ultimaTentativa: boolean,
  ): Promise<ResultadoProcessamento> {
    const { db } = this.dep;
    const { documentoId, comercianteId } = entrada;
    const dono = and(eq(documento.id, documentoId), eq(documento.comercianteId, comercianteId));

    const [doc] = await db.select().from(documento).where(dono).limit(1);
    // Job repetido para documento já resolvido: não refaz nem cobra outra chamada ao modelo.
    if (!doc || !(doc.statusExtracao === "pendente" || doc.statusExtracao === "processando")) {
      return { status: "ignorado" };
    }
    await db.update(documento).set({ statusExtracao: "processando" }).where(dono);

    const mediaType = IMAGEM_POR_EXTENSAO[doc.arquivoCaminho.split(".").pop() ?? ""];
    if (!mediaType) {
      return this.falhar(entrada, "erro_api", "Tipo de arquivo sem leitura por imagem", null);
    }

    let resultado: ResultadoExtracao;
    try {
      const conteudo = await this.dep.armazenamento.ler(doc.arquivoCaminho);
      resultado = await this.dep.extrator.extrair({ mediaType, base64: conteudo.toString("base64") });
    } catch (e) {
      if (!ultimaTentativa) throw e;
      return this.falhar(entrada, "erro_api", e instanceof Error ? e.message : String(e), null);
    }

    if (!resultado.ok) return this.falhar(entrada, resultado.erro, resultado.mensagem, resultado);

    const validada = validarNota(resultado.extracao, {
      hoje: this.dep.hoje?.() ?? new Date().toISOString().slice(0, 10),
      limiteConfiancaItem: this.dep.limiteConfiancaItem,
    });
    const gravada = await gravarCompra(db, {
      comercianteId,
      documentoId,
      extracaoOriginal: resultado.extracao,
      validada,
      limiteConfiancaItem: this.dep.limiteConfiancaItem,
    });
    await this.registrar(
      entrada,
      resultado,
      "aprovada",
      `Extraídos ${validada.extracao.itens.length} itens`,
      null,
    );
    return { status: gravada.status, compraId: gravada.compraId, itensEmRevisao: gravada.itensEmRevisao };
  }

  private async falhar(
    { documentoId, comercianteId }: { documentoId: string; comercianteId: string },
    tipo: string,
    mensagem: string,
    resultado: ResultadoExtracao | null,
  ): Promise<ResultadoProcessamento> {
    await this.dep.db
      .update(documento)
      .set({ statusExtracao: "falha", erro: `${tipo}: ${mensagem}`, processadoEm: new Date() })
      .where(and(eq(documento.id, documentoId), eq(documento.comercianteId, comercianteId)));
    const resultadoExecucao: ResultadoExecucao = tipo === "recusa" ? "recusa_modelo" : "fallback_erro";
    await this.registrar(
      { documentoId, comercianteId },
      resultado,
      resultadoExecucao,
      "Extração falhou",
      mensagem,
    );
    return { status: "falha" };
  }

  private async registrar(
    { documentoId, comercianteId }: { documentoId: string; comercianteId: string },
    r: ResultadoExtracao | null,
    resultado: ResultadoExecucao,
    mensagemFinal: string,
    erro: string | null,
  ): Promise<void> {
    const modelo = r?.modelo || this.dep.modeloConfigurado;
    const consumo = r?.consumo ?? { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 };
    await this.dep.registro.salvar({
      comercianteId,
      gatilho: "extracao_nota",
      entrada: `documento:${documentoId}`,
      modelo,
      versaoPrompt: r?.versaoPrompt ?? "extrator",
      resultado,
      mensagemFinal,
      iteracoes: r?.tentativas ?? 0,
      bloqueios: [],
      tokensEntrada: consumo.entrada,
      tokensSaida: consumo.saida,
      tokensCacheLeitura: consumo.cacheLeitura,
      custoEstimadoMicrodolares: custoMicrodolares(modelo, consumo),
      latenciaMs: r?.latenciaMs ?? 0,
      erro,
      chamadas: [],
    });
  }
}
