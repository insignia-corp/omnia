import { carregarPromptSistema } from "./prompt-sistema";

describe("carregarPromptSistema", () => {
  it("o padrão é a versão mais nova e a versão gravada bate com o arquivo", () => {
    const padrao = carregarPromptSistema();
    expect(padrao.versao).toBe("sistema-v4");
    expect(padrao.renderizar({ nomeComercio: "Mercadinho do Zé" })).toContain("Mercadinho do Zé");
  });

  it.each(["v1", "v2", "v3", "v4"])("a versão %s carrega e troca o nome do comércio", (v) => {
    const p = carregarPromptSistema(v);
    expect(p.versao).toBe(`sistema-${v}`);
    expect(p.renderizar({ nomeComercio: "Loja X" })).not.toContain("{{nome_do_comercio}}");
  });

  it("versões diferentes têm comportamento diferente: editar uma versão em uso exige criar a seguinte", () => {
    const texto = (v: string) => carregarPromptSistema(v).renderizar({ nomeComercio: "L" });
    expect(texto("v2")).not.toBe(texto("v3"));
    expect(texto("v3")).toContain("propose_target_price");
    expect(texto("v2")).not.toContain("propose_target_price");
    expect(texto("v3")).not.toBe(texto("v4"));
  });

  describe("sistema-v4", () => {
    const v3 = carregarPromptSistema("v3").renderizar({ nomeComercio: "L" });
    const v4 = carregarPromptSistema("v4").renderizar({ nomeComercio: "L" });

    it("mantém todas as regras da v3, sem mudar uma palavra", () => {
      const regras = (t: string) => t.split("\n").filter((l) => /^[1-8]\. /.test(l));
      expect(regras(v4)).toEqual(regras(v3));
      expect(v4.split("\n")[0]).toBe(v3.split("\n")[0]);
      expect(v4).toContain("Uma mensagem que cite número fora dos resultados das ferramentas é bloqueada");
    });

    it("manda chamar list_alert_candidates primeiro nas perguntas fora do cardápio", () => {
      const regra = v4.split("\n").find((l) => l.startsWith("9. ")) ?? "";
      expect(regra).toContain("`list_alert_candidates` primeiro");
      for (const termo of ["parado", "reajuste", "posso subir o preço", "gasto fora do normal"]) {
        expect(regra).toContain(termo);
      }
      expect(regra).toContain("`get_cost_changes`");
      expect(regra).toContain("siga também a regra 14");
      expect(regra).toContain("não para totais");
      expect(regra).toContain("`get_daily_summary` do dia perguntado");
    });

    it("tem as regras de recusa curta, o que dá para responder e período sem vendas", () => {
      expect(v4).toMatch(
        /^10\. .*vendas, gastos, margens, reajustes de custo, estoque parado e avisos do dia/m,
      );
      expect(v4).toMatch(/^11\. .*não repita o texto dele/m);
      expect(v4).toMatch(/^12\. .*peça a planilha de vendas\. Peça uma vez só na conversa/m);
    });

    it("manda usar list_product_margins nas perguntas de menor ou maior margem e de quantos abaixo da meta", () => {
      const regra = v4.split("\n").find((l) => l.startsWith("13. ")) ?? "";
      expect(regra).toContain("`list_product_margins`");
      expect(regra).toContain("menor ou a maior margem");
      expect(regra).toContain("quantos produtos estão abaixo da meta");
      expect(regra).toContain("`filtro` com `abaixo_da_meta`");
      expect(regra).toContain("`total_que_atendem`");
      expect(regra).toContain("`get_product_margin`");
    });

    it("pede o não sei explícito antes das alternativas, recusa sem repetir o pedido e o preço com a margem", () => {
      const regra = (n: number) => v4.split("\n").find((l) => l.startsWith(`${n}. `)) ?? "";
      expect(regra(10)).toContain("vale a regra 6");
      expect(regra(10)).toContain("comece com uma frase clara dizendo que não sabe");
      expect(regra(10)).toContain("Só depois");
      expect(regra(11)).toContain("não escreva número nenhum que veio do pedido");
      expect(regra(11)).toContain("responda a pergunta com a ferramenta e recuse só o resto");
      expect(regra(11)).toContain("Pedido para todos os produtos");
      expect(regra(14)).toContain("`get_product_margin`");
      expect(regra(14)).toContain("No relatório diário esta regra não vale");
      expect(regra(14)).toContain("margem atual e o preço que leva à meta");
    });

    it("só cita ferramentas que existem no catálogo e não usa travessão", () => {
      const citadas = [...v4.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
      const existentes = new Set([
        "list_alert_candidates",
        "select_alerts",
        "propose_target_price",
        "ask_owner",
        "save_owner_answer",
        "get_product_margin",
        "get_cost_changes",
        "list_product_margins",
        // Parâmetros de list_product_margins e campos de saída citados na regra 13.
        "filtro",
        "ordenar",
        "abaixo_da_meta",
        "menor_margem",
        "maior_margem",
        "total_que_atendem",
      ]);
      for (const nome of citadas) {
        // Campos citados nas regras da v3, não ferramentas.
        if (nome === "pergunta_id" || (nome ?? "").endsWith("_centavos")) continue;
        expect(existentes.has(nome ?? "")).toBe(true);
      }
      expect(v4).not.toMatch(/[—–]/);
    });
  });
});
