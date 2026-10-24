import { runInNewContext } from "node:vm";
import { FORMATADORES_PAGINA } from "./formatadores-pagina";

interface Formatadores {
  reais(centavos: number | null | undefined): string;
  dolares(microdolares: number | null | undefined, casas: number): string;
  latencia(ms: number | null | undefined): string;
  rotuloGatilho(gatilho: string): string;
  rotuloResultado(resultado: string, gatilho: string): { texto: string; cor: string };
  rotuloTipoAlerta(tipo: string): string;
  rotuloStatusAlerta(status: string): { texto: string; cor: string };
  rotuloStatusExtracao(status: string): { texto: string; cor: string };
}

// Executa o mesmo texto que a página embute, então o que se testa é o que a tela usa.
const f = runInNewContext(
  `${FORMATADORES_PAGINA}; ({ reais, dolares, latencia, rotuloGatilho, rotuloResultado, rotuloTipoAlerta, rotuloStatusAlerta, rotuloStatusExtracao })`,
) as Formatadores;

describe("reais", () => {
  it("formata centavos inteiros", () => {
    expect(f.reais(128450)).toBe("R$ 1.284,50");
    expect(f.reais(5)).toBe("R$ 0,05");
    expect(f.reais(-1999)).toBe("-R$ 19,99");
    expect(f.reais(null)).toBe("sem valor");
  });
});

describe("dolares", () => {
  it("custo do dia com duas casas, meio para cima", () => {
    expect(f.dolares(180_000, 2)).toBe("US$ 0,18");
    expect(f.dolares(184_999, 2)).toBe("US$ 0,18");
    expect(f.dolares(185_000, 2)).toBe("US$ 0,19");
    expect(f.dolares(0, 2)).toBe("US$ 0,00");
    expect(f.dolares(12_340_000, 2)).toBe("US$ 12,34");
    expect(f.dolares(1_234_560_000, 2)).toBe("US$ 1.234,56");
  });

  it("custo da execução com três casas", () => {
    expect(f.dolares(12_000, 3)).toBe("US$ 0,012");
    expect(f.dolares(1_500, 3)).toBe("US$ 0,002");
    expect(f.dolares(2_345_678, 3)).toBe("US$ 2,346");
  });

  it("não mostra zero quando houve custo pequeno demais para as casas", () => {
    expect(f.dolares(400, 3)).toBe("< US$ 0,001");
    expect(f.dolares(3_000, 2)).toBe("< US$ 0,01");
  });
});

describe("latencia", () => {
  it("abaixo de 1 s fica em ms", () => {
    expect(f.latencia(95)).toBe("95 ms");
    expect(f.latencia(999)).toBe("999 ms");
  });

  it("a partir de 1 s mostra um décimo, meio para cima, sem ponto flutuante", () => {
    expect(f.latencia(4200)).toBe("4,2 s");
    expect(f.latencia(4249)).toBe("4,2 s");
    expect(f.latencia(4250)).toBe("4,3 s");
    expect(f.latencia(1000)).toBe("1,0 s");
    expect(f.latencia(2640)).toBe("2,6 s");
    expect(f.latencia(null)).toBe("sem dados");
  });
});

describe("rótulos", () => {
  it("traduz todo gatilho e resultado que o registro grava", () => {
    expect(f.rotuloGatilho("mensagem_dono")).toBe("mensagem do dono");
    expect(f.rotuloGatilho("nota_processada")).toBe("nota recebida");
    expect(f.rotuloGatilho("relatorio_diario")).toBe("resumo diário");
    expect(f.rotuloGatilho("extracao_nota")).toBe("leitura da nota");
    expect(f.rotuloGatilho("vinculo_produto")).toBe("vínculo de produto");
    expect(f.rotuloResultado("aprovada", "mensagem_dono")).toEqual({ texto: "Enviada", cor: "verde" });
    expect(f.rotuloResultado("aprovada", "extracao_nota")).toEqual({ texto: "Concluída", cor: "verde" });
    expect(f.rotuloResultado("fallback_verificador", "mensagem_dono").cor).toBe("vermelho");
    expect(f.rotuloResultado("fallback_erro", "mensagem_dono")).toEqual({ texto: "Erro", cor: "vermelho" });
    expect(f.rotuloResultado("recusa_modelo", "mensagem_dono").cor).toBe("ambar");
  });

  it("status de alerta e de extração sempre com texto e cor", () => {
    expect(f.rotuloStatusAlerta("enviado")).toEqual({ texto: "enviado", cor: "verde" });
    expect(f.rotuloStatusAlerta("candidato").cor).toBe("ambar");
    expect(f.rotuloStatusAlerta("descartado").cor).toBe("cinza");
    expect(f.rotuloStatusAlerta("obsoleto").cor).toBe("cinza");
    expect(f.rotuloStatusExtracao("extraido")).toEqual({ texto: "Extraída", cor: "verde" });
    expect(f.rotuloStatusExtracao("revisao").cor).toBe("ambar");
    expect(f.rotuloStatusExtracao("falha").cor).toBe("vermelho");
    expect(f.rotuloTipoAlerta("margem_abaixo_da_meta")).toBe("Margem abaixo da meta");
  });
});
