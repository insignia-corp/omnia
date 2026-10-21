import type { Executor } from "../../infra/database/database.module";
import type { MotorDeAlertas } from "../motor-de-alertas";
import { VerificadorDeReajuste } from "./verificar-reajuste";

/** Banco falso: devolve as linhas de produto da nota, qualquer que seja a consulta. */
const dbCom = (linhas: Array<{ produtoId: string | null }>): Executor =>
  ({
    selectDistinct: () => ({
      from: () => ({ innerJoin: () => ({ where: () => Promise.resolve(linhas) }) }),
    }),
  }) as unknown as Executor;

const motorFalso = (gravados = 1) => {
  const executar = jest.fn().mockResolvedValue({ gravados });
  return { executar, motor: { executar } as unknown as MotorDeAlertas };
};

const JOB = { documentoId: "doc-1", comercianteId: "c-job" };

describe("VerificadorDeReajuste", () => {
  it("roda só a regra de reajuste, restrita aos produtos da nota, com o comerciante do job", async () => {
    const { motor, executar } = motorFalso(2);
    const r = await new VerificadorDeReajuste(
      dbCom([{ produtoId: "p1" }, { produtoId: "p2" }]),
      motor,
      () => "2026-10-19",
    ).verificar(JOB);
    expect(r).toEqual({ produtos: 2, gravados: 2 });
    expect(executar).toHaveBeenCalledTimes(1);
    expect(executar).toHaveBeenCalledWith(
      { comercianteId: "c-job", dataReferencia: "2026-10-19" },
      { tipos: ["reajuste_de_custo"], produtoIds: new Set(["p1", "p2"]), semRepetirGravados: true },
    );
  });

  it("item sem produto ligado fica de fora, e nota sem nenhum produto ligado não roda o motor", async () => {
    const { motor, executar } = motorFalso();
    const verificador = new VerificadorDeReajuste(dbCom([{ produtoId: null }]), motor, () => "2026-10-19");
    expect(await verificador.verificar(JOB)).toEqual({ produtos: 0, gravados: 0 });
    expect(executar).not.toHaveBeenCalled();
  });

  it("a data de referência explícita vale mais que a de hoje", async () => {
    const { motor, executar } = motorFalso();
    await new VerificadorDeReajuste(dbCom([{ produtoId: "p1" }]), motor, () => "2026-10-19").verificar(
      JOB,
      "2026-10-16",
    );
    expect(executar.mock.calls[0]?.[0]).toEqual({ comercianteId: "c-job", dataReferencia: "2026-10-16" });
  });
});
