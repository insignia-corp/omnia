import ExcelJS from "exceljs";
import JSZip from "jszip";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CUPONS_POR_DIA,
  DATA_REFERENCIA,
  DIAS_DE_TICKET,
  INICIO_JANELA,
  ITENS_POR_CUPOM_MEDIA,
  PRODUTOS,
  SEMANA_FATOR,
  SEMENTE,
} from "./dados-base";
import type { ProdutoFixture } from "./mercadinho";
import {
  Aleatorio,
  DIR_MERCADINHO,
  dataBr,
  decimalBr,
  diaDaSemana,
  escreverTexto,
  intervaloDeDatas,
  somarDias,
} from "./lib/util";

export interface ItemCupom {
  produtoId: string;
  quantidade: number;
  precoUnitarioCentavos: number;
}

export interface Cupom {
  numero: number;
  data: string;
  hora: string;
  itens: ItemCupom[];
}

const PESO_HORA: ReadonlyArray<readonly [hora: number, peso: number]> = [
  [7, 1],
  [8, 2],
  [9, 2],
  [10, 2],
  [11, 3],
  [12, 4],
  [13, 3],
  [14, 2],
  [15, 2],
  [16, 3],
  [17, 5],
  [18, 7],
  [19, 6],
  [20, 4],
  [21, 2],
];
const PESO_HORA_TOTAL = PESO_HORA.reduce((soma, [, peso]) => soma + peso, 0);

export function montarVendas(catalogo: readonly ProdutoFixture[]): Cupom[] {
  const precoPorId = new Map(catalogo.map((c) => [c.id, c.preco_venda_centavos]));
  const aleatorio = new Aleatorio(SEMENTE);
  const pesoBase = PRODUTOS.reduce((soma, produto) => soma + produto.demanda, 0);
  const inicioAlta = somarDias(DATA_REFERENCIA, -6);
  const cupons: Cupom[] = [];
  let numero = 100_001;

  for (const data of intervaloDeDatas(INICIO_JANELA, DATA_REFERENCIA)) {
    const pesos = PRODUTOS.map((produto) => {
      if (produto.vende_ate && data > produto.vende_ate) return 0;
      const alta = produto.alta_ultimos_7_dias && data >= inicioAlta ? produto.alta_ultimos_7_dias : 1;
      return produto.demanda * alta;
    });
    const pesoDoDia = pesos.reduce((soma, peso) => soma + peso, 0);
    const ticket = DIAS_DE_TICKET[data] ?? { itensPorCupom: ITENS_POR_CUPOM_MEDIA, fatorCupons: 1 };
    const esperados =
      CUPONS_POR_DIA * (SEMANA_FATOR[diaDaSemana(data)] ?? 1) * ticket.fatorCupons * (pesoDoDia / pesoBase);
    const quantidadeDeCupons = aleatorio.poisson(esperados);

    const doDia: Cupom[] = [];
    for (let i = 0; i < quantidadeDeCupons; i++) {
      const linhas = new Map<string, number>();
      const itens = 1 + aleatorio.poisson(ticket.itensPorCupom - 1);
      for (let j = 0; j < itens; j++) {
        const produto = PRODUTOS[aleatorio.ponderado(pesos, pesoDoDia)];
        if (!produto) continue;
        const sorteio = aleatorio.proximo();
        const quantidade = sorteio < 0.85 ? 1 : sorteio < 0.97 ? 2 : 3;
        linhas.set(produto.id, (linhas.get(produto.id) ?? 0) + quantidade);
      }
      const hora =
        PESO_HORA[
          aleatorio.ponderado(
            PESO_HORA.map(([, peso]) => peso),
            PESO_HORA_TOTAL,
          )
        ]?.[0] ?? 12;
      const minuto = aleatorio.inteiro(0, 59);
      doDia.push({
        numero: 0,
        data,
        hora: `${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}`,
        itens: [...linhas].map(([produtoId, quantidade]) => ({
          produtoId,
          quantidade,
          precoUnitarioCentavos: precoPorId.get(produtoId) ?? 0,
        })),
      });
    }
    doDia.sort((a, b) => a.hora.localeCompare(b.hora));
    for (const cupom of doDia) {
      cupom.numero = numero++;
      cupons.push(cupom);
    }
  }
  return cupons;
}

const CABECALHO = [
  "Data",
  "Hora",
  "Cupom",
  "Código de barras",
  "Produto",
  "Qtd",
  "Preço unit. (R$)",
  "Total (R$)",
];

/** Uma linha por item de cupom, como um PDV exportaria. */
export function montarVendasCsv(cupons: readonly Cupom[], catalogo: readonly ProdutoFixture[]): string {
  const porId = new Map(catalogo.map((c) => [c.id, c]));
  const linhas = [CABECALHO.join(";")];
  for (const cupom of cupons) {
    for (const item of cupom.itens) {
      const produto = porId.get(item.produtoId);
      linhas.push(
        [
          dataBr(cupom.data),
          cupom.hora,
          cupom.numero,
          produto?.codigo_barras ?? "",
          produto?.nome ?? "",
          item.quantidade,
          decimalBr(item.precoUnitarioCentavos),
          decimalBr(item.precoUnitarioCentavos * item.quantidade),
        ].join(";"),
      );
    }
  }
  return `${linhas.join("\n")}\n`;
}

export function escreverVendasCsv(cupons: readonly Cupom[], catalogo: readonly ProdutoFixture[]): void {
  escreverTexto(resolve(DIR_MERCADINHO, "vendas.csv"), montarVendasCsv(cupons, catalogo));
}

export async function escreverVendasXlsx(
  cupons: readonly Cupom[],
  catalogo: readonly ProdutoFixture[],
): Promise<void> {
  const porId = new Map(catalogo.map((c) => [c.id, c]));
  const livro = new ExcelJS.Workbook();
  // Datas fixas nas propriedades: sem isso o arquivo muda a cada execução.
  const fixa = new Date(`${DATA_REFERENCIA}T00:00:00Z`);
  livro.creator = "Omnia fixtures";
  livro.lastModifiedBy = "Omnia fixtures";
  livro.created = fixa;
  livro.modified = fixa;
  const planilha = livro.addWorksheet("Vendas");
  planilha.addRow(CABECALHO);
  for (const cupom of cupons) {
    for (const item of cupom.itens) {
      const produto = porId.get(item.produtoId);
      planilha.addRow([
        new Date(`${cupom.data}T00:00:00Z`),
        cupom.hora,
        cupom.numero,
        produto?.codigo_barras ?? "",
        produto?.nome ?? "",
        item.quantidade,
        item.precoUnitarioCentavos / 100,
        (item.precoUnitarioCentavos * item.quantidade) / 100,
      ]);
    }
  }
  planilha.getColumn(1).numFmt = "dd/mm/yyyy";
  planilha.getColumn(7).numFmt = "0.00";
  planilha.getColumn(8).numFmt = "0.00";
  planilha.getRow(1).font = { bold: true };
  const bruto = await livro.xlsx.writeBuffer();
  // O zip carrega a hora de gravação de cada entrada: regrava com data fixa para a saída ser idêntica.
  const original = await JSZip.loadAsync(bruto);
  const reempacotado = new JSZip();
  for (const nome of Object.keys(original.files).sort()) {
    const entrada = original.files[nome];
    if (!entrada || entrada.dir) continue;
    reempacotado.file(nome, await entrada.async("nodebuffer"), { date: fixa, createFolders: false });
  }
  const saida = await reempacotado.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  writeFileSync(resolve(DIR_MERCADINHO, "vendas.xlsx"), saida);
}
