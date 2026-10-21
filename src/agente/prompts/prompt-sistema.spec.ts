import { carregarPromptSistema } from "./prompt-sistema";

describe("carregarPromptSistema", () => {
  it("o padrão é a versão mais nova e a versão gravada bate com o arquivo", () => {
    const padrao = carregarPromptSistema();
    expect(padrao.versao).toBe("sistema-v3");
    expect(padrao.renderizar({ nomeComercio: "Mercadinho do Zé" })).toContain("Mercadinho do Zé");
  });

  it.each(["v1", "v2", "v3"])("a versão %s carrega e troca o nome do comércio", (v) => {
    const p = carregarPromptSistema(v);
    expect(p.versao).toBe(`sistema-${v}`);
    expect(p.renderizar({ nomeComercio: "Loja X" })).not.toContain("{{nome_do_comercio}}");
  });

  it("versões diferentes têm comportamento diferente: editar uma versão em uso exige criar a seguinte", () => {
    const texto = (v: string) => carregarPromptSistema(v).renderizar({ nomeComercio: "L" });
    expect(texto("v2")).not.toBe(texto("v3"));
    expect(texto("v3")).toContain("propose_target_price");
    expect(texto("v2")).not.toContain("propose_target_price");
  });
});
