import type { ContaParaMetrica, MovimentoDoDia, VendasDoDia } from "./dados-de-metricas";
import { ehDadoAusente } from "./resultado-metrica";
import { calcularResumoDiario, type EntradaResumoDiario } from "./resumo-diario";

const DIA = "2026-10-19";

const vendasDoDia = (
  data: string,
  faturamentoCentavos: number,
  cupons: number,
  extra: Partial<VendasDoDia> = {},
): VendasDoDia => ({
  data,
  cupons,
  faturamentoCentavos,
  registros: cupons,
  menorConfianca: 1,
  origens: ["planilha"],
  ...extra,
});

const movimento = (
  data: string,
  tipo: "entrada" | "saida",
  totalCentavos: number,
  extra: Partial<MovimentoDoDia> = {},
): MovimentoDoDia => ({
  contaId: "conta-1",
  data,
  tipo,
  categoria: tipo === "entrada" ? "vendas" : "despesa_operacional",
  totalCentavos,
  registros: 1,
  menorConfianca: 1,
  origens: ["banco"],
  ...extra,
});

const conta: ContaParaMetrica = {
  id: "conta-1",
  saldoInicialCentavos: 1_000_000,
  saldoInicialEm: "2026-10-09",
};

// Faturamento: dia 19 R$ 1.000,00 (20 cupons); 18 R$ 800; 17 R$ 1.000; 16 R$ 1.200; 15 R$ 1.100;
// 14 R$ 1.400; 13 R$ 950; 12 R$ 1.250 (mesmo dia da semana). A média dos 7 anteriores é R$ 1.100,00.
const HISTORICO: VendasDoDia[] = [
  vendasDoDia("2026-10-12", 125_000, 25),
  vendasDoDia("2026-10-13", 95_000, 19),
  vendasDoDia("2026-10-14", 140_000, 28),
  vendasDoDia("2026-10-15", 110_000, 22),
  vendasDoDia("2026-10-16", 120_000, 24),
  vendasDoDia("2026-10-17", 100_000, 20),
  vendasDoDia("2026-10-18", 80_000, 16),
  vendasDoDia(DIA, 100_000, 20),
];

const entrada = (extra: Partial<EntradaResumoDiario> = {}): EntradaResumoDiario => ({
  data: DIA,
  vendas: HISTORICO,
  intervaloDeVendas: { primeira: "2026-10-01", ultima: DIA },
  movimentos: [],
  contas: [conta],
  ...extra,
});

function resumo(extra: Partial<EntradaResumoDiario> = {}) {
  const r = calcularResumoDiario(entrada(extra));
  if (ehDadoAusente(r)) throw new Error(`Esperava resumo, veio dado ausente: ${r.codigo}`);
  return r;
}

describe("calcularResumoDiario", () => {
  describe("números do dia", () => {
    it("faturamento, cupons e ticket médio", () => {
      const { valor } = resumo();
      expect(valor).toMatchObject({
        data: DIA,
        faturamento_centavos: 100_000,
        cupons: 20,
        ticket_medio_centavos: 5000,
      });
    });

    it("ticket médio arredonda meio para cima em centavos", () => {
      // R$ 10,00 em 3 cupons: 333,33 centavos.
      const r = resumo({ vendas: [vendasDoDia(DIA, 1000, 3), ...HISTORICO.slice(0, 7)] });
      expect(r.valor.ticket_medio_centavos).toBe(333);
    });

    it("dia de loja aberta sem cupom: faturamento zero e sem ticket médio", () => {
      const r = resumo({ vendas: HISTORICO.slice(0, 7) });
      expect(r.valor).toMatchObject({ faturamento_centavos: 0, cupons: 0, ticket_medio_centavos: null });
    });
  });

  describe("gastos e saldo do dia", () => {
    const movimentos = [
      movimento(DIA, "saida", 30_000, { categoria: "compra_mercadoria" }),
      movimento(DIA, "saida", 5000),
      movimento(DIA, "entrada", 90_000),
      movimento("2026-10-18", "saida", 77_700),
    ];

    it("gastos somam todas as saídas do dia, de qualquer categoria", () => {
      const { valor } = resumo({ movimentos });
      expect(valor.gastos_centavos).toBe(35_000);
      expect(valor.saldo_do_dia_centavos).toBe(65_000); // 1.000,00 - 350,00
    });

    it("sem movimento, gastos zero e saldo do dia igual ao faturamento", () => {
      const { valor } = resumo();
      expect(valor.gastos_centavos).toBe(0);
      expect(valor.saldo_do_dia_centavos).toBe(100_000);
    });
  });

  describe("saldo da conta", () => {
    it("soma o saldo inicial, as entradas e subtrai as saídas até o fim do dia", () => {
      const { valor } = resumo({
        movimentos: [
          movimento("2026-10-09", "entrada", 200_000), // no dia do saldo inicial: entra
          movimento("2026-10-12", "saida", 50_000),
          movimento(DIA, "entrada", 90_000),
          movimento(DIA, "saida", 30_000),
        ],
      });
      expect(valor.saldo_da_conta).toEqual({ saldo_centavos: 1_210_000 });
    });

    it("ignora transação anterior ao saldo inicial e posterior ao dia", () => {
      const { valor } = resumo({
        movimentos: [movimento("2026-10-08", "saida", 999_999), movimento("2026-10-20", "saida", 999_999)],
      });
      expect(valor.saldo_da_conta).toEqual({ saldo_centavos: 1_000_000 });
    });

    it("soma as contas, cada uma com seu saldo inicial", () => {
      const { valor } = resumo({
        contas: [conta, { id: "conta-2", saldoInicialCentavos: 500_000, saldoInicialEm: "2026-10-15" }],
        movimentos: [
          movimento("2026-10-16", "entrada", 10_000, { contaId: "conta-2" }),
          movimento("2026-10-16", "saida", 4000),
        ],
      });
      expect(valor.saldo_da_conta).toEqual({ saldo_centavos: 1_000_000 - 4000 + 500_000 + 10_000 });
    });

    it("conta aberta depois da data não entra; sem nenhuma conta na data, o saldo é ausente", () => {
      const nova = { id: "conta-2", saldoInicialCentavos: 500_000, saldoInicialEm: "2026-10-25" };
      expect(resumo({ contas: [conta, nova] }).valor.saldo_da_conta).toEqual({ saldo_centavos: 1_000_000 });
      expect(resumo({ contas: [nova] }).valor.saldo_da_conta).toMatchObject({
        ausente: true,
        codigo: "conta_posterior_a_data",
      });
    });

    it("conta aberta depois da data sem saldo inicial não bloqueia o saldo das outras", () => {
      const nova = { id: "conta-2", saldoInicialCentavos: null, saldoInicialEm: "2026-10-25" };
      expect(resumo({ contas: [conta, nova] }).valor.saldo_da_conta).toEqual({ saldo_centavos: 1_000_000 });
      expect(resumo({ contas: [nova] }).valor.saldo_da_conta).toMatchObject({
        ausente: true,
        codigo: "conta_posterior_a_data",
      });
    });

    it("sem conta conectada o saldo é ausente, mas o resto do resumo sai", () => {
      const { valor } = resumo({ contas: [] });
      expect(valor.saldo_da_conta).toMatchObject({ ausente: true, codigo: "sem_conta" });
      expect(valor.faturamento_centavos).toBe(100_000);
    });

    it("conta sem saldo inicial deixa o saldo ausente em vez de chutar", () => {
      const { valor } = resumo({ contas: [{ ...conta, saldoInicialCentavos: null }] });
      expect(valor.saldo_da_conta).toMatchObject({ ausente: true, codigo: "sem_saldo_inicial" });
    });
  });

  describe("comparação do faturamento", () => {
    it("contra o dia anterior: R$ 1.000,00 sobre R$ 800,00 é +25%", () => {
      expect(resumo().valor.comparacao_faturamento.dia_anterior).toEqual({
        data: "2026-10-18",
        base_centavos: 80_000,
        variacao_bps: 2500,
        variacao_percentual: 25,
      });
    });

    it("contra o mesmo dia da semana anterior: R$ 1.000,00 sobre R$ 1.250,00 é -20%", () => {
      expect(resumo().valor.comparacao_faturamento.mesmo_dia_semana_anterior).toEqual({
        data: "2026-10-12",
        base_centavos: 125_000,
        variacao_bps: -2000,
        variacao_percentual: -20,
      });
    });

    it("contra a média dos 7 dias anteriores: R$ 1.000,00 sobre R$ 1.100,00 é -9,09%", () => {
      expect(resumo().valor.comparacao_faturamento.media_7_dias_anteriores).toEqual({
        data: null,
        base_centavos: 110_000,
        variacao_bps: -909,
        variacao_percentual: -9.09,
      });
    });

    it("a média arredonda meio para cima em centavos", () => {
      // Os 7 dias anteriores somam 700.001 centavos: média 100.000,14, que arredonda para 100.000.
      const vendas = [
        vendasDoDia(DIA, 100_000, 20),
        vendasDoDia("2026-10-18", 100_001, 20),
        ...[17, 16, 15, 14, 13, 12].map((d) => vendasDoDia(`2026-10-${d}`, 100_000, 20)),
      ];
      expect(resumo({ vendas }).valor.comparacao_faturamento.media_7_dias_anteriores).toMatchObject({
        base_centavos: 100_000,
      });
    });

    it("base zero (loja fechada) não tem variação, mas mostra a base", () => {
      const vendas = HISTORICO.filter((v) => v.data !== "2026-10-18");
      expect(resumo({ vendas }).valor.comparacao_faturamento.dia_anterior).toEqual({
        data: "2026-10-18",
        base_centavos: 0,
        variacao_bps: null,
        variacao_percentual: null,
      });
    });

    it("dia anterior fora do intervalo importado é ausente, não zero", () => {
      const { valor } = resumo({ intervaloDeVendas: { primeira: DIA, ultima: DIA } });
      expect(valor.comparacao_faturamento.dia_anterior).toMatchObject({
        ausente: true,
        codigo: "base_sem_dados",
      });
      expect(valor.comparacao_faturamento.mesmo_dia_semana_anterior).toMatchObject({ ausente: true });
    });

    it("a média exige os 7 dias: com menos, é ausente", () => {
      const { valor } = resumo({ intervaloDeVendas: { primeira: "2026-10-14", ultima: DIA } });
      expect(valor.comparacao_faturamento.media_7_dias_anteriores).toMatchObject({
        ausente: true,
        codigo: "historico_insuficiente",
      });
      expect(valor.comparacao_faturamento.dia_anterior).toMatchObject({ base_centavos: 80_000 });
    });
  });

  describe("dia sem dados", () => {
    it("data depois da última venda importada: ausente, com pedido da planilha", () => {
      const r = calcularResumoDiario(entrada({ data: "2026-10-20" }));
      expect(r).toMatchObject({
        ausente: true,
        codigo: "dia_sem_dados",
        pergunta_sugerida: "Pode enviar a planilha de vendas mais recente?",
      });
    });

    it("data antes da primeira venda importada: ausente", () => {
      const r = calcularResumoDiario(entrada({ data: "2026-09-30" }));
      expect(r).toMatchObject({ ausente: true, codigo: "dia_sem_dados" });
    });

    it("sem nenhuma venda importada: ausente", () => {
      expect(calcularResumoDiario(entrada({ vendas: [], intervaloDeVendas: null }))).toMatchObject({
        ausente: true,
        codigo: "dia_sem_dados",
      });
    });
  });

  describe("procedência dos dados", () => {
    it("período vai de 7 dias antes até o dia", () => {
      expect(resumo().periodo).toEqual({ inicio: "2026-10-12", fim: DIA });
    });

    it("conta cupons e transações usados, herda a menor confiança e junta as origens", () => {
      const r = resumo({
        vendas: [...HISTORICO.slice(0, 7), vendasDoDia(DIA, 100_000, 20, { menorConfianca: 0.8 })],
        movimentos: [
          movimento(DIA, "saida", 5000),
          movimento("2026-10-12", "entrada", 1000, { menorConfianca: 0.6 }),
        ],
      });
      // Cupons: 20 do dia + 16 + 20 + 24 + 22 + 28 + 19 + 25 dos 7 anteriores, mais 2 transações.
      // O dia anterior e o mesmo dia da semana anterior entram na média; não contam duas vezes.
      expect(r.n_registros).toBe(20 + 16 + 20 + 24 + 22 + 28 + 19 + 25 + 2);
      expect(r.menor_confianca).toBe(0.6);
      expect(r.origens).toEqual(["banco", "planilha"]);
    });
  });
});
