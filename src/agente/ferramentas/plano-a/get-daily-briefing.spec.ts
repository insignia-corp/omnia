import { randomUUID } from "node:crypto";
import type { FonteDeLimites } from "../../../alertas/limites";
import { PARAMETROS_ATENCAO } from "../../../metricas/atencao";
import type { BriefingDiario } from "../../../metricas/briefing-diario";
import type { MetricasService } from "../../../metricas/metricas.service";
import type { ContextoSessao } from "../ferramenta";
import { RegistroFerramentas } from "../registro-ferramentas";
import { criarGetDailyBriefing } from "./get-daily-briefing";

const contexto: ContextoSessao = {
  comercianteId: randomUUID(),
  nomeComercio: "Mercadinho Teste",
  dataReferencia: "2026-10-24",
};

const briefing = { data: "2026-10-23" } as BriefingDiario;

const montar = (limites: FonteDeLimites = { limitesDoComerciante: async () => ({}) }) => {
  const briefingDiario = jest.fn(async () => briefing);
  const ferramenta = criarGetDailyBriefing({ briefingDiario } as unknown as MetricasService, limites);
  return { briefingDiario, ferramenta };
};

describe("get_daily_briefing", () => {
  it("é de leitura (efeito nenhum), entra no registro e só aceita a data opcional", () => {
    const { ferramenta } = montar();
    expect(ferramenta.nome).toBe("get_daily_briefing");
    expect(ferramenta.efeito).toBe("nenhum");
    expect(() => new RegistroFerramentas([ferramenta])).not.toThrow();
    expect(ferramenta.entrada.safeParse({}).success).toBe(true);
    expect(ferramenta.entrada.safeParse({ data: "2026-10-16" }).success).toBe(true);
    expect(ferramenta.entrada.safeParse({ data: "16/10" }).success).toBe(false);
    expect(ferramenta.entrada.safeParse({ comerciante_id: randomUUID() }).success).toBe(false);
  });

  it("sem data resume ontem, com o comerciante da sessão e o limite padrão", async () => {
    const { briefingDiario, ferramenta } = montar();
    await expect(ferramenta.executar(contexto, {})).resolves.toBe(briefing);
    expect(briefingDiario).toHaveBeenCalledWith(contexto, "2026-10-23", PARAMETROS_ATENCAO);
  });

  it("com data, resume a data pedida", async () => {
    const { briefingDiario, ferramenta } = montar();
    await ferramenta.executar(contexto, { data: "2026-10-16" });
    expect(briefingDiario).toHaveBeenCalledWith(contexto, "2026-10-16", PARAMETROS_ATENCAO);
  });

  it("usa o limite de reajuste que o comerciante da sessão ajustou", async () => {
    const limitesDoComerciante = jest.fn(async () => ({ reajusteLimiteBps: 1000 }));
    const { briefingDiario, ferramenta } = montar({ limitesDoComerciante });
    await ferramenta.executar(contexto, {});
    expect(limitesDoComerciante).toHaveBeenCalledWith(contexto.comercianteId);
    expect(briefingDiario).toHaveBeenCalledWith(contexto, "2026-10-23", {
      ...PARAMETROS_ATENCAO,
      limiteReajusteBps: 1000,
    });
  });
});
