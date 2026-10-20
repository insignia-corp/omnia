import { carregarFixtures } from "./carregar-fixtures";
import { comerciantesDoSeed } from "./semear";
import { montarSeed } from "./montar-seed";
import { uuidDeterministico } from "./uuid-deterministico";

describe("uuidDeterministico", () => {
  it("devolve sempre o mesmo UUID versão 5 para o mesmo nome", () => {
    const a = uuidDeterministico("vila-nova/produto/P01");
    expect(a).toBe(uuidDeterministico("vila-nova/produto/P01"));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(uuidDeterministico("esquina-24h/produto/P01"));
  });
});

describe("montarSeed", () => {
  const fix = carregarFixtures();
  const [vilaNova, esquina] = comerciantesDoSeed(fix).map(({ opcoes, dados }) =>
    montarSeed(dados, opcoes),
  ) as [ReturnType<typeof montarSeed>, ReturnType<typeof montarSeed>];

  it("é determinístico: duas montagens dão as mesmas linhas", () => {
    const { opcoes, dados } = comerciantesDoSeed(fix)[0]!;
    expect(JSON.stringify(montarSeed(dados, opcoes))).toBe(JSON.stringify(vilaNova));
  });

  it("carrega tudo do mercadinho: produtos, fornecedores, notas, vendas e extrato", () => {
    expect(vilaNova.produtos).toHaveLength(fix.produtos.length);
    expect(vilaNova.fornecedores).toHaveLength(fix.fornecedores.length);
    expect(vilaNova.compras).toHaveLength(fix.notas.length);
    expect(vilaNova.vendas).toHaveLength(fix.cupons.length);
    expect(vilaNova.itensDeVenda).toHaveLength(fix.cupons.reduce((s, c) => s + c.itens.length, 0));
    expect(vilaNova.transacoes).toHaveLength(fix.transacoes.length);
    expect(vilaNova.documentos).toHaveLength(fix.notas.length + 1);
  });

  it("todo item de compra gera um registro de histórico de custo, com o mesmo custo", () => {
    expect(vilaNova.historicoCusto).toHaveLength(vilaNova.itensDeCompra.length);
    for (const item of vilaNova.itensDeCompra) {
      const historico = vilaNova.historicoCusto.find((h) => h.itemDeCompraId === item.id);
      expect(historico?.custoUnitarioCentavos).toBe(item.valorUnitarioCentavos);
      expect(historico?.produtoId).toBe(item.produtoId);
    }
  });

  it("item de confiança baixa fica em revisão e gera uma pergunta pendente ao dono", () => {
    const baixos = vilaNova.itensDeCompra.filter((i) => i.revisaoPendente);
    expect(baixos).toHaveLength(1);
    expect(vilaNova.perguntas).toHaveLength(1);
    expect(vilaNova.perguntas[0]?.itemDeCompraId).toBe(baixos[0]?.id);
  });

  it("guarda um vínculo vigente por fornecedor e descrição, e o dono já confirmou os que a nota deixou legíveis", () => {
    const chaves = vilaNova.vinculos.map((v) => `${v.fornecedorId}|${v.descricaoNormalizada}`);
    expect(new Set(chaves).size).toBe(chaves.length);
    expect(vilaNova.vinculos.length).toBeGreaterThan(0);
    for (const v of vilaNova.vinculos) {
      expect(v.confirmadoPeloDono).toBe(true);
      expect(v.metodo).toBe("dono");
    }
  });

  it("todo dinheiro é inteiro e toda linha de dado carrega origem e confiança", () => {
    for (const v of vilaNova.vendas) expect(Number.isInteger(v.totalCentavos)).toBe(true);
    for (const t of vilaNova.transacoes) {
      expect(Number.isInteger(t.valorCentavos)).toBe(true);
      expect(t.origem).toBe("banco");
    }
    for (const c of vilaNova.compras) expect(c.confianca).toBeGreaterThan(0);
    for (const i of vilaNova.itensDeCompra) expect(i.origem === "foto_nota" || i.origem === "nfe").toBe(true);
  });

  it("os dois comerciantes não compartilham nenhum id e todo vínculo fica dentro do próprio comerciante", () => {
    const ids = (l: typeof vilaNova) =>
      new Set(
        [
          l.produtos,
          l.fornecedores,
          l.vendas,
          l.itensDeVenda,
          l.compras,
          l.itensDeCompra,
          l.transacoes,
          l.historicoCusto,
          l.documentos,
        ]
          .flat()
          .map((x) => x.id as string),
      );
    const a = ids(vilaNova);
    for (const id of ids(esquina)) expect(a.has(id)).toBe(false);

    const produtosDaEsquina = new Set(esquina.produtos.map((p) => p.id));
    for (const item of esquina.itensDeVenda) expect(produtosDaEsquina.has(item.produtoId)).toBe(true);
    const fornecedoresDaEsquina = new Set(esquina.fornecedores.map((f) => f.id));
    for (const c of esquina.compras) expect(fornecedoresDaEsquina.has(c.fornecedorId)).toBe(true);
    for (const linha of [...esquina.produtos, ...esquina.vendas, ...esquina.compras]) {
      expect(linha.comercianteId).toBe(esquina.comerciante.id);
    }
  });

  it("o segundo comerciante é um recorte menor, com telefone e meta de margem próprios", () => {
    expect(esquina.produtos.length).toBeLessThan(vilaNova.produtos.length);
    expect(esquina.vendas.length).toBeLessThan(vilaNova.vendas.length);
    expect(esquina.comerciante.telefoneWhatsapp).not.toBe(vilaNova.comerciante.telefoneWhatsapp);
    expect(esquina.comerciante.margemMetaBps).not.toBe(vilaNova.comerciante.margemMetaBps);
  });
});
