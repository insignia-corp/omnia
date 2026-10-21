import type { Giro, GiroDoProduto } from "../metricas/giro";
import type { MetricasService } from "../metricas/metricas.service";
import type { ResultadoMetrica } from "../metricas/resultado-metrica";
import type { VariacaoDeCusto } from "../metricas/variacao-de-custo";
import type { FonteDeLimites } from "./limites";
import { MotorDeAlertas } from "./motor-de-alertas";
import type { AlertaGravado, NovoAlerta, RepositorioAlertas } from "./repositorio-alertas";
import { regraReajusteDeCusto } from "./regras";

const REF = "2026-10-19";
const periodo = { inicio: "2026-09-20", fim: REF };
const resultado = <T>(valor: T, menor_confianca: number | null = 1): ResultadoMetrica<T> => ({
  valor,
  periodo,
  n_registros: 10,
  menor_confianca,
  origens: ["planilha"],
});

const variacao = (extra: Partial<VariacaoDeCusto> = {}): VariacaoDeCusto => ({
  produto_id: "p1",
  nome: "Arroz",
  fornecedor_id: "f1",
  custo_anterior_centavos: 100,
  custo_atual_centavos: 115,
  compra_anterior_data: "2026-09-14",
  compra_atual_data: "2026-10-16",
  variacao_bps: 1500,
  variacao_percentual: 15,
  acima_do_limite: true,
  recente: true,
  menor_confianca: 1,
  ...extra,
});

const giro = (unidades: number, confianca: number | null = 1): ResultadoMetrica<Giro> => {
  const g: GiroDoProduto = {
    produto_id: "p1",
    nome: "Arroz",
    unidades_7_dias: unidades,
    unidades_28_dias_anteriores: 100,
    media_semanal_28_dias: 25,
    alta_bps: 100,
    alta_percentual: 1,
    elegivel_para_alta: true,
  };
  return resultado(
    {
      periodos: { ultimos_7_dias: periodo, anteriores_28_dias: periodo },
      por_produto: [g],
      maior_alta: [],
      maior_volume: [],
      giro_alto: [],
    },
    confianca,
  );
};

/** Repositório em memória só para este teste: guarda o que o motor grava. */
class RepositorioFalso implements RepositorioAlertas {
  gravados: NovoAlerta[] = [];
  jaTratados = () => Promise.resolve([]);
  gravarCandidatos(_c: string, _d: string, novos: NovoAlerta[]) {
    this.gravados.push(...novos);
    return Promise.resolve(novos.length);
  }
  candidatosDoDia = () => Promise.resolve([] as AlertaGravado[]);
}

const semLimites: FonteDeLimites = { limitesDoComerciante: () => Promise.resolve({}) };

function motorCom(
  variacoes: VariacaoDeCusto[],
  giroResultado: ResultadoMetrica<Giro>,
  limites: FonteDeLimites = semLimites,
) {
  const repositorio = new RepositorioFalso();
  const servico = {
    variacoesDeCusto: () => Promise.resolve(resultado(variacoes)),
    giro: () => Promise.resolve(giroResultado),
  } as unknown as MetricasService;
  return { repositorio, motor: new MotorDeAlertas(servico, repositorio, limites, [regraReajusteDeCusto]) };
}

describe("motor de alertas: dinheiro e prioridade", () => {
  it("o impacto com unidades fracionadas arredonda como dinheiro (15 centavos x 4,1 = 62) e decide a prioridade", async () => {
    const limites: FonteDeLimites = {
      limitesDoComerciante: () => Promise.resolve({ prioridade2MinCentavos: 62 }),
    };
    const { motor, repositorio } = motorCom([variacao()], giro(4.1), limites);
    await motor.executar({ comercianteId: "c1", dataReferencia: REF });
    expect(repositorio.gravados).toHaveLength(1);
    expect(repositorio.gravados[0]?.metricasApoio.impacto_centavos).toBe(62);
    // Com 61 centavos (o erro do ponto flutuante) a prioridade cairia para 3.
    expect(repositorio.gravados[0]?.prioridade).toBe(2);
  });
});

describe("motor de alertas: confiança para o agente", () => {
  it("grava a confiança como menor_confianca, o campo que select_alerts lê", async () => {
    const { motor, repositorio } = motorCom([variacao({ menor_confianca: 0.6 })], giro(10));
    await motor.executar({ comercianteId: "c1", dataReferencia: REF });
    expect(repositorio.gravados[0]?.metricasApoio).toMatchObject({ menor_confianca: 0.6 });
    expect(repositorio.gravados[0]?.metricasApoio).not.toHaveProperty("confianca");
  });
});
