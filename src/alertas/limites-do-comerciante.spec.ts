import { mesclarLimites, LIMITES_PADRAO } from "./limites";
import { LimiteInvalidoError, sobreposicaoDasLinhas, validarLimite } from "./limites-do-comerciante";

describe("validarLimite", () => {
  it("aceita um limite numérico dentro da faixa", () => {
    expect(validarLimite("reajusteLimiteBps", 800)).toBe(800);
    expect(validarLimite("confiancaMinima", 0.85)).toBe(0.85);
    expect(validarLimite("gastoLimiteDesvio", 3.5)).toBe(3.5);
  });

  it("recusa nome desconhecido, inclusive os herdados do objeto", () => {
    expect(() => validarLimite("limiteInventado", 1)).toThrow(LimiteInvalidoError);
    expect(() => validarLimite("toString", 1)).toThrow(LimiteInvalidoError);
    expect(() => validarLimite("janelaSupressaoDias.tipo_que_nao_existe", 1)).toThrow(LimiteInvalidoError);
    expect(() => validarLimite("janelaSupressaoDias", 1)).toThrow(LimiteInvalidoError);
  });

  it("recusa valor fora da faixa, não finito ou fracionário onde deve ser inteiro", () => {
    expect(() => validarLimite("reajusteLimiteBps", 0)).toThrow(LimiteInvalidoError);
    expect(() => validarLimite("reajusteLimiteBps", 12.5)).toThrow(LimiteInvalidoError);
    expect(() => validarLimite("confiancaMinima", 1.2)).toThrow(LimiteInvalidoError);
    expect(() => validarLimite("ticketQuedaLimiteBps", Number.NaN)).toThrow(LimiteInvalidoError);
    expect(() => validarLimite("prioridade1MinCentavos", Infinity)).toThrow(LimiteInvalidoError);
  });

  it("a janela de supressão do reajuste não aceita zero, que reenviaria o mesmo reajuste todo dia", () => {
    expect(() => validarLimite("janelaSupressaoDias.reajuste_de_custo", 0)).toThrow(LimiteInvalidoError);
    expect(validarLimite("janelaSupressaoDias.reajuste_de_custo", 30)).toBe(30);
    expect(validarLimite("janelaSupressaoDias.reajuste_de_custo", null)).toBeNull();
    expect(validarLimite("janelaSupressaoDias.ticket_medio_em_queda", 0)).toBe(0);
  });

  it("recusa valor com mais de 4 casas decimais e centavos que estouram a coluna", () => {
    expect(() => validarLimite("gastoLimiteDesvio", 3.12345)).toThrow(LimiteInvalidoError);
    expect(validarLimite("gastoLimiteDesvio", 3.1234)).toBe(3.1234);
    expect(() => validarLimite("prioridade1MinCentavos", 10_000_000_000)).toThrow(LimiteInvalidoError);
    expect(() => validarLimite("confiancaMinima", 0.10000000001)).toThrow(LimiteInvalidoError);
  });

  it("estoque parado só aceita limite de 30 dias ou mais, porque a métrica já corta nesse valor", () => {
    expect(() => validarLimite("estoqueParadoLimiteDias", 14)).toThrow(LimiteInvalidoError);
    expect(validarLimite("estoqueParadoLimiteDias", 30)).toBe(30);
    expect(validarLimite("estoqueParadoLimiteDias", 60)).toBe(60);
  });

  it("aceita nulo só na janela de supressão, onde quer dizer sem limite de idade", () => {
    expect(validarLimite("janelaSupressaoDias.estoque_parado", null)).toBeNull();
    expect(validarLimite("janelaSupressaoDias.estoque_parado", 0)).toBe(0);
    expect(() => validarLimite("reajusteLimiteBps", null)).toThrow(LimiteInvalidoError);
  });
});

describe("sobreposicaoDasLinhas", () => {
  it("devolve vazio sem linhas, e o padrão fica intacto ao mesclar", () => {
    expect(mesclarLimites(sobreposicaoDasLinhas([]))).toEqual(LIMITES_PADRAO);
  });

  it("converte o numérico do banco e separa as janelas de supressão por tipo", () => {
    const sobreposicao = sobreposicaoDasLinhas([
      { limite: "reajusteLimiteBps", valor: "800.0000" },
      { limite: "gastoLimiteDesvio", valor: "3.5000" },
      { limite: "janelaSupressaoDias.estoque_parado", valor: "14.0000" },
      { limite: "janelaSupressaoDias.reajuste_de_custo", valor: null },
    ]);
    const limites = mesclarLimites(sobreposicao);
    expect(limites.reajusteLimiteBps).toBe(800);
    expect(limites.gastoLimiteDesvio).toBe(3.5);
    expect(limites.janelaSupressaoDias.estoque_parado).toBe(14);
    expect(limites.janelaSupressaoDias.reajuste_de_custo).toBeNull();
    expect(limites.janelaSupressaoDias.giro_em_alta).toBe(LIMITES_PADRAO.janelaSupressaoDias.giro_em_alta);
  });

  it("ignora linha fora da faixa, gravada sem passar pelo validador", () => {
    const limites = mesclarLimites(
      sobreposicaoDasLinhas([
        { limite: "estoqueParadoLimiteDias", valor: "14.0000" },
        { limite: "reajusteLimiteBps", valor: "-5.0000" },
      ]),
    );
    expect(limites).toEqual(LIMITES_PADRAO);
  });

  it("ignora linha com nome que o código não conhece, sem apagar o padrão", () => {
    const limites = mesclarLimites(sobreposicaoDasLinhas([{ limite: "limiteAntigo", valor: "1.0000" }]));
    expect(limites).toEqual(LIMITES_PADRAO);
  });
});
