import { intervaloDeDatas, somarDias } from "../lib/datas/datas";
import type { VendasDoDia } from "./dados-de-metricas";
import { ehDadoAusente } from "./resultado-metrica";
import { calcularTicketMedio, PARAMETROS_TICKET_MEDIO, type EntradaTicketMedio } from "./ticket-medio";

const DIA = "2026-10-19";
const PRIMEIRO_DIA_DA_BASE = somarDias(DIA, -28); // 2026-09-21
const DATAS_DA_BASE = intervaloDeDatas(PRIMEIRO_DIA_DA_BASE, somarDias(DIA, -1));

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

/** Os 28 dias anteriores, todos com o mesmo faturamento e o mesmo número de cupons. */
const base = (faturamento: number, cupons: number): VendasDoDia[] =>
  DATAS_DA_BASE.map((d) => vendasDoDia(d, faturamento, cupons));

const entrada = (extra: Partial<EntradaTicketMedio> = {}): EntradaTicketMedio => ({
  data: DIA,
  vendas: [...base(100_000, 20), vendasDoDia(DIA, 70_000, 20)],
  intervaloDeVendas: { primeira: PRIMEIRO_DIA_DA_BASE, ultima: DIA },
  ...extra,
});

function ticket(extra: Partial<EntradaTicketMedio> = {}) {
  const r = calcularTicketMedio(entrada(extra));
  if (ehDadoAusente(r)) throw new Error(`Esperava ticket médio, veio dado ausente: ${r.codigo}`);
  return r;
}

describe("calcularTicketMedio", () => {
  it("compara o ticket do dia com a média dos 28 dias anteriores", () => {
    // Base: R$ 1.000,00 em 20 cupons por dia, ticket de R$ 50,00. Dia: R$ 700,00 em 20 cupons, R$ 35,00.
    expect(ticket().valor).toEqual({
      data: DIA,
      cupons: 20,
      ticket_medio_centavos: 3500,
      media_28_dias_centavos: 5000,
      queda_bps: 3000,
      queda_percentual: 30,
      queda_relevante: true,
    });
  });

  describe("limite de queda de 30%", () => {
    it("exatamente 30% é queda relevante", () => {
      expect(ticket().valor.queda_relevante).toBe(true);
    });

    it("29,9% não é", () => {
      // R$ 701,00 em 20 cupons: ticket de R$ 35,05, queda de 29,9%.
      const r = ticket({ vendas: [...base(100_000, 20), vendasDoDia(DIA, 70_100, 20)] });
      expect(r.valor).toMatchObject({ ticket_medio_centavos: 3505, queda_bps: 2990, queda_relevante: false });
    });

    it("aceita outro limite pelos parâmetros", () => {
      const r = calcularTicketMedio(
        entrada({ vendas: [...base(100_000, 20), vendasDoDia(DIA, 70_100, 20)] }),
        { ...PARAMETROS_TICKET_MEDIO, limiteQuedaBps: 2500 },
      );
      if (ehDadoAusente(r)) throw new Error("esperava ticket médio");
      expect(r.valor.queda_relevante).toBe(true);
    });

    it("ticket acima da média é queda negativa e nunca relevante", () => {
      const r = ticket({ vendas: [...base(100_000, 20), vendasDoDia(DIA, 150_000, 20)] });
      expect(r.valor).toMatchObject({
        ticket_medio_centavos: 7500,
        queda_bps: -5000,
        queda_percentual: -50,
        queda_relevante: false,
      });
    });
  });

  describe("média da base", () => {
    it("é ponderada pelos cupons (faturamento total / cupons totais), não a média dos tickets", () => {
      // 27 dias de R$ 100,00 em 10 cupons (ticket R$ 10,00) e um dia de R$ 1.000,00 em 1 cupom.
      // Ponderada: 370.000 / 271 = 1365,31 centavos. A média simples dos tickets daria 4535.
      const [primeiro, ...resto] = DATAS_DA_BASE;
      const vendas = [
        vendasDoDia(primeiro ?? "", 100_000, 1),
        ...resto.map((d) => vendasDoDia(d, 10_000, 10)),
        vendasDoDia(DIA, 13_650, 10),
      ];
      const r = ticket({ vendas });
      expect(r.valor).toMatchObject({
        media_28_dias_centavos: 1365,
        ticket_medio_centavos: 1365,
        queda_bps: 0,
      });
    });

    it("dia sem cupom dentro do intervalo conta como zero e não impede a média", () => {
      // Só 14 dos 28 dias têm venda; os outros 14 são dias sem cupom.
      const vendas = [...base(100_000, 20).filter((_, i) => i % 2 === 0), vendasDoDia(DIA, 70_000, 20)];
      expect(ticket({ vendas }).valor.media_28_dias_centavos).toBe(5000);
    });

    it("arredonda o ticket em centavos, meio para cima", () => {
      // R$ 100,00 em 3 cupons: 3333,33 centavos.
      const r = ticket({ vendas: [...base(100_000, 20), vendasDoDia(DIA, 10_000, 3)] });
      expect(r.valor.ticket_medio_centavos).toBe(3333);
    });
  });

  describe("dado ausente", () => {
    it("dia depois da última venda importada", () => {
      expect(
        calcularTicketMedio(
          entrada({ intervaloDeVendas: { primeira: PRIMEIRO_DIA_DA_BASE, ultima: "2026-10-18" } }),
        ),
      ).toMatchObject({
        ausente: true,
        codigo: "dia_sem_dados",
        pergunta_sugerida: "Pode enviar a planilha de vendas mais recente?",
      });
    });

    it("sem nenhuma venda importada", () => {
      expect(calcularTicketMedio(entrada({ vendas: [], intervaloDeVendas: null }))).toMatchObject({
        ausente: true,
        codigo: "dia_sem_dados",
      });
    });

    it("dia sem cupom não tem ticket médio", () => {
      const r = calcularTicketMedio(entrada({ vendas: base(100_000, 20) }));
      expect(r).toMatchObject({ ausente: true, codigo: "sem_vendas_no_dia" });
    });

    it("menos de 28 dias de vendas importadas", () => {
      const r = calcularTicketMedio(
        entrada({ intervaloDeVendas: { primeira: somarDias(PRIMEIRO_DIA_DA_BASE, 1), ultima: DIA } }),
      );
      expect(r).toMatchObject({ ausente: true, codigo: "historico_insuficiente" });
    });

    it("28 dias importados mas nenhum cupom neles", () => {
      const r = calcularTicketMedio(entrada({ vendas: [vendasDoDia(DIA, 70_000, 20)] }));
      expect(r).toMatchObject({ ausente: true, codigo: "sem_base_de_comparacao" });
    });
  });

  describe("procedência dos dados", () => {
    it("período vai de 28 dias antes até o dia", () => {
      expect(ticket().periodo).toEqual({ inicio: PRIMEIRO_DIA_DA_BASE, fim: DIA });
    });

    it("conta os cupons do dia e da base, herda a menor confiança e junta as origens", () => {
      const vendas = [
        ...base(100_000, 20).map((v, i) => (i === 3 ? { ...v, menorConfianca: 0.7 } : v)),
        vendasDoDia(DIA, 70_000, 20),
      ];
      const r = ticket({ vendas });
      expect(r.n_registros).toBe(28 * 20 + 20);
      expect(r.menor_confianca).toBe(0.7);
      expect(r.origens).toEqual(["planilha"]);
    });
  });
});
