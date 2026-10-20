import { formatarDataBr, diaDaSemana, intervalo } from "./datas";
import { catalogo, DATA_REFERENCIA, INICIO_VENDAS, skuPorNome } from "./mercadinho";
import { Prng } from "./prng";
import type { ItemVenda } from "./tipos";

const SEMENTE_VENDAS = 20261019;

/** Vendas por dia da semana (0 = domingo), antes do ruído. */
const VENDAS_POR_DIA_DA_SEMANA = [38, 44, 46, 48, 52, 66, 78];

/** Padrões plantados para exercitar as métricas. */
const SKU_ALTA_DE_GIRO = skuPorNome("Refrigerante Cola 2L");
const INICIO_ALTA_DE_GIRO = "2026-10-13";
const FATOR_ALTA_DE_GIRO = 3;
const SKU_ESTOQUE_PARADO = skuPorNome("Leite em Pó 400g");
const ULTIMO_DIA_ESTOQUE_PARADO = "2026-09-18";
/** Dia com muitas vendas pequenas, que derruba o ticket médio. */
export const DIA_TICKET_BAIXO = DATA_REFERENCIA;

function pesoDoProdutoNoDia(sku: string, peso: number, data: string): number {
  if (sku === SKU_ESTOQUE_PARADO) return data <= ULTIMO_DIA_ESTOQUE_PARADO ? peso * 4 : 0;
  if (sku === SKU_ALTA_DE_GIRO && data >= INICIO_ALTA_DE_GIRO) return peso * FATOR_ALTA_DE_GIRO;
  return peso;
}

export function gerarVendas(): ItemVenda[] {
  const prng = new Prng(SEMENTE_VENDAS);
  const itens: ItemVenda[] = [];
  let numeroVenda = 0;

  for (const data of intervalo(INICIO_VENDAS, DATA_REFERENCIA)) {
    const ticketBaixo = data === DIA_TICKET_BAIXO;
    const base = VENDAS_POR_DIA_DA_SEMANA[diaDaSemana(data)] ?? 50;
    const nVendas = ticketBaixo ? 74 : base + prng.inteiro(-4, 4);
    const pesos = catalogo.map((p) => pesoDoProdutoNoDia(p.sku, p.peso_venda, data));

    const horas = Array.from({ length: nVendas }, () => 7 * 60 + prng.inteiro(0, 13 * 60 + 59)).sort(
      (a, b) => a - b,
    );

    for (const minutoDoDia of horas) {
      numeroVenda += 1;
      const vendaId = `V${String(numeroVenda).padStart(5, "0")}`;
      const hora = `${String(Math.floor(minutoDoDia / 60)).padStart(2, "0")}:${String(minutoDoDia % 60).padStart(2, "0")}`;
      const nLinhas = ticketBaixo
        ? prng.inteiro(1, 2)
        : [1, 2, 3, 4, 5][prng.indicePonderado([3, 4, 3, 2, 1])]!;
      const jaNaVenda = new Set<number>();
      for (let l = 0; l < nLinhas; l++) {
        let indice = prng.indicePonderado(pesos);
        for (let tentativa = 0; jaNaVenda.has(indice) && tentativa < 5; tentativa++) {
          indice = prng.indicePonderado(pesos);
        }
        if (jaNaVenda.has(indice)) continue;
        jaNaVenda.add(indice);
        const produto = catalogo[indice]!;
        const quantidade = ticketBaixo ? 1 : [1, 2, 3][prng.indicePonderado([70, 22, 8])]!;
        itens.push({
          venda_id: vendaId,
          data,
          hora,
          sku: produto.sku,
          quantidade,
          preco_unitario_centavos: produto.preco_venda_centavos,
        });
      }
    }
  }
  return itens;
}

function decimalBr(centavos: number): string {
  return `${Math.floor(centavos / 100)},${String(centavos % 100).padStart(2, "0")}`;
}

/** CSV como um lojista exportaria do caixa: separador ";", vírgula decimal, data dd/mm/aaaa. */
export function vendasParaCsv(itens: readonly ItemVenda[]): string {
  const porSku = new Map(catalogo.map((p) => [p.sku, p]));
  const linhas = itens.map((i) => {
    const p = porSku.get(i.sku)!;
    return [
      formatarDataBr(i.data),
      i.hora,
      i.venda_id,
      p.codigo_barras,
      p.nome,
      String(i.quantidade),
      decimalBr(i.preco_unitario_centavos),
      decimalBr(i.quantidade * i.preco_unitario_centavos),
    ].join(";");
  });
  return (
    ["data;hora;cupom;codigo_barras;produto;quantidade;preco_unitario;total", ...linhas].join("\n") + "\n"
  );
}
