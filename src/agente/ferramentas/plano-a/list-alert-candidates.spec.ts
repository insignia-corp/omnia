import { randomUUID } from "node:crypto";
import type { MotorDeAlertas, ResultadoDoMotor } from "../../../alertas/motor-de-alertas";
import type { AlertaGravado } from "../../../alertas/repositorio-alertas";
import { NumerosAutorizados, verificarNumeros } from "../../../lib/verificador-numeros/verificador-numeros";
import type { ContextoSessao } from "../ferramenta";
import { RegistroFerramentas } from "../registro-ferramentas";
import { criarListAlertCandidates, type CandidatosDoDia } from "./list-alert-candidates";

const contexto: ContextoSessao = {
  comercianteId: randomUUID(),
  nomeComercio: "Mercadinho Teste",
  dataReferencia: "2026-10-19",
};

const alerta = (extra: Partial<AlertaGravado> = {}): AlertaGravado => ({
  id: randomUUID(),
  tipo: "reajuste_de_custo",
  chave: "produto|fornecedor|compra",
  prioridade: 1,
  dataReferencia: "2026-10-19",
  produtoId: randomUUID(),
  fornecedorId: randomUUID(),
  metricasApoio: {
    produto_nome: "Arroz Tipo 1 5kg",
    variacao_percentual: 12.05,
    custo_atual_centavos: 2790,
    impacto_centavos: 61500,
    menor_confianca: 0.95,
  },
  ...extra,
});

const motorCom = (resultado: Partial<ResultadoDoMotor>) => {
  const executar = jest.fn(async () => ({
    candidatos: [],
    gravados: 0,
    suprimidos: [],
    ausentes: [],
    ...resultado,
  }));
  return { executar, motor: { executar } as unknown as MotorDeAlertas };
};

describe("list_alert_candidates", () => {
  it("é de leitura para o dono (efeito nenhum), entra no registro e a entrada é vazia e estrita", async () => {
    const { motor } = motorCom({});
    const f = criarListAlertCandidates(motor);
    expect(f.nome).toBe("list_alert_candidates");
    expect(f.efeito).toBe("nenhum");
    expect(() => new RegistroFerramentas([f])).not.toThrow();
    expect(f.entrada.safeParse({}).success).toBe(true);
  });

  it("regra 3: comerciante e data não vêm do modelo, e o motor recebe os da sessão", async () => {
    const { executar, motor } = motorCom({});
    const f = criarListAlertCandidates(motor);
    expect(f.entrada.safeParse({ comerciante_id: randomUUID() }).success).toBe(false);
    expect(f.entrada.safeParse({ comercianteId: randomUUID() }).success).toBe(false);
    expect(f.entrada.safeParse({ data: "2020-01-01" }).success).toBe(false);

    const registro = new RegistroFerramentas([f]);
    const recusada = await registro.executar(contexto, "list_alert_candidates", {
      comerciante_id: randomUUID(),
    });
    expect(recusada.ok).toBe(false);
    expect(executar).not.toHaveBeenCalled();

    expect((await registro.executar(contexto, "list_alert_candidates", {})).ok).toBe(true);
    expect(executar).toHaveBeenCalledTimes(1);
    expect(executar).toHaveBeenCalledWith({
      comercianteId: contexto.comercianteId,
      dataReferencia: contexto.dataReferencia,
    });
  });

  it("devolve os candidatos na ordem do motor, com os campos para o select_alerts e os números de apoio", async () => {
    const primeiro = alerta({ prioridade: 1 });
    const segundo = alerta({
      tipo: "estoque_parado",
      prioridade: 3,
      metricasApoio: { produto_nome: "Sal", dias_sem_venda: 41 },
    });
    const { motor } = motorCom({ candidatos: [primeiro, segundo] });
    const saida = await criarListAlertCandidates(motor).executar(contexto, {});
    expect(saida.data).toBe("2026-10-19");
    expect(saida.candidatos.map((c) => [c.alerta_id, c.tipo, c.prioridade, c.chave])).toEqual([
      [primeiro.id, "reajuste_de_custo", 1, "produto|fornecedor|compra"],
      [segundo.id, "estoque_parado", 3, "produto|fornecedor|compra"],
    ]);
    expect(saida.candidatos[0]).toMatchObject({
      produto_id: primeiro.produtoId,
      fornecedor_id: primeiro.fornecedorId,
      metricas_apoio: primeiro.metricasApoio,
    });
    expect(saida.n_registros).toBe(2);
    expect(saida.menor_confianca).toBe(0.95);
  });

  it("a menor confiança é a menor entre os candidatos que a informam, e nula quando nenhum informa", async () => {
    const a = alerta({ metricasApoio: { menor_confianca: 0.9 } });
    const b = alerta({ metricasApoio: { menor_confianca: 0.7 } });
    const c = alerta({ metricasApoio: { produto_nome: "Sem confiança" } });
    expect(
      (await criarListAlertCandidates(motorCom({ candidatos: [a, b, c] }).motor).executar(contexto, {}))
        .menor_confianca,
    ).toBe(0.7);
    expect(
      (await criarListAlertCandidates(motorCom({ candidatos: [c] }).motor).executar(contexto, {}))
        .menor_confianca,
    ).toBeNull();
  });

  it("confiança nula ou fora do formato é desconhecida: não vira zero nem anula a menor dos outros, como em select_alerts", async () => {
    const conhecida = alerta({ metricasApoio: { menor_confianca: 0.8 } });
    const nula = alerta({ metricasApoio: { menor_confianca: null } });
    const texto = alerta({ metricasApoio: { menor_confianca: "0,5" } });
    const executar = async (candidatos: AlertaGravado[]) =>
      (await criarListAlertCandidates(motorCom({ candidatos }).motor).executar(contexto, {})).menor_confianca;
    expect(await executar([nula, conhecida, texto])).toBe(0.8);
    // Todos desconhecidos: o resultado também é desconhecido (nulo), nunca 0.
    expect(await executar([nula, texto])).toBeNull();
    // Um zero informado de verdade é confiança zero e continua valendo.
    expect(await executar([conhecida, alerta({ metricasApoio: { menor_confianca: 0 } })])).toBe(0);
  });

  it("zero candidatos é um resultado explícito (n_registros 0), e os motivos ausentes passam sem virar zero", async () => {
    const ausentes = [
      { tipo: "giro_em_alta" as const, codigo: "historico_insuficiente", motivo: "Sem 5 semanas de vendas." },
    ];
    const { motor } = motorCom({ ausentes });
    const saida = await criarListAlertCandidates(motor).executar(contexto, {});
    expect(saida).toMatchObject({ candidatos: [], n_registros: 0, menor_confianca: null, n_suprimidos: 0 });
    expect(saida.ausentes).toEqual(ausentes);
  });

  it("n_suprimidos conta o que a janela de supressão barrou", async () => {
    const suprimido = {
      tipo: "estoque_parado" as const,
      chave: "p",
      produtoId: null,
      fornecedorId: null,
      metricasApoio: {},
      impactoCentavos: null,
      confianca: null,
    };
    const saida = await criarListAlertCandidates(
      motorCom({ suprimidos: [suprimido, suprimido] }).motor,
    ).executar(contexto, {});
    expect(saida.n_suprimidos).toBe(2);
    expect(saida.candidatos).toEqual([]);
  });

  describe("regra 8", () => {
    const comNoventaENove = "f0e1d2c3-99ab-4cde-8f01-23456789abcd";
    let saida: CandidatosDoDia;
    beforeAll(async () => {
      const { motor } = motorCom({
        candidatos: [
          alerta({ id: comNoventaENove, produtoId: comNoventaENove, fornecedorId: comNoventaENove }),
        ],
      });
      saida = await criarListAlertCandidates(motor).executar(contexto, {});
    });

    it("os números das métricas de apoio autorizam a mensagem, e outro valor não", () => {
      const autorizados = new NumerosAutorizados([saida]);
      expect(
        verificarNumeros(
          "O custo subiu 12,05% e passou a R$ 27,90, cerca de R$ 615,00 por semana.",
          autorizados,
        ).aprovado,
      ).toBe(true);
      expect(verificarNumeros("O custo subiu 15%.", autorizados).aprovado).toBe(false);
    });

    it("os ids (alerta, produto, fornecedor) estão na saída e não autorizam números", () => {
      expect(JSON.stringify(saida)).toContain(comNoventaENove);
      expect(verificarNumeros("O custo subiu 99%.", new NumerosAutorizados([saida])).aprovado).toBe(false);
    });
  });
});
