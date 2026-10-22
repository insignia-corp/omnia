import type Redis from "ioredis";
import { FilaReajuste } from "./fila-reajuste";
import type { VerificadorDeReajuste } from "./verificar-reajuste";

const add = jest.fn();
jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => ({ add, close: jest.fn() })),
  Worker: jest.fn(),
}));

describe("FilaReajuste.enfileirar", () => {
  it("usa comerciante e documento como jobId e não mexe em estado do processo", async () => {
    const fila = new FilaReajuste({} as Redis, {} as VerificadorDeReajuste);
    await fila.enfileirar({ documentoId: "d1", comercianteId: "c1" });
    expect(add).toHaveBeenCalledWith(
      "reajuste-pos-nota",
      { documentoId: "d1", comercianteId: "c1" },
      expect.objectContaining({ jobId: "c1_d1", attempts: 3 }),
    );
  });
});
