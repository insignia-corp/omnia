import { intervaloDeDatas, somarDias } from "../lib/datas/datas";
import { NumerosAutorizados, verificarNumeros } from "../lib/verificador-numeros/verificador-numeros";
import type { MovimentoDoDia } from "./dados-de-metricas";
import {
  calcularGastoForaDoPadrao,
  PARAMETROS_GASTO_FORA_DO_PADRAO,
  type EntradaGastoForaDoPadrao,
} from "./gasto-fora-do-padrao";
import { ehDadoAusente } from "./resultado-metrica";

const DIA = "2026-10-19";

const saida = (data: string, totalCentavos: number, extra: Partial<MovimentoDoDia> = {}): MovimentoDoDia => ({
  contaId: "conta-1",
  data,
  tipo: "saida",
  categoria: "despesa_operacional",
  totalCentavos,
  registros: 1,
  menorConfianca: 1,
  origens: ["banco"],
  ...extra,
});

/** Os `n` dias antes de DIA, do mais antigo ao mais recente. */
const diasAntes = (n: number): string[] => intervaloDeDatas(somarDias(DIA, -n), somarDias(DIA, -1));

/** Metade dos dias gasta `a` e a outra metade `b`: a mediana é a média dos dois e todo desvio é metade da diferença. */
const metadeEMetade = (n: number, a: number, b: number): MovimentoDoDia[] =>
  diasAntes(n).map((d, i) => saida(d, i < n / 2 ? a : b));

const entrada = (
  movimentos: MovimentoDoDia[],
  diasDeExtrato = 30,
  extra: Partial<EntradaGastoForaDoPadrao> = {},
): EntradaGastoForaDoPadrao => ({
  data: DIA,
  movimentos,
  intervaloDeMovimentos: { primeira: somarDias(DIA, -diasDeExtrato), ultima: DIA },
  ...extra,
});

function gasto(extra: EntradaGastoForaDoPadrao) {
  const r = calcularGastoForaDoPadrao(extra);
  if (ehDadoAusente(r)) throw new Error(`Esperava gasto, veio dado ausente: ${r.codigo}`);
  return r;
}

describe("calcularGastoForaDoPadrao", () => {
  describe("desvio robusto", () => {
    // 30 dias: 15 com R$ 40,00 e 15 com R$ 60,00. Mediana R$ 50,00, desvio absoluto mediano R$ 10,00.
    const historico = metadeEMetade(30, 4000, 6000);

    it("um dia de R$ 100,00 está a 5 desvios acima da mediana", () => {
      const r = gasto(entrada([...historico, saida(DIA, 10_000)]));
      expect(r.valor).toEqual({
        data: DIA,
        valor_centavos: 10_000,
        mediana_centavos: 5000,
        desvio_absoluto_mediano_centavos: 1000,
        desvio: 5,
        dias_de_historico: 30,
        acima_do_limite: true,
      });
    });

    it("exatamente 3 desvios não passa do limite; 3,01 passa", () => {
      expect(gasto(entrada([...historico, saida(DIA, 8000)])).valor).toMatchObject({
        desvio: 3,
        acima_do_limite: false,
      });
      expect(gasto(entrada([...historico, saida(DIA, 8010)])).valor).toMatchObject({
        desvio: 3.01,
        acima_do_limite: true,
      });
    });

    it("gasto abaixo da mediana é desvio negativo e nunca passa do limite", () => {
      const r = gasto(entrada([...historico, saida(DIA, 1000)]));
      expect(r.valor).toMatchObject({ desvio: -4, acima_do_limite: false });
    });

    it("gasto igual à mediana tem desvio zero", () => {
      expect(gasto(entrada([...historico, saida(DIA, 5000)])).valor).toMatchObject({ desvio: 0 });
    });

    it("dia sem nenhum gasto operacional vale zero", () => {
      expect(gasto(entrada(historico)).valor).toMatchObject({ valor_centavos: 0, desvio: -5 });
    });

    it("soma os lançamentos do mesmo dia", () => {
      const r = gasto(
        entrada([...historico, saida(DIA, 6000), saida(DIA, 4000, { categoria: "despesa_operacional" })]),
      );
      expect(r.valor.valor_centavos).toBe(10_000);
    });

    it("aceita outro limite pelos parâmetros", () => {
      const r = calcularGastoForaDoPadrao(entrada([...historico, saida(DIA, 8000)]), {
        ...PARAMETROS_GASTO_FORA_DO_PADRAO,
        limiteDesvio: 2.5,
      });
      if (ehDadoAusente(r)) throw new Error("esperava gasto");
      expect(r.valor.acima_do_limite).toBe(true);
    });
  });

  describe("mediana e desvio em meio e em quarto de centavo", () => {
    it("mediana de 50,005 centavos e desvio de meio centavo: o desvio sai exato", () => {
      // 15 dias com 5000 e 15 com 5001: mediana 5000,5; todo desvio é 0,5; desvio absoluto mediano 0,5.
      const historico = metadeEMetade(30, 5000, 5001);
      const r = gasto(entrada([...historico, saida(DIA, 5002)]));
      // (5002 - 5000,5) / 0,5 = 3
      expect(r.valor).toMatchObject({
        desvio: 3,
        mediana_centavos: 5001, // 5000,5 arredonda para cima
        desvio_absoluto_mediano_centavos: 1, // 0,5 arredonda para cima
        acima_do_limite: false,
      });
      expect(gasto(entrada([...historico, saida(DIA, 5003)])).valor).toMatchObject({
        desvio: 5,
        acima_do_limite: true,
      });
    });

    it("reproduz o desvio de 54,62 do dia de referência do gabarito", () => {
      // Mediana 6093 e desvio absoluto mediano 1747,5; o dia gastou 101.534 centavos.
      // 60 dias montados para dar essas duas estatísticas: 30 em 6093 - 1747,5 e 30 em 6093 + 1747,5
      // não são inteiros, então usamos 6093 -+ 1748 e 6093 -+ 1747 (15 de cada).
      const valores = [
        ...Array.from({ length: 15 }, () => 6093 - 1748),
        ...Array.from({ length: 15 }, () => 6093 - 1747),
        ...Array.from({ length: 15 }, () => 6093 + 1747),
        ...Array.from({ length: 15 }, () => 6093 + 1748),
      ];
      const historico = diasAntes(60).map((d, i) => saida(d, valores[i] ?? 0));
      const r = gasto(entrada([...historico, saida(DIA, 101_534)], 60));
      expect(r.valor).toMatchObject({
        mediana_centavos: 6093,
        desvio_absoluto_mediano_centavos: 1748, // 1747,5 arredondado para cima
        desvio: 54.62,
        dias_de_historico: 60,
        acima_do_limite: true,
      });
    });

    it("desvio absoluto mediano zero: sem desvio e sem alerta", () => {
      const constante = diasAntes(30).map((d) => saida(d, 5000));
      const r = gasto(entrada([...constante, saida(DIA, 99_999)]));
      expect(r.valor).toMatchObject({
        mediana_centavos: 5000,
        desvio_absoluto_mediano_centavos: 0,
        desvio: null,
      });
      expect(r.valor.acima_do_limite).toBe(false);
    });
  });

  describe("série", () => {
    it("só entra saída das categorias operacionais; entrada, compra de mercadoria e despesa fixa ficam fora", () => {
      const historico = metadeEMetade(30, 4000, 6000);
      const ruido = diasAntes(30).flatMap((d) => [
        saida(d, 900_000, { categoria: "compra_mercadoria" }),
        saida(d, 300_000, { categoria: "despesa_fixa" }),
        saida(d, 700_000, { categoria: null }),
        saida(d, 500_000, { tipo: "entrada", categoria: "despesa_operacional" }),
      ]);
      const r = gasto(
        entrada([
          ...historico,
          ...ruido,
          saida(DIA, 10_000),
          saida(DIA, 777_777, { categoria: "compra_mercadoria" }),
        ]),
      );
      expect(r.valor).toMatchObject({ mediana_centavos: 5000, valor_centavos: 10_000, desvio: 5 });
    });

    it("dia sem gasto dentro do extrato conta como zero no histórico", () => {
      // 15 dias sem lançamento e 15 com R$ 60,00: mediana R$ 30,00 e desvio absoluto mediano R$ 30,00.
      const historico = diasAntes(30)
        .filter((_, i) => i >= 15)
        .map((d) => saida(d, 6000));
      const r = gasto(entrada([...historico, saida(DIA, 12_000)]));
      expect(r.valor).toMatchObject({
        mediana_centavos: 3000,
        desvio_absoluto_mediano_centavos: 3000,
        desvio: 3,
      });
    });

    it("usa só os últimos 60 dias, mesmo com mais extrato", () => {
      const normal = metadeEMetade(60, 4000, 6000);
      const antigo = [saida(somarDias(DIA, -61), 99_999_999), saida(somarDias(DIA, -90), 99_999_999)];
      const r = gasto(entrada([...antigo, ...normal, saida(DIA, 10_000)], 120));
      expect(r.valor).toMatchObject({ dias_de_historico: 60, mediana_centavos: 5000, desvio: 5 });
    });

    it("com extrato mais curto que 60 dias, o histórico começa no primeiro dia importado", () => {
      const r = gasto(entrada([...metadeEMetade(45, 4000, 6000), saida(DIA, 10_000)], 45));
      expect(r.valor.dias_de_historico).toBe(45);
    });
  });

  describe("dado ausente", () => {
    it("histórico menor que 30 dias", () => {
      const r = calcularGastoForaDoPadrao(
        entrada([...metadeEMetade(29, 4000, 6000), saida(DIA, 10_000)], 29),
      );
      expect(r).toMatchObject({ ausente: true, codigo: "historico_insuficiente" });
    });

    it("exatamente 30 dias de histórico bastam", () => {
      const r = calcularGastoForaDoPadrao(
        entrada([...metadeEMetade(30, 4000, 6000), saida(DIA, 10_000)], 30),
      );
      expect(ehDadoAusente(r)).toBe(false);
    });

    it("dia depois do último lançamento importado não vira gasto zero", () => {
      const r = calcularGastoForaDoPadrao(
        entrada(metadeEMetade(30, 4000, 6000), 30, {
          intervaloDeMovimentos: { primeira: somarDias(DIA, -30), ultima: somarDias(DIA, -1) },
        }),
      );
      expect(r).toMatchObject({ ausente: true, codigo: "dia_sem_dados" });
    });

    it("sem extrato nenhum", () => {
      const r = calcularGastoForaDoPadrao(entrada([], 30, { intervaloDeMovimentos: null }));
      expect(r).toMatchObject({ ausente: true, codigo: "dia_sem_dados" });
    });
  });

  describe("contrato com o verificador de números (regra inviolável 8)", () => {
    // Histórico de R$ 40,00 e R$ 60,00 (mediana R$ 50,00) e um dia de R$ 100,00: 5 desvios.
    const r = gasto(entrada([...metadeEMetade(30, 4000, 6000), saida(DIA, 10_000)]));
    const autorizados = new NumerosAutorizados([r]);

    it("aprova a mensagem que cita só números do resultado", () => {
      const mensagem = "O gasto de hoje foi R$ 100,00, 5 desvios acima da mediana de R$ 50,00.";
      expect(verificarNumeros(mensagem, autorizados).aprovado).toBe(true);
    });

    it("bloqueia o percentual que o modelo calculou por conta própria", () => {
      const resultado = verificarNumeros("O gasto é 33% maior que o normal.", autorizados);
      expect(resultado.aprovado).toBe(false);
      expect(resultado.naoAutorizados.map((n) => n.valor)).toEqual([33]);
    });
  });

  describe("procedência dos dados", () => {
    it("período do primeiro dia do histórico até o dia", () => {
      const r = gasto(entrada([...metadeEMetade(30, 4000, 6000), saida(DIA, 10_000)]));
      expect(r.periodo).toEqual({ inicio: somarDias(DIA, -30), fim: DIA });
    });

    it("conta as transações da série, herda a menor confiança e junta as origens", () => {
      const historico = metadeEMetade(30, 4000, 6000).map((m, i) =>
        i === 4 ? { ...m, registros: 3, menorConfianca: 0.6 } : m,
      );
      const r = gasto(
        entrada([
          ...historico,
          saida(DIA, 10_000, { registros: 2 }),
          saida(DIA, 1_000_000, { categoria: "compra_mercadoria", menorConfianca: 0.1 }),
        ]),
      );
      expect(r.n_registros).toBe(29 + 3 + 2); // 29 dias de 1 transação, 1 dia de 3 e o dia de 2
      expect(r.menor_confianca).toBe(0.6);
      expect(r.origens).toEqual(["banco"]);
    });
  });
});
