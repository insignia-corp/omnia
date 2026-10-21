export type GatilhoMedido = "relatorio_diario" | "mensagem_dono" | "extracao_nota";

/** Uma execução medida: o que o eval registrou de custo e tempo. */
export interface Amostra {
  gatilho: GatilhoMedido;
  /** `null`: modelo sem preço cadastrado, custo indisponível (nunca zero). */
  custoMicrodolares: number | null;
  latenciaMs: number;
  modelo: string;
}

export interface EstatisticaGatilho {
  gatilho: GatilhoMedido;
  execucoes: number;
  /** Média em micro-dólares inteiros; `null` se alguma execução não tem custo. */
  custoMedioMicrodolares: number | null;
  latenciaP50Ms: number;
  latenciaP95Ms: number;
  latenciaMaximaMs: number;
}

/** Percentil pelo método do posto mais próximo (nearest rank): o valor da amostra, sem interpolar. */
export function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  if (!(p > 0 && p <= 100)) throw new Error(`Percentil fora de (0, 100]: ${p}`);
  const ordenado = [...valores].sort((a, b) => a - b);
  const posto = Math.ceil((p / 100) * ordenado.length);
  return ordenado[posto - 1] ?? 0;
}

export function estatisticaDoGatilho(gatilho: GatilhoMedido, amostras: Amostra[]): EstatisticaGatilho {
  const doGatilho = amostras.filter((a) => a.gatilho === gatilho);
  const latencias = doGatilho.map((a) => a.latenciaMs);
  const semCusto = doGatilho.some((a) => a.custoMicrodolares === null);
  const total = doGatilho.reduce((s, a) => s + (a.custoMicrodolares ?? 0), 0);
  return {
    gatilho,
    execucoes: doGatilho.length,
    custoMedioMicrodolares: semCusto || doGatilho.length === 0 ? null : Math.round(total / doGatilho.length),
    latenciaP50Ms: percentil(latencias, 50),
    latenciaP95Ms: percentil(latencias, 95),
    latenciaMaximaMs: latencias.length ? Math.max(...latencias) : 0,
  };
}

export const GATILHOS_MEDIDOS: GatilhoMedido[] = ["relatorio_diario", "mensagem_dono", "extracao_nota"];

export function estatisticas(amostras: Amostra[]): EstatisticaGatilho[] {
  return GATILHOS_MEDIDOS.map((g) => estatisticaDoGatilho(g, amostras));
}
