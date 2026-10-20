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
