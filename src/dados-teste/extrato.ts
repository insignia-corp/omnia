import { diaDaSemana, intervalo } from "./datas";
import { DATA_REFERENCIA, INICIO_EXTRATO, INICIO_VENDAS } from "./mercadinho";
import { definicoesNotas, somaItensCentavos } from "./notas";
import { Prng } from "./prng";
import type { ItemVenda, Transacao } from "./tipos";

const SEMENTE_EXTRATO = 20261020;

export const GASTO_ANOMALO = {
  data: DATA_REFERENCIA,
  descricao: "PIX ENVIADO CONSERTO CAMARA FRIA",
  categoria: "manutencao",
  valor_centavos: 235_000,
};

/** Categorias fora do cálculo de "gasto fora do padrão": são recorrentes ou já vêm das notas. */
export const CATEGORIAS_FORA_DO_PADRAO = ["fornecedores", "contas_fixas"];

const GASTOS_MIUDOS: [descricao: string, categoria: string, minimo: number, maximo: number][] = [
  ["PIX ENVIADO MATERIAL DE LIMPEZA", "limpeza", 2_500, 9_000],
  ["COMPRA DEBITO SACOLAS PLASTICAS", "embalagens", 3_000, 7_500],
  ["PIX ENVIADO GELO", "insumos", 1_500, 4_500],
  ["COMPRA DEBITO PAPELARIA", "escritorio", 1_200, 6_000],
  ["PIX ENVIADO ENTREGADOR", "frete", 2_000, 8_000],
  ["COMPRA DEBITO COMBUSTIVEL", "transporte", 4_000, 12_000],
];

const CONTAS_FIXAS: [dia: number, descricao: string, valores: number[]][] = [
  [5, "PIX ENVIADO ALUGUEL DO PONTO", [180_000]],
  [10, "BOLETO ENERGIA ELETRICA", [61_240, 68_910]],
  [12, "BOLETO AGUA E ESGOTO", [18_450, 19_230]],
  [15, "DEBITO AUTOMATICO INTERNET", [11_990]],
];

/**
 * Extrato de 60 dias no formato que a integração Pluggy vai gravar: entrada ou saída, valor em
 * centavos positivo, descrição e categoria. As entradas dos dias com vendas fecham exatamente
 * com o faturamento do dia; antes disso são valores sintéticos.
 */
export function gerarExtrato(vendas: readonly ItemVenda[]): Transacao[] {
  const prng = new Prng(SEMENTE_EXTRATO);
  const faturamentoPorDia = new Map<string, number>();
  for (const v of vendas) {
    faturamentoPorDia.set(
      v.data,
      (faturamentoPorDia.get(v.data) ?? 0) + v.quantidade * v.preco_unitario_centavos,
    );
  }
  const transacoes: Omit<Transacao, "id">[] = [];

  for (const data of intervalo(INICIO_EXTRATO, DATA_REFERENCIA)) {
    const fatura =
      faturamentoPorDia.get(data) ??
      (data < INICIO_VENDAS
        ? 95_000 + (diaDaSemana(data) >= 5 ? 35_000 : 0) + prng.inteiro(-8_000, 8_000)
        : 0);
    if (fatura > 0) {
      const pix = Math.floor((fatura * (30 + prng.inteiro(0, 15))) / 100);
      transacoes.push({
        data,
        valor_centavos: pix,
        tipo: "entrada",
        descricao: "PIX RECEBIDO VENDAS",
        categoria: "vendas",
      });
      transacoes.push({
        data,
        valor_centavos: fatura - pix,
        tipo: "entrada",
        descricao: "CREDITO ADQUIRENTE CARTOES",
        categoria: "vendas",
      });
    }

    const nGastos = prng.inteiro(1, 3);
    for (let i = 0; i < nGastos; i++) {
      const [descricao, categoria, minimo, maximo] =
        GASTOS_MIUDOS[prng.inteiro(0, GASTOS_MIUDOS.length - 1)]!;
      transacoes.push({
        data,
        valor_centavos: prng.inteiro(minimo / 10, maximo / 10) * 10,
        tipo: "saida",
        descricao,
        categoria,
      });
    }

    const diaDoMes = Number(data.slice(8));
    for (const [dia, descricao, valores] of CONTAS_FIXAS) {
      if (dia === diaDoMes) {
        const valor = valores[Number(data.slice(5, 7)) % valores.length]!;
        transacoes.push({ data, valor_centavos: valor, tipo: "saida", descricao, categoria: "contas_fixas" });
      }
    }
  }

  for (const n of definicoesNotas) {
    transacoes.push({
      data: n.data,
      valor_centavos: somaItensCentavos(n),
      tipo: "saida",
      descricao: `PIX ENVIADO FORNECEDOR ${n.fornecedor_id} ${n.id.toUpperCase()}`,
      categoria: "fornecedores",
    });
  }

  transacoes.push({
    data: GASTO_ANOMALO.data,
    valor_centavos: GASTO_ANOMALO.valor_centavos,
    tipo: "saida",
    descricao: GASTO_ANOMALO.descricao,
    categoria: GASTO_ANOMALO.categoria,
  });

  const ordenadas = transacoes.sort(
    (a, b) =>
      a.data.localeCompare(b.data) ||
      a.tipo.localeCompare(b.tipo) ||
      a.descricao.localeCompare(b.descricao) ||
      a.valor_centavos - b.valor_centavos,
  );
  return ordenadas.map((t, i) => ({ id: `T${String(i + 1).padStart(4, "0")}`, ...t }));
}
