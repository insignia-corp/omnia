import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { RELOGIO, dataLocal, type Relogio } from "../../src/canal/relogio";

describe("data fixa da demo (e2e)", () => {
  afterEach(() => {
    delete process.env.DEMO_DATA_REFERENCIA;
  });

  it("DEMO_DATA_REFERENCIA trava a data do relógio do canal", async () => {
    process.env.DEMO_DATA_REFERENCIA = "2026-10-20";
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = modulo.createNestApplication({ logger: false });
    await app.init();
    try {
      expect(dataLocal(app.get<Relogio>(RELOGIO).agora(), "America/Sao_Paulo")).toBe("2026-10-20");
    } finally {
      await app.close();
    }
  });

  it("sem a variável, o relógio é o do sistema", async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = modulo.createNestApplication({ logger: false });
    await app.init();
    try {
      const diff = Math.abs(app.get<Relogio>(RELOGIO).agora().getTime() - Date.now());
      expect(diff).toBeLessThan(5_000);
    } finally {
      await app.close();
    }
  });
});
