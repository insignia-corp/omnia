/**
 * Registros que a camada de dados entrega às funções puras de métrica (issue #32). São dados já
 * lidos e somados, sem banco: as janelas, os limites e os desempates ficam nas funções, onde têm
 * teste unitário.
 */
import type { OrigemDado, Procedencia } from "./resultado-metrica";

export interface ProdutoParaMetrica {
  id: string;
  nome: string;
  /** Meta de margem do produto, em bps; nula quando vale a do comerciante. */
  margemMetaBps: number | null;
}

/** Vendas de um produto num dia, somadas por quem leu o banco. `registros` conta as linhas de venda. */
export interface VendaDoProdutoNoDia extends Procedencia {
  data: string;
  produtoId: string;
  quantidade: number;
  receitaCentavos: number;
}

/** Vendas de um dia, somadas por cupom. `registros` conta os cupons. */
export interface VendasDoDia extends Procedencia {
  data: string;
  cupons: number;
  faturamentoCentavos: number;
}

/**
 * Datas entre as quais há dado importado (de vendas ou de movimentos bancários). Dentro do
 * intervalo, dia sem linha é dia sem movimento; fora dele é dia sem dado, que não pode virar zero.
 */
export interface IntervaloDeDados {
  primeira: string;
  ultima: string;
}

/** A última venda de um produto na base até a data. Vale 1 registro: a linha dessa venda. */
export interface UltimaVendaDoProduto extends Procedencia {
  produtoId: string;
  data: string;
}

/** Uma leitura de custo: a linha vigente de `historico_custo` de um item de compra. */
export interface CustoDeCompra {
  produtoId: string;
  fornecedorId: string;
  compraId: string;
  itemDeCompraId: string;
  data: string;
  custoUnitarioCentavos: number;
  /** A menor entre a confiança da leitura do item e a da nota inteira. */
  confianca: number;
  origem: OrigemDado;
  criadoEm: Date;
}

/** Movimento bancário de um dia, somado por conta, sentido e categoria. `registros` conta as transações. */
export interface MovimentoDoDia extends Procedencia {
  contaId: string;
  data: string;
  tipo: "entrada" | "saida";
  categoria: string | null;
  totalCentavos: number;
}

export interface ContaParaMetrica {
  id: string;
  saldoInicialCentavos: number | null;
  /** O saldo inicial vale antes das transações deste dia, que já entram no cálculo. */
  saldoInicialEm: string | null;
}

/**
 * Consulta de vendas por dia que separa "dia sem venda" de "dia sem dado": dentro do intervalo
 * importado, o dia sem linha vale zero cupom; fora dele, a consulta devolve nulo.
 */
export function indexarVendasPorDia(
  vendas: readonly VendasDoDia[],
  intervalo: IntervaloDeDados | null,
): (dia: string) => VendasDoDia | null {
  const porData = new Map(vendas.map((v) => [v.data, v]));
  return (dia) => {
    if (!intervalo || dia < intervalo.primeira || dia > intervalo.ultima) return null;
    return (
      porData.get(dia) ?? {
        data: dia,
        cupons: 0,
        faturamentoCentavos: 0,
        registros: 0,
        menorConfianca: null,
        origens: [],
      }
    );
  };
}

/** Comparação de texto sem depender de localidade, para datas ISO e ids. */
export const compararTexto = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const colador = new Intl.Collator("pt-BR");

/** Ordem alfabética de nomes de produto: "Água" fica junto do A, não depois do Z. */
export const compararNomes = (a: string, b: string): number => colador.compare(a, b);

/** Ordem cronológica das leituras de custo; empate de data desempata por criação e depois por id. */
export function compararCustos(a: CustoDeCompra, b: CustoDeCompra): number {
  return (
    compararTexto(a.data, b.data) ||
    a.criadoEm.getTime() - b.criadoEm.getTime() ||
    compararTexto(a.itemDeCompraId, b.itemDeCompraId)
  );
}

/** A leitura de custo mais recente até a data, de qualquer fornecedor; null quando nunca houve compra. */
export function custoMaisRecente(custos: readonly CustoDeCompra[], ate: string): CustoDeCompra | null {
  let melhor: CustoDeCompra | null = null;
  for (const custo of custos) {
    if (custo.data > ate) continue;
    if (melhor === null || compararCustos(custo, melhor) > 0) melhor = custo;
  }
  return melhor;
}
