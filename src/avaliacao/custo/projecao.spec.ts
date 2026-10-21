import type { EstatisticaGatilho } from "./estatisticas";
import { PREMISSAS_PADRAO, projetarMes, type PremissasMensais } from "./projecao";

const medida = (
  gatilho: EstatisticaGatilho["gatilho"],
  custo: number | null,
  execucoes = 5,
): EstatisticaGatilho => ({
  gatilho,
  execucoes,
  custoMedioMicrodolares: custo,
  latenciaP50Ms: 1,
  latenciaP95Ms: 1,
  latenciaMaximaMs: 1,
});

const premissas = (extra: Partial<PremissasMensais> = {}): PremissasMensais => ({
  ...PREMISSAS_PADRAO,
  mensagensPorMes: 40,
  ...extra,
});

const todas = [
  medida("relatorio_diario", 40_000),
  medida("mensagem_dono", 20_000),
  medida("extracao_nota", 9_000),
];

describe("projetarMes", () => {
  it("custo do mês é a média medida vezes a quantidade, em micro-dólares inteiros", () => {
    const p = projetarMes(todas, premissas());
    expect(p.llm.map((l) => l.custoMensalMicrodolares)).toEqual([40_000 * 30, 20_000 * 10, 9_000 * 14]);
    expect(p.llmTotalMicrodolares).toBe(1_200_000 + 200_000 + 126_000);
  });

  it("sem cotação de mensagem e agregador, ficam de fora do total e são listados", () => {
    const p = projetarMes(todas, premissas());
    expect(p.mensagens.custoMensalMicrodolares).toBeNull();
    expect(p.agregador.custoMensalMicrodolares).toBeNull();
    expect(p.naoCotados).toEqual(["mensagens do canal", "agregador"]);
    expect(p.totalCotadoMicrodolares).toBe(p.llmTotalMicrodolares);
  });

  it("com mensagem e agregador, soma tudo; o agregador se divide pelos lojistas", () => {
    const p = projetarMes(
      todas,
      premissas({
        custoPorMensagemMicrodolares: 6_800,
        agregadorMensalMicrodolares: 460_000_000,
        lojistas: 100,
      }),
    );
    expect(p.mensagens.custoMensalMicrodolares).toBe(6_800 * 40);
    expect(p.agregador.custoMensalMicrodolares).toBe(4_600_000);
    expect(p.naoCotados).toEqual([]);
    expect(p.totalCotadoMicrodolares).toBe(1_526_000 + 272_000 + 4_600_000);
  });

  it("execução não medida ou sem preço deixa o LLM indisponível em vez de contar zero", () => {
    const semRelatorio = projetarMes([medida("relatorio_diario", null, 0), ...todas.slice(1)], premissas());
    expect(semRelatorio.llmTotalMicrodolares).toBeNull();
    expect(semRelatorio.naoCotados[0]).toMatch(/^LLM/);
    const semPreco = projetarMes([medida("relatorio_diario", null), ...todas.slice(1)], premissas());
    expect(semPreco.llmTotalMicrodolares).toBeNull();
    expect(semPreco.totalCotadoMicrodolares).toBeNull();
  });

  it("a conta bate com a estimativa da especificação: cerca de US$ 0,04 por relatório e US$ 2,1 por mês", () => {
    const p = projetarMes(
      [medida("relatorio_diario", 40_000), medida("mensagem_dono", 25_000), medida("extracao_nota", 13_000)],
      premissas(),
    );
    expect(p.llmTotalMicrodolares).toBe(1_200_000 + 250_000 + 182_000);
  });
});
