import { createHash } from "node:crypto";
import { completarCnpj } from "../../src/lib/cnpj/cnpj";
import { intervaloDeDatas, somarDias } from "../../src/lib/datas/datas";
import { dividirArredondando } from "../../src/metricas/pontos-base";
import { uuidDeterministico } from "../../src/infra/database/seed/uuid-deterministico";

export const DATA_DEMO = "2026-10-24";
export const INICIO_VENDAS = "2026-09-01";
export const FIM_VENDAS = "2026-10-23";
export const idPitch = (tipo: string, chave = "") => uuidDeterministico(`bom-preco/${tipo}/${chave}`);
export const COMERCIANTE_PITCH = idPitch("comerciante");
export const FORNECEDOR_PITCH = {
  nome: "Distribuidora São Jorge",
  cnpj: completarCnpj("827364910001"),
};

/** Preço e custo em centavos; demanda é o número de unidades de uma semana-base. */
const BASE: Array<[string, string, string, number, number, number]> = [
  ["cerveja", "Cerveja pilsen lata 350ml", "CERVEJA PILSEN LT 350ML", 399, 269, 630],
  ["leite", "Leite integral 1L", "LEITE INTEGRAL 1L", 499, 349, 490],
  ["agua", "Água mineral 1,5L", "AGUA MINERAL 1,5L", 249, 159, 420],
  ["arroz", "Arroz tipo 1 5kg", "ARROZ TIPO 1 5KG", 2990, 2290, 105],
  ["cafe", "Café torrado 500g", "CAFE TORRADO 500G", 2490, 1690, 70],
  ["feijao", "Feijão carioca 1kg", "FEIJAO CARIOCA 1KG", 899, 629, 140],
  ["macarrao", "Macarrão espaguete 500g", "MACARRAO ESPAGUETE 500G", 499, 339, 140],
  ["acucar", "Açúcar refinado 1kg", "ACUCAR REFINADO 1KG", 449, 309, 140],
  ["oleo", "Óleo de soja 900ml", "OLEO DE SOJA 900ML", 749, 620, 154],
  ["achocolatado", "Achocolatado 400g", "ACHOCOLATADO 400G", 899, 619, 56],
  ["sabao", "Sabão em pó 1,6kg", "SABAO EM PO 1,6KG", 1990, 1349, 35],
  ["biscoito", "Biscoito recheado 130g", "BISCOITO RECHEADO 130G", 299, 199, 105],
  ["vinagre", "Vinagre de álcool 750ml", "VINAGRE ALCOOL 750ML", 299, 199, 21],
  ["farinha", "Farinha de trigo 1kg", "FARINHA TRIGO 1KG", 549, 369, 56],
  ["sal", "Sal refinado 1kg", "SAL REFINADO 1KG", 249, 169, 49],
  ["mandioca", "Farinha de mandioca 500g", "FARINHA MANDIOCA 500G", 699, 489, 35],
  ["molho", "Molho de tomate 300g", "MOLHO TOMATE 300G", 249, 169, 98],
  ["sardinha", "Sardinha em lata 125g", "SARDINHA LATA 125G", 649, 449, 42],
  ["milho", "Milho verde 170g", "MILHO VERDE 170G", 399, 279, 42],
  ["manteiga", "Manteiga 200g", "MANTEIGA 200G", 1290, 899, 35],
  ["margarina", "Margarina 500g", "MARGARINA 500G", 649, 449, 56],
  ["ovos", "Ovos brancos dúzia", "OVOS BRANCOS DZ", 1299, 899, 70],
  ["refrigerante", "Refrigerante cola 2L", "REFRIGERANTE COLA 2L", 899, 629, 105],
  ["detergente", "Detergente neutro 500ml", "DETERGENTE 500ML", 249, 169, 70],
  ["sabonete", "Sabonete 85g", "SABONETE 85G", 299, 199, 56],
  ["papel", "Papel higiênico 12 rolos", "PAPEL HIGIENICO 12RL", 1490, 1039, 35],
  ["creme", "Creme dental 90g", "CREME DENTAL 90G", 599, 419, 35],
  ["sanitaria", "Água sanitária 1L", "AGUA SANITARIA 1L", 449, 309, 49],
  ["pao", "Pão de forma 450g", "PAO DE FORMA 450G", 749, 519, 70],
];

function codigoBarras(indice: number): string {
  const base = `299${String(indice + 1).padStart(9, "0")}`;
  const soma = [...base].reduce((s, n, i) => s + Number(n) * (i % 2 === 0 ? 1 : 3), 0);
  return base + ((10 - (soma % 10)) % 10);
}

export const CATALOGO_PITCH = BASE.map(([chave, nome, descricao, preco, custo, unidades], i) => ({
  chave,
  nome,
  descricao,
  preco_centavos: preco,
  custo_centavos: custo,
  unidades_semana: unidades,
  codigo_barras: codigoBarras(i),
  produto_id: idPitch("produto", chave),
}));
export type ProdutoPitch = (typeof CATALOGO_PITCH)[number];
export interface VendaPitch {
  data: string;
  cupom: string;
  itens: Array<{ produto: ProdutoPitch; quantidade: number }>;
  total_centavos: number;
}

export function csvVendasPitch(vendas: VendaPitch[]): string {
  return (
    [
      "data;cupom;codigo_barras;produto;quantidade;preco_unitario_centavos;total_centavos",
      ...vendas.flatMap((v) =>
        v.itens.map((i) =>
          [
            v.data,
            v.cupom,
            i.produto.codigo_barras,
            i.produto.nome,
            i.quantidade,
            i.produto.preco_centavos,
            i.quantidade * i.produto.preco_centavos,
          ].join(";"),
        ),
      ),
    ].join("\n") + "\n"
  );
}

const QUEDAS = new Set(["achocolatado", "sabao", "biscoito"]);
/** Domingo a sábado, conforme o roteiro. */
export const PESOS_DA_SEMANA = [0.95, 0.8, 0.85, 0.9, 0.95, 1.2, 1.35];

function distribuir(total: number, pesos: number[]): number[] {
  const soma = pesos.reduce((s, p) => s + p, 0);
  if (soma === 0) return pesos.map(() => 0);
  const exatos = pesos.map((p) => (total * p) / soma);
  const inteiros = exatos.map(Math.floor);
  const ordem = exatos
    .map((p, i) => ({ i, resto: p - inteiros[i]! }))
    .sort((a, b) => b.resto - a.resto || a.i - b.i);
  for (let n = total - inteiros.reduce((s, p) => s + p, 0), i = 0; i < n; i++) inteiros[ordem[i]!.i]!++;
  return inteiros;
}

/** Quantidades inteiras e preços de catálogo: cada cupom fecha exatamente com seus itens. */
export function gerarVendasPitch(): VendaPitch[] {
  const valorBase = CATALOGO_PITCH.filter((p) => p.chave !== "vinagre").reduce(
    (s, p) => s + p.preco_centavos * p.unidades_semana,
    0,
  );
  const escala = 2_110_000 / valorBase;
  const unidadesBase = CATALOGO_PITCH.map((p) => Math.max(7, Math.round(p.unidades_semana * escala)));
  const receitaBase = CATALOGO_PITCH.reduce(
    (s, p, i) => s + (p.chave === "vinagre" ? 0 : p.preco_centavos * unidadesBase[i]!),
    0,
  );
  const receitaQuedas = CATALOGO_PITCH.reduce(
    (s, p, i) => s + (QUEDAS.has(p.chave) ? p.preco_centavos * unidadesBase[i]! : 0),
    0,
  );
  const crescimentoOutros = (receitaBase * 104 - receitaQuedas * 55) / (100 * (receitaBase - receitaQuedas));
  const vendas: VendaPitch[] = [];
  // Semanas de sábado a sexta, incluindo a semana parcial que começa em agosto.
  for (let inicio = "2026-08-29"; inicio <= FIM_VENDAS; inicio = somarDias(inicio, 7)) {
    const ultima = inicio === "2026-10-17";
    const datas = intervaloDeDatas(inicio, somarDias(inicio, 6));
    const totais = CATALOGO_PITCH.map((p, i) =>
      Math.round(unidadesBase[i]! * (ultima ? (QUEDAS.has(p.chave) ? 0.55 : crescimentoOutros) : 1)),
    );
    const receitaSemana = CATALOGO_PITCH.reduce(
      (s, p, i) => s + (p.chave === "vinagre" ? 0 : p.preco_centavos * totais[i]!),
      0,
    );
    const alvoSexta = ultima ? 415_000 : 370_000;
    const pesos = datas.map((data) => {
      const dia = new Date(`${data}T12:00:00Z`).getUTCDay();
      return dia === 5 ? alvoSexta : (PESOS_DA_SEMANA[dia]! * (receitaSemana - alvoSexta)) / 5.8;
    });
    const porProduto = CATALOGO_PITCH.map((p, i) =>
      distribuir(
        totais[i]!,
        datas.map((data, d) => (p.chave === "vinagre" && data > "2026-10-08" ? 0 : pesos[d]!)),
      ),
    );
    // Depois de 08/10 o vinagre não vende; não redistribuir uma semana inteiramente vazia.
    for (const [d, data] of datas.entries()) {
      if (data < INICIO_VENDAS || data > FIM_VENDAS) continue;
      const unidades = CATALOGO_PITCH.flatMap((p, i) =>
        Array.from(
          { length: p.chave === "vinagre" && data > "2026-10-08" ? 0 : (porProduto[i]![d] ?? 0) },
          () => p,
        ),
      );
      const total = unidades.reduce((s, p) => s + p.preco_centavos, 0);
      const ticket =
        data === FIM_VENDAS
          ? 3010
          : data.endsWith("10-02") || data.endsWith("10-09") || data.endsWith("10-16")
            ? 2840
            : 2800;
      const cupons = Math.round(total / ticket);
      const cestas = Array.from({ length: cupons }, (_, i): VendaPitch => ({
        data,
        cupom: `P${data.replaceAll("-", "")}-${String(i + 1).padStart(3, "0")}`,
        itens: [],
        total_centavos: 0,
      }));
      // Distribuição balanceada: compras pequenas, sem cupom vazio ou total artificial.
      for (const p of unidades.sort(
        (a, b) => b.preco_centavos - a.preco_centavos || a.chave.localeCompare(b.chave),
      )) {
        const cesta = cestas.reduce((a, b) => (a.total_centavos <= b.total_centavos ? a : b));
        const item = cesta.itens.find((i) => i.produto.chave === p.chave);
        if (item) item.quantidade++;
        else cesta.itens.push({ produto: p, quantidade: 1 });
        cesta.total_centavos += p.preco_centavos;
      }
      vendas.push(...cestas);
    }
  }
  return vendas;
}

export function montarNotaPitch(data: string, chaves: string[], cafeNovo = false) {
  const itens = chaves.map((chave) => {
    const p = CATALOGO_PITCH.find((p) => p.chave === chave)!;
    const custo =
      chave === "cafe" && cafeNovo
        ? 1870
        : chave === "arroz" && data >= "2026-10-20"
          ? 2540
          : p.custo_centavos;
    const quantidade = chave === "cafe" ? 12 : 24;
    return {
      descricao: p.descricao,
      quantidade,
      unidade: "UN",
      valor_unitario_centavos: custo,
      valor_total_centavos: custo * quantidade,
      confianca: 1,
    };
  });
  return {
    fornecedor: FORNECEDOR_PITCH,
    data_emissao: data,
    itens,
    total_centavos: itens.reduce((s, i) => s + i.valor_total_centavos, 0),
    confianca_documento: 1,
  };
}

export const NOTA_VIDEO = montarNotaPitch(FIM_VENDAS, ["feijao", "macarrao", "acucar", "cafe"], true);
export const NOTAS_ANTERIORES = [
  { chave: "catalogo", data: "2026-09-01", produtos: CATALOGO_PITCH.map((p) => p.chave) },
  { chave: "sao-jorge", data: "2026-10-16", produtos: ["cafe", "feijao", "macarrao", "acucar"] },
  { chave: "arroz-anterior", data: "2026-10-13", produtos: ["arroz"] },
  { chave: "arroz-reajuste", data: "2026-10-20", produtos: ["arroz"] },
].map((n) => ({ ...n, extracao: montarNotaPitch(n.data, n.produtos) }));

export const hashPitch = (conteudo: string | Buffer) => createHash("sha256").update(conteudo).digest("hex");
export function resumirVendasPitch(vendas: VendaPitch[]) {
  return intervaloDeDatas(INICIO_VENDAS, FIM_VENDAS).map((data) => {
    const dia = vendas.filter((v) => v.data === data);
    const faturamento_centavos = dia.reduce((s, v) => s + v.total_centavos, 0);
    return {
      data,
      faturamento_centavos,
      vendas: dia.length,
      ticket_medio_centavos: dividirArredondando(faturamento_centavos, dia.length),
    };
  });
}
