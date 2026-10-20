import { randomUUID } from "node:crypto";
import type { Db } from "../../infra/database/database.module";
import { chamadaFerramenta, execucaoAgente } from "../../infra/database/schema";

export type Gatilho = "relatorio_diario" | "mensagem_dono" | "nota_processada";
/** O registro também guarda as execuções do Extrator, que não são do Analista. */
export type GatilhoRegistrado = Gatilho | "extracao_nota";
export type ResultadoExecucao = "aprovada" | "fallback_verificador" | "fallback_erro" | "recusa_modelo";

export interface ChamadaRegistrada {
  ordem: number;
  ferramenta: string;
  entrada: unknown;
  saida: unknown;
  erro: string | null;
  menorConfianca: number | null;
  latenciaMs: number;
}

export interface BloqueioVerificador {
  tentativa: number;
  numeros: string[];
}

/** Tudo o que se registra de uma execução (edital 9.4, observabilidade). */
export interface ExecucaoRegistrada {
  comercianteId: string;
  gatilho: GatilhoRegistrado;
  entrada: string;
  modelo: string;
  versaoPrompt: string;
  resultado: ResultadoExecucao;
  mensagemFinal: string;
  iteracoes: number;
  bloqueios: BloqueioVerificador[];
  tokensEntrada: number;
  tokensSaida: number;
  tokensCacheLeitura: number;
  custoEstimadoMicrodolares: number;
  latenciaMs: number;
  erro: string | null;
  chamadas: ChamadaRegistrada[];
}

export interface RegistroExecucoes {
  salvar(execucao: ExecucaoRegistrada): Promise<string>;
}

export const REGISTRO_EXECUCOES = Symbol("REGISTRO_EXECUCOES");

export class RegistroExecucoesPostgres implements RegistroExecucoes {
  constructor(private readonly db: Db) {}

  async salvar(e: ExecucaoRegistrada): Promise<string> {
    return this.db.transaction(async (tx) => {
      const [linha] = await tx
        .insert(execucaoAgente)
        .values({
          comercianteId: e.comercianteId,
          gatilho: e.gatilho,
          entrada: e.entrada,
          modelo: e.modelo,
          versaoPrompt: e.versaoPrompt,
          resultado: e.resultado,
          mensagemFinal: e.mensagemFinal,
          iteracoes: e.iteracoes,
          bloqueiosVerificador: e.bloqueios.length,
          detalhesVerificador: e.bloqueios,
          tokensEntrada: e.tokensEntrada,
          tokensSaida: e.tokensSaida,
          tokensCacheLeitura: e.tokensCacheLeitura,
          custoEstimadoMicrodolares: e.custoEstimadoMicrodolares,
          latenciaMs: e.latenciaMs,
          erro: e.erro,
        })
        .returning({ id: execucaoAgente.id });
      if (!linha) throw new Error("Falha ao registrar execução do agente");
      if (e.chamadas.length > 0) {
        await tx.insert(chamadaFerramenta).values(
          e.chamadas.map((c) => ({
            execucaoId: linha.id,
            comercianteId: e.comercianteId,
            ordem: c.ordem,
            ferramenta: c.ferramenta,
            entrada: c.entrada ?? {},
            saida: c.saida ?? null,
            erro: c.erro,
            menorConfianca: c.menorConfianca,
            latenciaMs: c.latenciaMs,
          })),
        );
      }
      return linha.id;
    });
  }
}

/** Para testes e para o modo sem banco. */
export class RegistroExecucoesMemoria implements RegistroExecucoes {
  readonly execucoes: (ExecucaoRegistrada & { id: string })[] = [];

  salvar(e: ExecucaoRegistrada): Promise<string> {
    const id = randomUUID();
    this.execucoes.push({ ...e, id });
    return Promise.resolve(id);
  }
}
