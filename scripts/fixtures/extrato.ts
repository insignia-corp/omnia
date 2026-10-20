import { resolve } from "node:path";
import { DATA_REFERENCIA, INICIO_JANELA, SEMENTE } from "./dados-base";
import type { Cupom } from "./vendas";
import type { NotaFixture } from "./notas";
import { Aleatorio, DIR_MERCADINHO, escreverTexto, intervaloDeDatas } from "./lib/util";

export interface Transacao {
  id: string;
  data: string;
  descricao: string;
  valor_centavos: number;
  tipo: "entrada" | "saida";
  /** vendas | compra_mercadoria | despesa_fixa | despesa_operacional */
  categoria: string;
}

const DESPESAS_OPERACIONAIS = [
  "PIX GAS DE COZINHA",
  "PIX MATERIAL DE LIMPEZA",
  "PIX SACOLAS PLASTICAS",
  "PIX ENTREGA MOTOBOY",
  "PIX LANCHE EQUIPE",
  "PIX BOBINA DE CUPOM",
];

/** Despesas fixas por dia do mês: [descrição, valor por mês de referência]. */
const DESPESAS_FIXAS: ReadonlyArray<{
  dia: number;
  descricao: string;
  valores: Readonly<Record<string, number>>;
}> = [
  { dia: 5, descricao: "PIX ALUGUEL IMOVEL COMERCIAL", valores: { "*": 280_000 } },
  { dia: 5, descricao: "PIX FOLHA SALARIOS FUNCIONARIOS", valores: { "*": 380_000 } },
  { dia: 8, descricao: "DEB INTERNET FIBRA EMPRESARIAL", valores: { "*": 9_990 } },
  { dia: 10, descricao: "DEB ENERGIA ELETRICA", valores: { "2026-09": 61_230, "2026-10": 66_480 } },
  { dia: 12, descricao: "DEB AGUA E ESGOTO", valores: { "2026-09": 18_740, "2026-10": 19_360 } },
  { dia: 20, descricao: "DAS SIMPLES NACIONAL", valores: { "2026-08": 48_210, "2026-09": 51_030 } },
];

/** PLANTADO: gasto operacional muito acima do padrão no dia de referência. */
export const DIA_GASTO_ANORMAL = "2026-10-19";
/** Chamariz: dia caro, mas ainda dentro do padrão (desvio robusto abaixo de 3). */
export const DIA_GASTO_CHAMARIZ = "2026-09-17";
const GASTO_ANORMAL_CENTAVOS = 98_000;
const GASTO_CHAMARIZ_TOTAL_CENTAVOS = 10_100;

/**
 * Extrato da conta PJ de teste. O faturamento do dia entra como um depósito único (cartão e PIX
 * liquidados no mesmo dia, simplificação), as compras saem pelo total impresso da nota.
 */
export function montarExtrato(cupons: readonly Cupom[], notas: readonly NotaFixture[]): Transacao[] {
  const aleatorio = new Aleatorio(SEMENTE + 1);
  const faturamentoPorDia = new Map<string, number>();
  for (const cupom of cupons) {
    const total = cupom.itens.reduce((s, i) => s + i.precoUnitarioCentavos * i.quantidade, 0);
    faturamentoPorDia.set(cupom.data, (faturamentoPorDia.get(cupom.data) ?? 0) + total);
  }
  const notasPorDia = new Map<string, NotaFixture[]>();
  for (const nota of notas)
    notasPorDia.set(nota.base.data, [...(notasPorDia.get(nota.base.data) ?? []), nota]);

  const transacoes: Omit<Transacao, "id">[] = [];
  for (const data of intervaloDeDatas(INICIO_JANELA, DATA_REFERENCIA)) {
    transacoes.push({
      data,
      descricao: "DEPOSITO VENDAS DO DIA",
      valor_centavos: faturamentoPorDia.get(data) ?? 0,
      tipo: "entrada",
      categoria: "vendas",
    });
    for (const nota of notasPorDia.get(data) ?? []) {
      transacoes.push({
        data,
        descricao: `PIX ${nota.esperado.fornecedor.nome.toUpperCase()}`,
        valor_centavos: nota.esperado.total_centavos,
        tipo: "saida",
        categoria: "compra_mercadoria",
      });
    }
    const dia = Number(data.slice(8, 10));
    for (const fixa of DESPESAS_FIXAS) {
      if (fixa.dia !== dia) continue;
      const valor = fixa.valores[data.slice(0, 7)] ?? fixa.valores["*"];
      if (valor) {
        transacoes.push({
          data,
          descricao: fixa.descricao,
          valor_centavos: valor,
          tipo: "saida",
          categoria: "despesa_fixa",
        });
      }
    }

    // Despesas operacionais diárias: total entre R$ 30 e R$ 90, dividido em 1 a 3 lançamentos.
    const total =
      data === DIA_GASTO_CHAMARIZ ? GASTO_CHAMARIZ_TOTAL_CENTAVOS : aleatorio.inteiro(3_000, 9_000);
    const partes = aleatorio.inteiro(1, 3);
    let restante = total;
    for (let i = 0; i < partes; i++) {
      const valor = i === partes - 1 ? restante : Math.round(restante / (partes - i));
      restante -= valor;
      const descricao =
        DESPESAS_OPERACIONAIS[aleatorio.inteiro(0, DESPESAS_OPERACIONAIS.length - 1)] ?? "PIX DIVERSOS";
      transacoes.push({
        data,
        descricao,
        valor_centavos: valor,
        tipo: "saida",
        categoria: "despesa_operacional",
      });
    }
    if (data === DIA_GASTO_ANORMAL) {
      transacoes.push({
        data,
        descricao: "PIX MANUTENCAO CAMARA FRIA",
        valor_centavos: GASTO_ANORMAL_CENTAVOS,
        tipo: "saida",
        categoria: "despesa_operacional",
      });
    }
  }
  return transacoes.map((t, indice) => ({ id: `T${String(indice + 1).padStart(4, "0")}`, ...t }));
}

export function escreverExtrato(transacoes: readonly Transacao[]): void {
  const linhas = ["id;data;descricao;valor_centavos;tipo;categoria"];
  for (const t of transacoes)
    linhas.push([t.id, t.data, t.descricao, t.valor_centavos, t.tipo, t.categoria].join(";"));
  escreverTexto(resolve(DIR_MERCADINHO, "extrato.csv"), `${linhas.join("\n")}\n`);
}
