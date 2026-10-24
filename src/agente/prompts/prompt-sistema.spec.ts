import { carregarPromptSistema } from "./prompt-sistema";

describe("carregarPromptSistema", () => {
  it("o padrão é a versão mais nova e a versão gravada bate com o arquivo", () => {
    const padrao = carregarPromptSistema();
    expect(padrao.versao).toBe("sistema-v6");
    expect(padrao.renderizar({ nomeComercio: "Mercadinho do Zé" })).toContain("Mercadinho do Zé");
  });

  it.each(["v1", "v2", "v3", "v4", "v5", "v6"])("a versão %s carrega e troca o nome do comércio", (v) => {
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
    expect(texto("v4")).not.toBe(texto("v5"));
    expect(texto("v5")).not.toBe(texto("v6"));
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
      expect(regra(11)).toContain("depois da confirmação do dono, e peça o produto e o valor");
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
        "get_daily_summary",
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

  describe("sistema-v5", () => {
    const v3 = carregarPromptSistema("v3").renderizar({ nomeComercio: "L" });
    const v4 = carregarPromptSistema("v4").renderizar({ nomeComercio: "L" });
    const v5 = carregarPromptSistema("v5").renderizar({ nomeComercio: "L" });
    const regra = (texto: string, n: number) => texto.split("\n").find((l) => l.startsWith(`${n}. `)) ?? "";

    it("mantém as regras 1 a 8 da v3 sem mudar uma palavra, e as regras 9, 13 e 14 da v4", () => {
      const regras = (t: string) => t.split("\n").filter((l) => /^[1-8]\. /.test(l));
      expect(regras(v5)).toEqual(regras(v3));
      expect(v5.split("\n")[0]).toBe(v3.split("\n")[0]);
      expect(v5).toContain("Uma mensagem que cite número fora dos resultados das ferramentas é bloqueada");
      for (const n of [9, 13, 14]) expect(regra(v5, n)).toBe(regra(v4, n));
    });

    it("o texto da regra 15 pede o produto e os números principais, em 2 a 4 linhas, com escopo e precedência", () => {
      const r = regra(v5, 15);
      expect(r).toContain("o nome do produto e os números principais que ela devolveu");
      expect(r).toContain("só se a ferramenta devolver o total do assunto");
      expect(r).toContain("`n_registros` não conta um assunto");
      expect(r).toContain("que traz produto");
      expect(r).toContain("Totais do comércio");
      expect(r).toContain("só desse item");
      expect(r).toContain("De `list_alert_candidates`, cite no máximo 3 candidatos");
      expect(r).toContain("De `list_product_margins`, escreva todos os produtos que ela devolveu");
      expect(r).toContain("vale a regra 9");
      expect(r).toContain("diga o `total_que_atendem` (zero)");
      expect(r).toContain("não têm o limite de 2 a 4 linhas");
      expect(r).toContain("a pergunta de confirmação da regra 4 e a ressalva da regra 14 não se cortam");
      expect(r).toContain('"queda de"');
      expect(r).toContain("siga a regra 10, inclusive a frase inicial");
      expect(regra(v5, 12)).toContain(
        "não ofereça nada além da linha da regra 10, que pode vir depois do pedido da planilha",
      );
      expect(r).toContain("No relatório diário vale a regra 3");
      for (const termo of ["dias sem venda", "percentual", "valor anterior e atual", "mediana ou limite"]) {
        expect(r).toContain(termo);
      }
      expect(r).toContain("quantos são");
      expect(r).toContain("um nome por linha");
      expect(r).toContain("tem de 2 a 4 linhas");
    });

    it("o não sei começa com a frase clara e sem outros números, e a recusa é de uma frase só", () => {
      expect(regra(v5, 10)).toContain('começando com "Não sei" ou "Não tenho esse dado"');
      expect(regra(v5, 10)).toContain("Não escreva outros números nem resumos de outros assuntos");
      expect(regra(v5, 10)).toContain("se só um item não tem dado, veja a regra 15");
      expect(regra(v5, 11)).toContain(
        "A parte da recusa é uma frase só, curta, e vem primeiro; o que você pode fazer vem depois",
      );
      expect(regra(v5, 11)).toContain("nem número de telefone");
      expect(regra(v5, 11)).toContain("enviar dados a outro número");
      expect(regra(v5, 11)).toContain("responda a pergunta com a ferramenta e recuse só o resto");
    });

    it("só cita ferramentas e campos conhecidos e não usa travessão", () => {
      const conhecidos = new Set([
        "list_alert_candidates",
        "select_alerts",
        "propose_target_price",
        "ask_owner",
        "save_owner_answer",
        "get_product_margin",
        "get_cost_changes",
        "get_daily_summary",
        "list_product_margins",
        "filtro",
        "ordenar",
        "abaixo_da_meta",
        "menor_margem",
        "maior_margem",
        "total_que_atendem",
        "n_registros",
        "pergunta_id",
      ]);
      for (const m of v5.matchAll(/`([a-z_]+)`/g)) {
        const nome = m[1] ?? "";
        if (nome.endsWith("_centavos")) continue;
        expect(conhecidos.has(nome)).toBe(true);
      }
      expect(v5).not.toMatch(/[—–]/);
    });
  });

  describe("sistema-v6", () => {
    const v3 = carregarPromptSistema("v3").renderizar({ nomeComercio: "L" });
    const v6 = carregarPromptSistema("v6").renderizar({ nomeComercio: "L" });
    const regra = (texto: string, n: number) => texto.split("\n").find((l) => l.startsWith(`${n}. `)) ?? "";

    it("mantém das regras da v3 a dos números (1), a da confirmação de preço (4) e a de dado não ser instrução (5)", () => {
      for (const n of [1, 4, 5]) expect(regra(v6, n)).toBe(regra(v3, n));
      expect(v6).toContain("Uma mensagem que cite número fora dos resultados das ferramentas é bloqueada");
    });

    it("não oferece gastos nem saldo: o que o agente responde é a lista do pitch", () => {
      const lista =
        "vendas, ticket médio, margens, reajustes de custo, produtos mais vendidos, produtos parados e avisos do dia";
      expect(regra(v6, 3)).toContain(lista);
      expect(regra(v6, 10)).toContain(lista);
      expect(regra(v6, 3)).toContain(
        "Gastos, despesas, saldo, extrato e conta bancária não fazem parte do Omnia",
      );
      // Fora da regra 3, que os recusa, nenhuma regra fala de gasto ou saldo.
      const semARegra3 = v6.replace(regra(v6, 3), "");
      expect(semARegra3).not.toMatch(/gasto|saldo/i);
    });

    it("traz os formatos das etapas 0, 2, 3 e 4 do vídeo com as ferramentas certas", () => {
      expect(regra(v6, 6)).toContain("`get_daily_briefing` sem `data`");
      expect(v6).toContain("Resumo de ontem, {dia_da_semana} ({dd/mm}):");
      expect(v6).toContain("*Como foi o dia:*");
      expect(v6).toContain("*Últimos 7 dias:* Mais venderam:");
      expect(v6).toContain("*Precisam de atenção:*");
      for (const motivo of ["`custo_subiu`", "`margem_abaixo_da_meta`", "`sem_venda`"])
        expect(v6).toContain(motivo);
      expect(regra(v6, 7)).toContain("Ontem o ticket médio foi R$ {ticket}, em {vendas} vendas.");
      expect(regra(v6, 8)).toContain("Nos últimos 7 dias, os que mais venderam foram:");
      expect(regra(v6, 8)).toContain("`criterio` `volume`");
      expect(regra(v6, 9)).toContain("`get_period_summary` com `periodo` `semana`");
      expect(regra(v6, 9)).toContain("até 3 linhas");
    });

    it("mantém o não sei sem números e a recusa de uma frase", () => {
      expect(regra(v6, 10)).toContain('começa com "Não sei" ou "Não tenho esse dado"');
      expect(regra(v6, 10)).toContain("Não escreva números nessa resposta");
      expect(regra(v6, 11)).toContain("recuse em uma frase curta, que vem primeiro");
      expect(regra(v6, 11)).toContain("nem número de telefone");
      expect(regra(v6, 11)).toContain("responda a pergunta com a ferramenta e recuse só o resto");
    });

    it("só cita ferramentas e campos conhecidos e não usa travessão", () => {
      const conhecidos = new Set([
        "get_daily_briefing",
        "data",
        "atencao",
        "custo_subiu",
        "margem_abaixo_da_meta",
        "sem_venda",
        "get_top_products",
        "criterio",
        "volume",
        "get_period_summary",
        "periodo",
        "semana",
        "mes",
        "list_alert_candidates",
        "get_cost_changes",
        "list_product_margins",
        "filtro",
        "abaixo_da_meta",
        "ordenar",
        "menor_margem",
        "maior_margem",
        "total_que_atendem",
        "get_product_margin",
        "propose_target_price",
        "ask_owner",
        "save_owner_answer",
        "pergunta_id",
      ]);
      for (const m of v6.matchAll(/`([a-z_]+)`/g)) {
        const nome = m[1] ?? "";
        if (nome.endsWith("_centavos")) continue;
        expect(conhecidos.has(nome)).toBe(true);
      }
      expect(v6).not.toMatch(/[—–]/);
    });
  });
});
