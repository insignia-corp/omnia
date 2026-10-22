import type { Giro, GiroDoProduto } from "../metricas/giro";
import type { MetricasService } from "../metricas/metricas.service";
import type { ResultadoMetrica } from "../metricas/resultado-metrica";
import type { VariacaoDeCusto } from "../metricas/variacao-de-custo";
import type { FonteDeLimites } from "./limites";
import type { LeituraDoPar } from "./recalculo-de-reajuste";
import type { Prioridade, TipoAlerta } from "./tipos";
import { MotorDeAlertas } from "./motor-de-alertas";
import type { AlertaGravado, AlertaJaTratado, NovoAlerta, RepositorioAlertas } from "./repositorio-alertas";
import type { RegraDeAlerta } from "./regra";
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
  compra_atual_id: "compra-16",
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
  tratados: AlertaJaTratado[] = [];
  /** Filtra como o repositório real: por data (desde inclusive, ate exclusive). */
  /** Os comerciantes com que o motor chamou o repositório, para provar que é o da sessão. */
  chamadasDe: string[] = [];
  jaTratados(
    comercianteId: string,
    filtro: { desde: string | null; ate: string; tipos: readonly TipoAlerta[] },
  ) {
    this.chamadasDe.push(comercianteId);
    return Promise.resolve(
      this.tratados.filter(
        (t) =>
          filtro.tipos.includes(t.tipo) &&
          (filtro.desde === null || t.dataReferencia >= filtro.desde) &&
          t.dataReferencia < filtro.ate,
      ),
    );
  }
  gravarCandidatos(comercianteId: string, _d: string, novos: NovoAlerta[]) {
    this.chamadasDe.push(comercianteId);
    this.gravados.push(...novos);
    return Promise.resolve(novos.length);
  }
  /** Alertas já gravados em qualquer data, para o teste da opção semRepetirGravados. */
  existentes: Array<{ tipo: TipoAlerta; chave: string }> = [];
  jaGravados(comercianteId: string, tipos: readonly TipoAlerta[]) {
    this.chamadasDe.push(comercianteId);
    return Promise.resolve(this.existentes.filter((e) => tipos.includes(e.tipo)));
  }
  /** Travas pedidas (comerciante e dia) e se a execução rodou dentro delas. */
  travas: string[] = [];
  async comExclusao<T>(comercianteId: string, dia: string, corpo: () => Promise<T>): Promise<T> {
    this.travas.push(`${comercianteId}|${dia}`);
    return corpo();
  }
  /** O que o motor pediu para marcar como obsoleto. */
  obsoletados: Array<{
    tipos: readonly TipoAlerta[];
    manter: string[];
    produtoIds?: ReadonlySet<string>;
    excluir?: ReadonlyArray<{ tipo: TipoAlerta; produtoId: string }>;
  }> = [];
  marcarObsoletos(
    comercianteId: string,
    _dia: string,
    escopo: {
      tipos: readonly TipoAlerta[];
      produtoIds?: ReadonlySet<string>;
      excluir?: ReadonlyArray<{ tipo: TipoAlerta; produtoId: string }>;
      manter: ReadonlyArray<{ tipo: TipoAlerta; chave: string }>;
    },
  ) {
    this.chamadasDe.push(comercianteId);
    this.obsoletados.push({
      tipos: escopo.tipos,
      manter: escopo.manter.map((m) => `${m.tipo}|${m.chave}`),
      ...(escopo.produtoIds ? { produtoIds: escopo.produtoIds } : {}),
      ...(escopo.excluir ? { excluir: escopo.excluir } : {}),
    });
    return Promise.resolve(0);
  }
  /** Reajustes em aberto, leituras do par e o que o motor pediu para marcar ou atualizar (#186). */
  reajustes: AlertaGravado[] = [];
  leituras = { custos: [] as LeituraDoPar[], produto: { origem: "dono" as const, confianca: 1 } };
  obsoletadosPorId: string[] = [];
  atualizados: Array<{ id: string; prioridade: number; metricasApoio: Record<string, unknown> }> = [];
  reajustesEmAberto(comercianteId: string, _dia: string, produtoIds?: ReadonlySet<string>) {
    this.chamadasDe.push(comercianteId);
    return Promise.resolve(
      this.reajustes.filter((r) => !produtoIds || (r.produtoId !== null && produtoIds.has(r.produtoId))),
    );
  }
  pares: Array<{ produtoId: string; fornecedorId: string }> = [];
  leiturasDoPar(comercianteId: string, _ate: string, par: { produtoId: string; fornecedorId: string }) {
    this.chamadasDe.push(comercianteId);
    this.pares.push(par);
    return Promise.resolve(this.leituras);
  }
  marcarObsoletosPorId(comercianteId: string, ids: readonly string[]) {
    this.chamadasDe.push(comercianteId);
    this.obsoletadosPorId.push(...ids);
    return Promise.resolve(ids.length);
  }
  atualizarCandidato(
    comercianteId: string,
    id: string,
    novo: { prioridade: Prioridade; metricasApoio: Record<string, unknown> },
  ) {
    this.chamadasDe.push(comercianteId);
    this.atualizados.push({ id, ...novo });
    return Promise.resolve(true);
  }
  candidatosDoDia(comercianteId: string) {
    this.chamadasDe.push(comercianteId);
    return Promise.resolve([] as AlertaGravado[]);
  }
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

describe("motor de alertas: confiança do giro no reajuste", () => {
  const grande = variacao({ custo_atual_centavos: 15_100 });

  it("giro de baixa confiança rebaixa a prioridade um nível, e a procedência do giro vai nas métricas", async () => {
    const confiavel = motorCom([grande], giro(10, 1));
    await confiavel.motor.executar({ comercianteId: "c1", dataReferencia: REF });
    expect(confiavel.repositorio.gravados[0]).toMatchObject({ prioridade: 1 });

    const duvidoso = motorCom([grande], giro(10, 0.5));
    await duvidoso.motor.executar({ comercianteId: "c1", dataReferencia: REF });
    const gravado = duvidoso.repositorio.gravados[0];
    expect(gravado?.prioridade).toBe(2);
    expect(gravado?.metricasApoio).toMatchObject({
      menor_confianca: 0.5,
      unidades_7_dias: 10,
      giro_fonte: { menor_confianca: 0.5, n_registros: 10 },
    });
  });

  it("sem giro não há impacto, e a confiança é só a da variação de custo", async () => {
    const servico = {
      variacoesDeCusto: () => Promise.resolve(resultado([variacao({ menor_confianca: 0.9 })])),
      giro: () => Promise.resolve({ ausente: true, codigo: "historico_insuficiente", motivo: "sem giro" }),
    } as unknown as MetricasService;
    const repositorio = new RepositorioFalso();
    await new MotorDeAlertas(servico, repositorio, semLimites, [regraReajusteDeCusto]).executar({
      comercianteId: "c1",
      dataReferencia: REF,
    });
    expect(repositorio.gravados[0]?.metricasApoio).toMatchObject({
      impacto_centavos: null,
      menor_confianca: 0.9,
    });
  });
});

describe("motor de alertas: supressão do reajuste já tratado", () => {
  const chave = "p1:f1:compra-16";
  const tratadoHa = (dias: number): AlertaJaTratado => ({
    tipo: "reajuste_de_custo",
    chave,
    dataReferencia: new Date(Date.parse(`${REF}T00:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10),
  });

  it.each([2, 7, 30, 90])(
    "reajuste enviado ou descartado há %i dias com a mesma chave continua suprimido",
    async (dias) => {
      const { motor, repositorio } = motorCom([variacao()], giro(10));
      repositorio.tratados = [tratadoHa(dias)];
      const r = await motor.executar({ comercianteId: "c1", dataReferencia: REF });
      expect(r.suprimidos.map((c) => c.chave)).toEqual([chave]);
      expect(repositorio.gravados).toEqual([]);
    },
  );

  it("outra compra do mesmo produto e fornecedor (outra chave) não é suprimida", async () => {
    const { motor, repositorio } = motorCom([variacao({ compra_atual_id: "compra-17" })], giro(10));
    repositorio.tratados = [tratadoHa(30)];
    await motor.executar({ comercianteId: "c1", dataReferencia: REF });
    expect(repositorio.gravados.map((g) => g.chave)).toEqual(["p1:f1:compra-17"]);
  });
});

describe("motor de alertas: limite da janela de supressão", () => {
  const regra = (tipo: TipoAlerta): RegraDeAlerta => ({
    tipo,
    avaliar: () =>
      Promise.resolve({
        ausentes: [],
        candidatos: [
          {
            tipo,
            chave: "p1",
            produtoId: null,
            fornecedorId: null,
            metricasApoio: {},
            impactoCentavos: 0,
            confianca: 1,
          },
        ],
      }),
  });
  const tratadoHa = (dias: number): AlertaJaTratado => ({
    tipo: "estoque_parado",
    chave: "p1",
    dataReferencia: new Date(Date.parse(`${REF}T00:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10),
  });
  const rodar = async (dias: number) => {
    const repositorio = new RepositorioFalso();
    repositorio.tratados = [tratadoHa(dias)];
    const motor = new MotorDeAlertas({} as MetricasService, repositorio, semLimites, [
      regra("estoque_parado"),
    ]);
    const r = await motor.executar({ comercianteId: "c1", dataReferencia: REF });
    return { r, repositorio };
  };

  it("enviado há 6 dias suprime (menos de 7 dias)", async () => {
    const { r, repositorio } = await rodar(6);
    expect(r.suprimidos).toHaveLength(1);
    expect(repositorio.gravados).toEqual([]);
  });

  it.each([7, 8])("enviado há %i dias já não suprime", async (dias) => {
    const { r, repositorio } = await rodar(dias);
    expect(r.suprimidos).toEqual([]);
    expect(repositorio.gravados).toHaveLength(1);
  });
});

describe("motor de alertas: a supressão discrimina o tipo", () => {
  it("alerta tratado de um tipo não suprime outro tipo com a mesma chave (o produto)", async () => {
    const regra = (tipo: TipoAlerta): RegraDeAlerta => ({
      tipo,
      avaliar: () =>
        Promise.resolve({
          ausentes: [],
          candidatos: [
            {
              tipo,
              chave: "p1",
              produtoId: null,
              fornecedorId: null,
              metricasApoio: {},
              impactoCentavos: 0,
              confianca: 1,
            },
          ],
        }),
    });
    const repositorio = new RepositorioFalso();
    // Giro em alta do produto p1 enviado ontem, dentro da janela: a margem do mesmo p1 é outro alerta.
    repositorio.tratados = [{ tipo: "giro_em_alta", chave: "p1", dataReferencia: "2026-10-18" }];
    const motor = new MotorDeAlertas({} as MetricasService, repositorio, semLimites, [
      regra("giro_em_alta"),
      regra("margem_abaixo_da_meta"),
    ]);
    const r = await motor.executar({ comercianteId: "c1", dataReferencia: REF });
    expect(r.suprimidos.map((c) => c.tipo)).toEqual(["giro_em_alta"]);
    expect(repositorio.gravados.map((g) => g.tipo)).toEqual(["margem_abaixo_da_meta"]);
  });
});

describe("motor de alertas: o comerciante é o da sessão", () => {
  it("métricas, limites, regras e repositório recebem só o comerciante do contexto", async () => {
    const vistos: string[] = [];
    const registrar = (ctx: { comercianteId: string }) => {
      vistos.push(ctx.comercianteId);
    };
    const servico = {
      variacoesDeCusto: (ctx: { comercianteId: string }) => {
        registrar(ctx);
        return Promise.resolve(resultado([variacao()]));
      },
      giro: (ctx: { comercianteId: string }) => {
        registrar(ctx);
        return Promise.resolve(giro(10));
      },
    } as unknown as MetricasService;
    const limites: FonteDeLimites = {
      limitesDoComerciante: (comercianteId) => {
        vistos.push(comercianteId);
        return Promise.resolve({});
      },
    };
    const regra: RegraDeAlerta = {
      tipo: "estoque_parado",
      avaliar: (contexto) => {
        vistos.push(contexto.comercianteId);
        return Promise.resolve({ candidatos: [], ausentes: [] });
      },
    };
    const repositorio = new RepositorioFalso();
    await new MotorDeAlertas(servico, repositorio, limites, [regraReajusteDeCusto, regra]).executar({
      comercianteId: "c-sessao",
      dataReferencia: REF,
    });
    expect(vistos.length).toBeGreaterThanOrEqual(4);
    expect([...new Set([...vistos, ...repositorio.chamadasDe])]).toEqual(["c-sessao"]);
    expect(repositorio.chamadasDe.length).toBeGreaterThanOrEqual(3);
  });
});

describe("motor de alertas: opções do job pós-nota", () => {
  it("semRepetirGravados não grava de novo o reajuste que já existe em outro dia", async () => {
    const { motor, repositorio } = motorCom([variacao()], giro(10));
    repositorio.existentes = [{ tipo: "reajuste_de_custo", chave: "p1:f1:compra-16" }];
    const r = await motor.executar(
      { comercianteId: "c1", dataReferencia: REF },
      { semRepetirGravados: true },
    );
    expect(r.suprimidos).toHaveLength(1);
    expect(repositorio.gravados).toEqual([]);
  });

  it("semRepetirGravados só considera o mesmo tipo: outra regra com a mesma chave não barra", async () => {
    const { motor, repositorio } = motorCom([variacao()], giro(10));
    // Mesma chave do candidato de reajuste, mas de outro tipo (o repositório devolve só os tipos pedidos).
    repositorio.existentes = [{ tipo: "estoque_parado", chave: "p1:f1:compra-16" }];
    repositorio.jaGravados = () =>
      Promise.resolve([{ tipo: "estoque_parado" as const, chave: "p1:f1:compra-16" }]);
    await motor.executar({ comercianteId: "c1", dataReferencia: REF }, { semRepetirGravados: true });
    expect(repositorio.gravados).toHaveLength(1);
  });

  it("sem a opção, o motor diário grava de novo: o candidato de ontem volta a ser candidato de hoje", async () => {
    const { motor, repositorio } = motorCom([variacao()], giro(10));
    repositorio.existentes = [{ tipo: "reajuste_de_custo", chave: "p1:f1:compra-16" }];
    await motor.executar({ comercianteId: "c1", dataReferencia: REF });
    expect(repositorio.gravados).toHaveLength(1);
  });

  it("produtoIds grava só candidatos dos produtos informados", async () => {
    const { motor, repositorio } = motorCom(
      [variacao(), variacao({ produto_id: "p2", compra_atual_id: "compra-p2" })],
      giro(10),
    );
    await motor.executar({ comercianteId: "c1", dataReferencia: REF }, { produtoIds: new Set(["p2"]) });
    expect(repositorio.gravados.map((g) => g.produtoId)).toEqual(["p2"]);
  });

  it("tipos roda só as regras pedidas", async () => {
    const { motor, repositorio } = motorCom([variacao()], giro(10));
    await motor.executar({ comercianteId: "c1", dataReferencia: REF }, { tipos: ["estoque_parado"] });
    expect(repositorio.gravados).toEqual([]);
  });
});

describe("motor de alertas: candidato obsoleto (#157)", () => {
  const regraQue = (tipo: TipoAlerta, candidatos: string[], ausente = false): RegraDeAlerta => ({
    tipo,
    avaliar: () =>
      Promise.resolve({
        candidatos: candidatos.map((chave) => ({
          tipo,
          chave,
          produtoId: chave,
          fornecedorId: null,
          metricasApoio: {},
          impactoCentavos: 0,
          confianca: 1,
        })),
        ausentes: ausente ? [{ tipo, codigo: "sem_dado", motivo: "sem dado" }] : [],
      }),
  });

  const rodar = async (regras: RegraDeAlerta[], opcoes = {}, preparar?: (r: RepositorioFalso) => void) => {
    const repositorio = new RepositorioFalso();
    preparar?.(repositorio);
    const motor = new MotorDeAlertas({} as MetricasService, repositorio, semLimites, regras);
    await motor.executar({ comercianteId: "c1", dataReferencia: REF }, opcoes);
    return repositorio;
  };

  it("pede para marcar como obsoleto o que a regra deixou de disparar: só o que continua vale fica", async () => {
    const r = await rodar([regraQue("estoque_parado", ["a"]), regraQue("giro_em_alta", [])]);
    expect(r.obsoletados).toHaveLength(1);
    expect(r.obsoletados[0]?.tipos).toEqual(["estoque_parado", "giro_em_alta"]);
    expect(r.obsoletados[0]?.manter).toEqual(["estoque_parado|a"]);
  });

  it("regra sem dado (ausente) não marca nada como obsoleto: sem dado não dá para dizer que deixou de valer", async () => {
    const r = await rodar([regraQue("estoque_parado", [], true), regraQue("giro_em_alta", [])]);
    expect(r.obsoletados[0]?.tipos).toEqual(["giro_em_alta"]);
  });

  it("ausência só de alguns produtos: a regra segue avaliada, e esses produtos ficam de fora do obsoleto", async () => {
    const parcial: RegraDeAlerta = {
      tipo: "margem_abaixo_da_meta",
      avaliar: () =>
        Promise.resolve({
          candidatos: [],
          ausentes: [{ tipo: "margem_abaixo_da_meta", codigo: "sem_custo", motivo: "sem custo" }],
          produtosSemDado: ["p9"],
        }),
    };
    const r = await rodar([parcial]);
    expect(r.obsoletados[0]?.tipos).toEqual(["margem_abaixo_da_meta"]);
    expect(r.obsoletados[0]?.excluir).toEqual([{ tipo: "margem_abaixo_da_meta", produtoId: "p9" }]);
  });

  it("a ausência de um produto numa regra não protege os candidatos dele em outra regra", async () => {
    const semDado: RegraDeAlerta = {
      tipo: "margem_abaixo_da_meta",
      avaliar: () =>
        Promise.resolve({
          candidatos: [],
          ausentes: [{ tipo: "margem_abaixo_da_meta", codigo: "sem_custo", motivo: "sem custo" }],
          produtosSemDado: ["p9"],
        }),
    };
    const r = await rodar([semDado, regraQue("giro_em_alta", [])]);
    // Só margem/p9 é poupado: o giro de p9 (outra regra, que avaliou) pode virar obsoleto.
    expect(r.obsoletados[0]?.excluir).toEqual([{ tipo: "margem_abaixo_da_meta", produtoId: "p9" }]);
    expect(r.obsoletados[0]?.tipos).toEqual(["margem_abaixo_da_meta", "giro_em_alta"]);
  });

  it("o reajuste não entra nos tipos de `marcarObsoletos`: tem reavaliação própria (#186)", async () => {
    // A métrica só olha a compra atual do par: uma nota nova ou a correção de uma nota do dia faria a alta
    // sumir sem ter sido refutada.
    const r = await rodar([regraQue("reajuste_de_custo", []), regraQue("giro_em_alta", [])]);
    expect(r.obsoletados[0]?.tipos).toEqual(["giro_em_alta"]);
  });

  it("cada execução roda dentro da trava do comerciante e do dia", async () => {
    const r = await rodar([regraQue("estoque_parado", ["a"])]);
    expect(r.travas).toEqual([`c1|${REF}`]);
  });

  it("a execução restrita a produtos (job) só marca obsoleto dentro desses produtos", async () => {
    const r = await rodar([regraQue("estoque_parado", ["a", "b"])], { produtoIds: new Set(["a"]) });
    expect(r.obsoletados[0]?.produtoIds).toEqual(new Set(["a"]));
    expect(r.gravados.map((g) => g.chave)).toEqual(["a"]);
  });

  it("candidato que continua valendo mas o job não regrava (semRepetirGravados) NÃO vira obsoleto", async () => {
    const r = await rodar([regraQue("estoque_parado", ["a"])], { semRepetirGravados: true }, (rep) => {
      rep.existentes = [{ tipo: "estoque_parado", chave: "a" }];
    });
    expect(r.gravados).toEqual([]);
    expect(r.obsoletados[0]?.manter).toEqual(["estoque_parado|a"]);
  });

  it("candidato do dia que passou a ser suprimido por um alerta já tratado vira obsoleto", async () => {
    const r = await rodar([regraQue("estoque_parado", ["a"])], {}, (rep) => {
      rep.tratados = [{ tipo: "estoque_parado", chave: "a", dataReferencia: "2026-10-18" }];
    });
    expect(r.gravados).toEqual([]);
    expect(r.obsoletados[0]?.manter).toEqual([]);
  });
});

describe("motor de alertas: o mesmo reajuste sob outra chave (#157)", () => {
  const tratado = (extra: Partial<AlertaJaTratado>): AlertaJaTratado => ({
    tipo: "reajuste_de_custo",
    chave: "p1:f1:compra-ANTIGA",
    produtoId: "p1",
    fornecedorId: "f1",
    metricasApoio: { custo_atual_centavos: 115, custo_anterior_centavos: 100 },
    dataReferencia: "2026-10-16",
    ...extra,
  });
  const dataHa = (dias: number) =>
    new Date(Date.parse(`${REF}T00:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);

  const gravadosCom = async (tratados: AlertaJaTratado[]) => {
    const { motor, repositorio } = motorCom([variacao()], giro(10));
    repositorio.tratados = tratados;
    await motor.executar({ comercianteId: "c1", dataReferencia: REF });
    return repositorio.gravados;
  };

  it("mesmo produto, fornecedor e custos, tratado há 3 dias sob outra chave: é o mesmo reajuste", async () => {
    expect(await gravadosCom([tratado({ dataReferencia: dataHa(3) })])).toEqual([]);
  });

  it("tratado no próprio dia (a correção do dono troca a chave no mesmo dia) também é o mesmo reajuste", async () => {
    expect(await gravadosCom([tratado({ dataReferencia: REF })])).toEqual([]);
  });

  it("só dentro da janela: tratado há 7 dias já não vale (outro movimento de preço meses depois pode alertar)", async () => {
    expect(await gravadosCom([tratado({ dataReferencia: dataHa(7) })])).toHaveLength(1);
    expect(await gravadosCom([tratado({ dataReferencia: dataHa(6) })])).toEqual([]);
  });

  it("custo novo ou anterior diferente, ou outro fornecedor, ou outro produto: é outro reajuste", async () => {
    for (const extra of [
      { metricasApoio: { custo_atual_centavos: 120, custo_anterior_centavos: 100 } },
      { metricasApoio: { custo_atual_centavos: 115, custo_anterior_centavos: 90 } },
      { fornecedorId: "f2" },
      { produtoId: "p2" },
    ]) {
      expect(await gravadosCom([tratado({ dataReferencia: dataHa(3), ...extra })])).toHaveLength(1);
    }
  });

  it("só vale para reajuste: outro tipo com os mesmos números não suprime", async () => {
    expect(
      await gravadosCom([tratado({ dataReferencia: dataHa(3), tipo: "margem_abaixo_da_meta" })]),
    ).toHaveLength(1);
  });
});

describe("motor de alertas: reajuste obsoleto pela variação da própria compra (#186)", () => {
  const gravado = (chave: string, extra: Partial<AlertaGravado> = {}): AlertaGravado => ({
    id: `id-${chave}`,
    tipo: "reajuste_de_custo",
    chave,
    prioridade: 2,
    dataReferencia: REF,
    produtoId: "p1",
    fornecedorId: "f1",
    metricasApoio: {
      compra_atual_id: chave,
      custo_anterior_centavos: 2490,
      custo_atual_centavos: 2790,
      unidades_7_dias: 10,
    },
    ...extra,
  });
  const leitura = (compraId: string, data: string, custo: number, segundo: number): LeituraDoPar => ({
    produtoId: "p1",
    fornecedorId: "f1",
    compraId,
    itemDeCompraId: `i-${compraId}`,
    data,
    custoUnitarioCentavos: custo,
    confianca: 1,
    origem: "foto_nota",
    criadoEm: new Date(2026, 9, 1, 0, 0, segundo),
    compraCriadaEm: new Date(2026, 9, 1, 0, 0, segundo),
  });

  it("o reajuste que a regra não devolve mais e cuja alta foi desfeita vira obsoleto", async () => {
    const { motor, repositorio } = motorCom([], giro(10));
    repositorio.reajustes = [gravado("X")];
    repositorio.leituras = {
      custos: [leitura("X", "2026-10-16", 2790, 1), leitura("Z", "2026-10-16", 2790, 2)],
      produto: { origem: "dono", confianca: 1 },
    };
    const r = await motor.executar({ comercianteId: "c1", dataReferencia: REF });
    expect(repositorio.obsoletadosPorId).toEqual(["id-X"]);
    expect(repositorio.atualizados).toEqual([]);
    expect(repositorio.pares).toEqual([{ produtoId: "p1", fornecedorId: "f1" }]);
    expect(r.obsoletos).toBe(1);
  });

  it("a alta que continua acima do limite fica candidato com os números e a prioridade recalculados", async () => {
    const { motor, repositorio } = motorCom([], giro(10));
    repositorio.reajustes = [gravado("X")];
    repositorio.leituras = {
      custos: [
        leitura("W", "2026-10-10", 2000, 1),
        leitura("X", "2026-10-16", 2790, 2),
        leitura("Y", "2026-10-16", 2790, 3),
      ],
      produto: { origem: "dono", confianca: 1 },
    };
    const r = await motor.executar({ comercianteId: "c1", dataReferencia: REF });
    expect(r.obsoletos).toBe(0);
    expect(repositorio.obsoletadosPorId).toEqual([]);
    expect(repositorio.atualizados).toHaveLength(1);
    expect(repositorio.atualizados[0]).toMatchObject({
      id: "id-X",
      prioridade: 3,
      metricasApoio: { custo_anterior_centavos: 2000, custo_atual_centavos: 2790, impacto_centavos: 7900 },
    });
  });

  it("o reajuste que a regra ainda devolve é atualizado pelo upsert, não reavaliado", async () => {
    const { motor, repositorio } = motorCom([variacao()], giro(10));
    repositorio.reajustes = [gravado("p1:f1:compra-16")];
    // Leituras que, se reavaliado, o tornariam desfeito: a regra ainda o devolve, então não é reavaliado.
    repositorio.leituras = {
      custos: [leitura("p1:f1:compra-16", "2026-10-16", 2790, 1)],
      produto: { origem: "dono", confianca: 1 },
    };
    await motor.executar({ comercianteId: "c1", dataReferencia: REF });
    expect(repositorio.pares).toEqual([]);
    expect(repositorio.obsoletadosPorId).toEqual([]);
    expect(repositorio.atualizados).toEqual([]);
  });

  it("job pós-nota (semRepetirGravados): o reajuste já gravado que a regra devolve também é recalculado, sem número velho", async () => {
    const { motor, repositorio } = motorCom([variacao()], giro(10));
    repositorio.existentes = [{ tipo: "reajuste_de_custo", chave: "p1:f1:compra-16" }];
    repositorio.reajustes = [gravado("p1:f1:compra-16")];
    // Uma nota retroativa mais barata entrou depois: a alta da compra do alerta mudou.
    repositorio.leituras = {
      custos: [leitura("W", "2026-10-10", 2000, 1), leitura("p1:f1:compra-16", "2026-10-16", 2790, 2)],
      produto: { origem: "dono", confianca: 1 },
    };
    await motor.executar({ comercianteId: "c1", dataReferencia: REF }, { semRepetirGravados: true });
    expect(repositorio.gravados).toEqual([]);
    expect(repositorio.atualizados).toHaveLength(1);
    expect(repositorio.atualizados[0]?.metricasApoio).toMatchObject({ custo_anterior_centavos: 2000 });
  });

  it("o que só foi suprimido por um alerta já tratado vira obsoleto sem recalcular", async () => {
    const { motor, repositorio } = motorCom([variacao()], giro(10));
    repositorio.tratados = [{ tipo: "reajuste_de_custo", chave: "p1:f1:compra-16", dataReferencia: REF }];
    repositorio.reajustes = [gravado("p1:f1:compra-16")];
    await motor.executar({ comercianteId: "c1", dataReferencia: REF });
    expect(repositorio.obsoletadosPorId).toEqual(["id-p1:f1:compra-16"]);
  });

  it("sem leitura da compra (sem dado) o reajuste fica como está", async () => {
    const { motor, repositorio } = motorCom([], giro(10));
    repositorio.reajustes = [gravado("X")];
    repositorio.leituras = { custos: [], produto: { origem: "dono", confianca: 1 } };
    const r = await motor.executar({ comercianteId: "c1", dataReferencia: REF });
    expect(r.obsoletos).toBe(0);
    expect(repositorio.atualizados).toEqual([]);
  });

  it("a execução restrita a produtos (job) só reavalia os reajustes desses produtos", async () => {
    const { motor, repositorio } = motorCom([], giro(10));
    repositorio.reajustes = [gravado("X"), gravado("Y", { produtoId: "p2" })];
    repositorio.leituras = {
      custos: [leitura("X", "2026-10-16", 2790, 1)],
      produto: { origem: "dono", confianca: 1 },
    };
    await motor.executar({ comercianteId: "c1", dataReferencia: REF }, { produtoIds: new Set(["p2"]) });
    expect(repositorio.obsoletadosPorId).toEqual([]);
    expect(repositorio.atualizados).toEqual([]);
  });

  it("sem a regra de reajuste na execução, nada é reavaliado", async () => {
    const { motor, repositorio } = motorCom([], giro(10));
    repositorio.reajustes = [gravado("X")];
    repositorio.leituras = {
      custos: [leitura("X", "2026-10-16", 2790, 1)],
      produto: { origem: "dono", confianca: 1 },
    };
    await motor.executar({ comercianteId: "c1", dataReferencia: REF }, { tipos: ["estoque_parado"] });
    expect(repositorio.obsoletadosPorId).toEqual([]);
  });
});
