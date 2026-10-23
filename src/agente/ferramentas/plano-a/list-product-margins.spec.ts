import { randomUUID } from "node:crypto";
import { NumerosAutorizados, verificarNumeros } from "../../../lib/verificador-numeros/verificador-numeros";
import type { MargemDoProduto } from "../../../metricas/margem-por-produto";
import type { MetricasService } from "../../../metricas/metricas.service";
import { dadoAusente, type ResultadoMetrica } from "../../../metricas/resultado-metrica";
import type { ContextoSessao } from "../ferramenta";
import { RegistroFerramentas } from "../registro-ferramentas";
import { criarListProductMargins, type ListaDeMargens } from "./list-product-margins";

const contexto: ContextoSessao = {
  comercianteId: randomUUID(),
  nomeComercio: "Mercadinho Teste",
  dataReferencia: "2026-10-19",
};
const periodo = { inicio: "2026-09-20", fim: "2026-10-19" };

const margem = (nome: string, margemBps: number, extra: Partial<MargemDoProduto> = {}): MargemDoProduto => ({
  produto_id: randomUUID(),
  nome,
  preco_medio_venda_centavos: 1000,
  unidades_vendidas: 10,
  custo_compra_mais_recente_centavos: 700,
  compra_data: "2026-10-10",
  fornecedor_id: randomUUID(),
  margem_bps: margemBps,
  margem_percentual: margemBps / 100,
  meta_bps: 3000,
  meta_percentual: 30,
  abaixo_da_meta: margemBps < 3000,
  preco_para_meta_centavos: 1000,
  ...extra,
});
const resultado = (
  valor: MargemDoProduto,
  menorConfianca: number | null = 1,
  origens: Array<"planilha" | "foto_nota"> = ["planilha"],
): ResultadoMetrica<MargemDoProduto> => ({
  valor,
  periodo,
  n_registros: 5,
  menor_confianca: menorConfianca,
  origens,
});

const servico = (itens: Array<ReturnType<typeof resultado> | ReturnType<typeof dadoAusente>>) => {
  const margensDosProdutos = jest.fn(async () =>
    itens.map((resultado, i) => ({ produto_id: `p${i}`, resultado })),
  );
  const metricas = { margensDosProdutos } as unknown as MetricasService;
  return { margensDosProdutos, ferramenta: criarListProductMargins(metricas) };
};

const executar = async (itens: Parameters<typeof servico>[0], entrada: Record<string, unknown> = {}) => {
  const { ferramenta } = servico(itens);
  const r = await new RegistroFerramentas([ferramenta]).executar(contexto, "list_product_margins", entrada);
  if (!r.ok) throw new Error(r.erro);
  return r.saida as ResultadoMetrica<ListaDeMargens> & { ausente?: true; codigo?: string };
};

const catalogo = [
  resultado(margem("Arroz", 2026)),
  resultado(margem("Feijão", 2881)),
  resultado(margem("Café", 4100)),
  resultado(margem("Óleo", 2318)),
  resultado(margem("Açúcar", 3500)),
  resultado(margem("Sal", 5200)),
  resultado(margem("Leite", 1500)),
];

describe("list_product_margins", () => {
  it("é de leitura (efeito nenhum) e o esquema recusa comerciante_id e campos desconhecidos (regra 3)", () => {
    const { ferramenta } = servico([]);
    expect(ferramenta.efeito).toBe("nenhum");
    expect(ferramenta.entrada.safeParse({}).success).toBe(true);
    expect(ferramenta.entrada.safeParse({ comerciante_id: randomUUID() }).success).toBe(false);
    expect(ferramenta.entrada.safeParse({ comercianteId: randomUUID() }).success).toBe(false);
    expect(ferramenta.entrada.safeParse({ ordenar: "aleatorio" }).success).toBe(false);
    expect(ferramenta.entrada.safeParse({ filtro: "todos", limite: 0 }).success).toBe(false);
    expect(ferramenta.entrada.safeParse({ limite: 11 }).success).toBe(false);
    expect(ferramenta.entrada.safeParse({ limite: 2.5 }).success).toBe(false);
  });

  it("o comerciante que chega à métrica é o da sessão, nunca o do modelo", async () => {
    const { ferramenta, margensDosProdutos } = servico(catalogo);
    const registro = new RegistroFerramentas([ferramenta]);
    const recusa = await registro.executar(contexto, "list_product_margins", {
      comerciante_id: randomUUID(),
    });
    expect(recusa.ok).toBe(false);
    expect(margensDosProdutos).not.toHaveBeenCalled();
    expect((await registro.executar(contexto, "list_product_margins", {})).ok).toBe(true);
    expect(margensDosProdutos.mock.calls).toEqual([[contexto]]);
  });

  it("padrão: todos, da menor para a maior margem, 5 produtos, com o total e a meta", async () => {
    const saida = await executar(catalogo);
    expect(saida.valor).toMatchObject({
      filtro: "todos",
      ordenar: "menor_margem",
      total_que_atendem: 7,
      total_com_margem: 7,
      produtos_sem_dado: 0,
      meta_percentual: 30,
    });
    expect(saida.valor.produtos.map((p) => p.nome)).toEqual(["Leite", "Arroz", "Óleo", "Feijão", "Açúcar"]);
    expect(saida.periodo).toEqual(periodo);
    expect(saida.n_registros).toBe(35);
    expect(saida.menor_confianca).toBe(1);
    expect(saida.origens).toEqual(["planilha"]);
  });

  it("maior_margem inverte a ordem", async () => {
    const saida = await executar(catalogo, { ordenar: "maior_margem", limite: 3 });
    expect(saida.valor.produtos.map((p) => p.nome)).toEqual(["Sal", "Café", "Açúcar"]);
  });

  it("abaixo_da_meta lista só os abaixo e o total conta todos eles, mesmo os que o limite corta", async () => {
    const saida = await executar(catalogo, { filtro: "abaixo_da_meta", limite: 2 });
    expect(saida.valor.total_que_atendem).toBe(4);
    expect(saida.valor.total_com_margem).toBe(7);
    expect(saida.valor.produtos.map((p) => p.nome)).toEqual(["Leite", "Arroz"]);
    expect(saida.valor.produtos.every((p) => p.abaixo_da_meta)).toBe(true);
  });

  it("o limite corta a lista; passar da quantidade existente devolve só o que há", async () => {
    expect((await executar(catalogo, { limite: 1 })).valor.produtos).toHaveLength(1);
    expect((await executar(catalogo, { limite: 10 })).valor.produtos).toHaveLength(7);
  });

  it("empate de margem desempata por nome, sempre na mesma ordem", async () => {
    const empatados = [resultado(margem("Zebra", 2000)), resultado(margem("Abacate", 2000))];
    const a = await executar(empatados);
    const b = await executar([...empatados].reverse());
    expect(a.valor.produtos.map((p) => p.nome)).toEqual(["Abacate", "Zebra"]);
    expect(b.valor.produtos.map((p) => p.nome)).toEqual(["Abacate", "Zebra"]);
  });

  it("meta que varia por produto: meta_percentual nulo e cada linha traz a sua", async () => {
    const saida = await executar([
      resultado(margem("Pão", 2000, { meta_bps: 2500, meta_percentual: 25, abaixo_da_meta: true })),
      resultado(margem("Leite", 2000)),
    ]);
    expect(saida.valor.meta_percentual).toBeNull();
    expect(saida.valor.produtos.map((p) => p.meta_percentual).sort()).toEqual([25, 30]);
  });

  it("produtos sem margem calculada são contados à parte e não entram nos totais", async () => {
    const saida = await executar([
      resultado(margem("Arroz", 2026)),
      dadoAusente("sem_custo", "Sem custo."),
      dadoAusente("sem_venda_na_janela", "Sem venda."),
    ]);
    expect(saida.valor).toMatchObject({ total_com_margem: 1, produtos_sem_dado: 2, total_que_atendem: 1 });
  });

  it("junta a procedência de todos os produtos com margem: pior confiança, origens, registros", async () => {
    const saida = await executar([
      resultado(margem("Arroz", 2026), 0.9, ["planilha"]),
      resultado(margem("Feijão", 2881), 0.6, ["foto_nota"]),
    ]);
    expect(saida).toMatchObject({
      n_registros: 10,
      menor_confianca: 0.6,
      origens: ["foto_nota", "planilha"],
    });
  });

  it("sem meta ou sem produtos devolve dado ausente, não lista vazia", async () => {
    const semMeta = await executar([]);
    expect(semMeta).toMatchObject({ ausente: true, codigo: "sem_meta_de_margem" });
    const semMargem = await executar([dadoAusente("sem_custo", "Sem custo.")]);
    expect(semMargem).toMatchObject({ ausente: true, codigo: "sem_margem_calculavel" });
  });

  it("filtro sem nenhum produto devolve lista vazia com total zero (não é dado ausente)", async () => {
    const saida = await executar([resultado(margem("Café", 4100))], { filtro: "abaixo_da_meta" });
    expect(saida.valor).toMatchObject({ total_que_atendem: 0, total_com_margem: 1, produtos: [] });
  });

  it("regra 8: o total, a meta e a margem da saída autorizam a mensagem; número inventado não", async () => {
    const saida = await executar(catalogo, { filtro: "abaixo_da_meta" });
    const autorizados = new NumerosAutorizados([saida]);
    expect(
      verificarNumeros(
        "4 produtos estão abaixo da meta de 30%. O pior é Leite, com 15% de margem.",
        autorizados,
      ).aprovado,
    ).toBe(true);
    expect(verificarNumeros("47 produtos estão abaixo da meta de 30%.", autorizados).aprovado).toBe(false);
  });
});
