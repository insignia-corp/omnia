import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Amostra } from "./estatisticas";

/** Só o que o custo lê da saída bruta do `npm run eval` (`evidencias/*-eval-real-*.json`). */
const rodadaAgenteSchema = z.object({
  iniciadaEm: z.string(),
  modo: z.enum(["falso", "real"]),
  modelo: z.string(),
  versaoPrompt: z.string(),
  resultados: z.array(
    z.object({
      id: z.string(),
      gatilho: z.enum(["relatorio_diario", "mensagem_dono", "nota_processada"]),
      resultadoAgente: z.string(),
      custoEstimadoMicrodolares: z.number(),
      latenciaMs: z.number(),
      modelo: z.string(),
    }),
  ),
});

/** Saída bruta do `npm run eval:extracao` (`evidencias/*-eval-extracao-real-*.json`). */
const rodadaExtracaoSchema = z.object({
  iniciadaEm: z.string(),
  modo: z.enum(["falso", "real"]),
  modelo: z.string(),
  versaoPrompt: z.string(),
  resultados: z.array(
    z.object({
      id: z.string(),
      falha: z.object({ tipo: z.string() }).nullable(),
      custoEstimadoMicrodolares: z.number().nullable(),
      latenciaMs: z.number(),
      modelo: z.string(),
    }),
  ),
});

export type RodadaAgenteBruta = z.infer<typeof rodadaAgenteSchema>;
export type RodadaExtracaoBruta = z.infer<typeof rodadaExtracaoSchema>;

export class ErroDeCusto extends Error {}

function lerJson(caminho: string): unknown {
  try {
    return JSON.parse(readFileSync(caminho, "utf8"));
  } catch (e) {
    throw new ErroDeCusto(`Não consegui ler ${caminho}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function exigirReal(rotulo: string, modo: string, caminho: string): void {
  // Custo e latência do modelo falso (roteirizado, sem rede) não dizem nada sobre o modelo real.
  if (modo !== "real") {
    throw new ErroDeCusto(
      `${rotulo} ${caminho} é de modo "${modo}". Use a saída de uma rodada com --modelo real.`,
    );
  }
}

export function lerRodadaAgente(caminho: string): RodadaAgenteBruta {
  const r = rodadaAgenteSchema.safeParse(lerJson(caminho));
  if (!r.success) {
    throw new ErroDeCusto(
      `${caminho} não é a saída bruta do npm run eval (falta gatilho, custo ou latência por caso): ${r.error.issues[0]?.message ?? ""}`,
    );
  }
  exigirReal("A rodada do agente", r.data.modo, caminho);
  return r.data;
}

export function lerRodadaExtracao(caminho: string): RodadaExtracaoBruta {
  const r = rodadaExtracaoSchema.safeParse(lerJson(caminho));
  if (!r.success) {
    throw new ErroDeCusto(
      `${caminho} não é a saída bruta do npm run eval:extracao: ${r.error.issues[0]?.message ?? ""}`,
    );
  }
  exigirReal("A rodada de extração", r.data.modo, caminho);
  return r.data;
}

/** Casos que o agente chegou a executar; "sem_execucao" é erro do harness antes de chamar o modelo. */
export function amostrasDoAgente(rodada: RodadaAgenteBruta): Amostra[] {
  return rodada.resultados
    .filter((r) => r.resultadoAgente !== "sem_execucao")
    .map((r) => ({
      // A nota processada é uma execução do Analista como a pergunta; o eval hoje não tem caso desse gatilho.
      gatilho: r.gatilho === "relatorio_diario" ? "relatorio_diario" : "mensagem_dono",
      custoMicrodolares: r.custoEstimadoMicrodolares,
      latenciaMs: r.latenciaMs,
      modelo: r.modelo,
      aprovada: r.resultadoAgente === "aprovada",
    }));
}

/** Notas que o Extrator devolveu; falha não tem custo nem tempo representativos de uma extração. */
export function amostrasDaExtracao(rodada: RodadaExtracaoBruta): Amostra[] {
  return rodada.resultados
    .filter((r) => r.falha === null)
    .map((r) => ({
      gatilho: "extracao_nota" as const,
      custoMicrodolares: r.custoEstimadoMicrodolares,
      latenciaMs: r.latenciaMs,
      modelo: r.modelo,
      aprovada: true,
    }));
}
