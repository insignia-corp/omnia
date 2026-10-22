import { extrairNumeros, NumerosAutorizados, verificarNumeros } from "./verificador-numeros";

describe("extrairNumeros", () => {
  it.each([
    ["Você vendeu R$ 1.234,50 ontem", [1234.5]],
    ["Margem de 12,5% no arroz", [12.5]],
    ["Vendeu 37 unidades", [37]],
    ["Subiu de R$ 8,90 para R$ 9,79", [8.9, 9.79]],
    ["Em 15/10 o custo mudou", [15, 10]],
    ["Data 2026-10-15", [2026, 10, 15]],
    ["Total de 1.000.000", [1000000]],
    ["Margem de -12,5% e saldo de R$ -1.234,50", [-12.5, -1234.5]],
    ["Saldo de -R$ 12,50 e margem de −12,5%", [-12.5, -12.5]],
    ["Margem de +12,5% e saldo de R$ +12,50", [12.5, 12.5]],
    ["Margem de menos 12,5% e saldo de menos R$ 12,50", [-12.5, -12.5]],
    ["Entre 12-15 dias, em 2026-10-20", [12, 15, 2026, 10, 20]],
    ["Sem números aqui", []],
  ])("%p", (msg, esperado) => {
    expect(extrairNumeros(msg).map((e) => e.valor)).toEqual(esperado);
  });

  it("guarda o trecho original", () => {
    expect(extrairNumeros("Faturou R$ 1.234,50 e 12%")).toMatchObject([
      { texto: "R$ 1.234,50" },
      { texto: "12%" },
    ]);
  });
});

describe("verificarNumeros", () => {
  const resultadoFerramentas = [
    {
      produto: "Refrigerante 2L",
      periodo: { inicio: "2026-10-12", fim: "2026-10-18" },
      preco_medio_centavos: 899,
      custo_centavos: 650,
      margem_percentual: 27.7,
      n_registros: 42,
      menor_confianca: 0.92,
    },
  ];
  const autorizados = new NumerosAutorizados(resultadoFerramentas);

  it("aprova mensagem só com números das ferramentas", () => {
    const r = verificarNumeros(
      "O Refrigerante 2L teve margem de 27,7% entre 12/10 e 18/10: preço médio de R$ 8,99 e custo de R$ 6,50.",
      autorizados,
    );
    expect(r.aprovado).toBe(true);
    expect(r.naoAutorizados).toEqual([]);
  });

  it("aceita o valor bruto em centavos e a contagem de registros", () => {
    expect(verificarNumeros("Foram 42 vendas.", autorizados).aprovado).toBe(true);
  });

  it("bloqueia número inventado", () => {
    const r = verificarNumeros("A margem é de 30% e você pode subir o preço para R$ 9,50.", autorizados);
    expect(r.aprovado).toBe(false);
    expect(r.naoAutorizados.map((n) => n.texto)).toEqual(["30%", "R$ 9,50"]);
  });

  it("bloqueia arredondamento feito pelo modelo", () => {
    expect(verificarNumeros("Margem de 28%.", autorizados).aprovado).toBe(false);
    expect(verificarNumeros("Margem de 27,704%.", autorizados).aprovado).toBe(false);
  });

  it.each([
    "Você faturou quinhentos reais e a margem foi de trinta por cento.",
    "Foram vinte e três vendas.",
    "Faturou dois milhões de reais.",
    "Comprou duzentas unidades.",
    "A margem foi de zero por cento.",
    "Vendeu uma unidade e recebeu um real.",
    "Vendeu em um mês.",
    "Faturou R$ 5 mil.",
  ])("bloqueia cardinais por extenso: %s", (mensagem) => {
    const r = verificarNumeros(mensagem, new NumerosAutorizados());
    expect(r.aprovado).toBe(false);
    expect(r.porExtenso.length).toBeGreaterThan(0);
  });

  it("exige algarismos mesmo quando o valor por extenso existe nas fontes", () => {
    const r = verificarNumeros(
      "Margem de trinta por cento.",
      new NumerosAutorizados([{ margem_percentual: 30 }]),
    );
    expect(r.aprovado).toBe(false);
    expect(r.porExtenso).toEqual(["trinta"]);
  });

  it("não confunde artigos nem partes de palavras com cardinais", () => {
    expect(
      verificarNumeros(
        "Pode mandar uma planilha? Tive um problema com o documento.",
        new NumerosAutorizados(),
      ).aprovado,
    ).toBe(true);
    expect(
      verificarNumeros("O comércio fica no centro, na Rua Milena.", new NumerosAutorizados()).aprovado,
    ).toBe(true);
    expect(verificarNumeros("Margem de 27,7 por cento.", autorizados).aprovado).toBe(true);
  });

  it("preserva sinais de margens e de valores monetários", () => {
    const a = new NumerosAutorizados([{ margem_percentual: -12.5, saldo_centavos: -123450 }]);
    expect(verificarNumeros("Margem de -12,5% e saldo de R$ -1.234,50.", a).aprovado).toBe(true);
    expect(verificarNumeros("Margem de 12,5%.", a).aprovado).toBe(false);
    expect(verificarNumeros("Saldo de R$ 1.234,50.", a).aprovado).toBe(false);
    expect(verificarNumeros("Margem de -27,7%.", autorizados).aprovado).toBe(false);
  });

  it("preserva o sinal de ponto decimal vindo em texto de ferramenta", () => {
    const a = new NumerosAutorizados([{ descricao: "Margem -12.5" }]);
    expect(verificarNumeros("Margem de -12,5%.", a).aprovado).toBe(true);
    expect(verificarNumeros("Margem de 12,5%.", a).aprovado).toBe(false);
  });

  it("só converte para reais chaves terminadas em _centavos", () => {
    const a = new NumerosAutorizados([{ quantidade: 650 }]);
    expect(verificarNumeros("Custo de R$ 6,50", a).aprovado).toBe(false);
    expect(verificarNumeros("Foram 650 itens", a).aprovado).toBe(true);
  });

  it("aceita números extras informados pelo código, como os da pergunta do dono", () => {
    const a = new NumerosAutorizados([], [7]);
    expect(verificarNumeros("Nos últimos 7 dias não houve venda.", a).aprovado).toBe(true);
  });

  it("aprova mensagem sem números", () => {
    expect(
      verificarNumeros("Não tenho esse dado. Quanto você pagou?", new NumerosAutorizados()).aprovado,
    ).toBe(true);
  });

  it("aceita números em texto com ponto decimal vindo de ferramenta", () => {
    const a = new NumerosAutorizados([{ descricao: "Óleo 1.5L" }]);
    expect(verificarNumeros("O Óleo 1,5L subiu.", a).aprovado).toBe(true);
  });
});

describe("identificadores não autorizam números (regra 8)", () => {
  const UUID_COM_99 = "f0e1d2c3-99ab-4cde-8f01-23456789abcd";
  const afirma99 = "O custo do arroz subiu 99%.";

  it.each(["alerta_id", "produto_id", "fornecedor_id", "alertaId", "id"])(
    "o valor da chave %s não autoriza os dígitos do UUID",
    (chave) => {
      const a = new NumerosAutorizados([{ [chave]: UUID_COM_99 }]);
      expect(a.contem(99)).toBe(false);
      expect(verificarNumeros(afirma99, a).aprovado).toBe(false);
    },
  );

  it("vale também para listas de ids e para ids numéricos", () => {
    const a = new NumerosAutorizados([
      { alerta_ids: [UUID_COM_99], conta_id: 99, itens: [{ produto_id: 99 }] },
    ]);
    expect(a.contem(99)).toBe(false);
  });

  it("UUID solto em texto ou em lista também não autoriza", () => {
    expect(new NumerosAutorizados([`Alerta ${UUID_COM_99} escolhido`]).contem(99)).toBe(false);
    expect(new NumerosAutorizados([[UUID_COM_99]]).contem(99)).toBe(false);
    expect(new NumerosAutorizados([{ descricao: `ref ${UUID_COM_99.toUpperCase()}` }]).contem(99)).toBe(
      false,
    );
  });

  it("o número de verdade ao lado do id continua autorizado", () => {
    const a = new NumerosAutorizados([
      { produto_id: UUID_COM_99, variacao_percentual: 12.5, custo_atual_centavos: 2790, unidades: 99 },
    ]);
    expect(verificarNumeros("O custo subiu 12,5% e passou a R$ 27,90.", a).aprovado).toBe(true);
    expect(verificarNumeros("Foram 99 unidades.", a).aprovado).toBe(true);
    expect(verificarNumeros("O custo subiu 13%.", a).aprovado).toBe(false);
  });

  it("só ignora o valor do id: outras chaves, datas e nomes com dígitos seguem valendo", () => {
    const a = new NumerosAutorizados([{ data: "2026-10-15", nome: "Refrigerante 2L", paid: 7, valido: 5 }]);
    expect(verificarNumeros("Em 2026-10-15, o Refrigerante 2L teve 7 e 5.", a).aprovado).toBe(true);
  });

  it("o texto de uma mensagem com UUID continua sendo conferido como antes", () => {
    expect(verificarNumeros(`Veja ${UUID_COM_99}.`, new NumerosAutorizados()).aprovado).toBe(false);
  });
});

describe("percentual negativo dito em módulo com palavra de direção (regra 8)", () => {
  const resumo = {
    comparacao_faturamento: { variacao_percentual: -7.29, variacao_bps: -729 },
    vendas_ontem_centavos: -15000,
    unidades: -3,
    margem_percentual: 27.7,
  };
  const a = new NumerosAutorizados([resumo]);

  it.each([
    "Faturamento em queda de 7,29% contra os dias anteriores.",
    "O faturamento caiu 7,29% em relação aos dias anteriores.",
    "Houve recuo de 7,29% no faturamento.",
    "A queda foi de 7,29%.",
    "O faturamento ficou 7,29% menor que antes.",
    "Vendeu 7,29% abaixo da média.",
    "Vendeu 7,29% a menos que ontem.",
    "Teve 7,29% de queda nas vendas.",
    "A variação foi negativa em 7,29%.",
    "Houve queda de 7,29%, com margem de 27,7%.",
  ])("aprova o valor absoluto com direção coerente: %s", (mensagem) => {
    expect(verificarNumeros(mensagem, a).aprovado).toBe(true);
  });

  it.each([
    "O faturamento teve alta de 7,29%.",
    "O faturamento subiu 7,29% contra os dias anteriores.",
    "Vendeu 7,29% acima da média.",
    "Vendeu 7,29% a mais que ontem.",
    "Houve aumento de 7,29% no faturamento.",
    "Houve queda de 27,7% e alta de 7,29%.",
    "O faturamento caiu, mas a margem subiu 7,29%.",
  ])("barra o sentido errado: %s", (mensagem) => {
    expect(verificarNumeros(mensagem, a).aprovado).toBe(false);
  });

  it.each([
    "O faturamento variou 7,29% contra os dias anteriores.",
    "A variação foi de 7,29%.",
    "Houve queda nas vendas. A margem é de 7,29%.",
    "Houve queda nas vendas, mas a margem foi de 7,29%.",
    "Queda de 7,29 pontos.",
  ])("barra o caso ambíguo sem direção coerente: %s", (mensagem) => {
    expect(verificarNumeros(mensagem, a).aprovado).toBe(false);
  });

  it("barra valor que não existe em nenhuma saída, mesmo com direção", () => {
    expect(verificarNumeros("Queda de 7,30% no faturamento.", a).aprovado).toBe(false);
    expect(verificarNumeros("Queda de 30,23% no faturamento.", a).aprovado).toBe(false);
    expect(verificarNumeros("Alta de 30,23% no faturamento.", a).aprovado).toBe(false);
  });

  it("não vale para sinal explícito errado nem para outras chaves", () => {
    expect(verificarNumeros("Queda de +7,29%.", a).aprovado).toBe(false);
    expect(verificarNumeros("Queda de 7,29.", a).aprovado).toBe(false);
  });

  it("dinheiro e contagem seguem exigindo o sinal da ferramenta", () => {
    expect(verificarNumeros("Queda de R$ 150,00 nas vendas.", a).aprovado).toBe(false);
    expect(verificarNumeros("O saldo caiu R$ 150,00.", a).aprovado).toBe(false);
    expect(verificarNumeros("Queda de 3 unidades.", a).aprovado).toBe(false);
    expect(verificarNumeros("Queda de 729 pontos.", a).aprovado).toBe(false);
    expect(verificarNumeros("Saldo de R$ -150,00 e -3 unidades.", a).aprovado).toBe(true);
  });

  it("a mesma regra vale em lista, com um verbo para vários valores", () => {
    const lista = new NumerosAutorizados([
      { comparacoes: [{ variacao_percentual: -7.29 }, { variacao_percentual: -30.23 }] },
    ]);
    expect(verificarNumeros("Queda de 7,29% e de 30,23% contra os dias anteriores.", lista).aprovado).toBe(
      true,
    );
    expect(verificarNumeros("Queda de 7,29% e alta de 30,23%.", lista).aprovado).toBe(false);
  });

  it("um valor positivo da ferramenta continua valendo ao lado de uma queda", () => {
    expect(verificarNumeros("Margem de 27,7% e queda de 7,29%.", a).aprovado).toBe(true);
  });
});
