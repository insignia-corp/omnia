import { PinoLogger } from "nestjs-pino";
import { comCorrelacao, idCorrelacaoAtual, idDaRequisicao } from "./correlacao";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const req = (valor: string | string[] | undefined) => ({
  headers: valor === undefined ? {} : { "x-request-id": valor },
});

describe("idDaRequisicao", () => {
  it("mantém um X-Request-Id válido", () => {
    expect(idDaRequisicao(req("abc-123"))).toBe("abc-123");
  });

  it.each([
    ["com espaço", "a b"],
    ["com quebra de linha", "x\ny"],
    ["longo demais", "x".repeat(65)],
    ["repetido (lista)", ["a", "b"]],
    ["ausente", undefined],
  ])("gera um id novo quando o cabeçalho é %s", (_caso, valor) => {
    expect(idDaRequisicao(req(valor))).toMatch(UUID);
  });
});

describe("correlação nos logs", () => {
  const linhas: string[] = [];
  const pino = new PinoLogger({
    pinoHttp: [{ level: "info" }, { write: (s: string) => void linhas.push(s) }],
  });

  it("fora de requisição ou job, cada chamada gera um id novo", () => {
    const um = idCorrelacaoAtual(pino);
    expect(um).toMatch(UUID);
    expect(idCorrelacaoAtual(pino)).not.toBe(um);
  });

  it("dentro do job o id vale para o código e para todo log, mesmo depois de um await", async () => {
    const lido = await comCorrelacao(pino, "abc", { fila: "extrair-nota" }, async () => {
      await Promise.resolve();
      pino.info("dentro");
      return idCorrelacaoAtual(pino);
    });
    expect(lido).toBe("abc");
    const ultima = JSON.parse(linhas[linhas.length - 1]!) as Record<string, unknown>;
    expect(ultima).toMatchObject({ idCorrelacao: "abc", fila: "extrair-nota", msg: "dentro" });
  });

  it("job sem id de origem ganha um id novo", async () => {
    const lido = await comCorrelacao(pino, undefined, {}, () => Promise.resolve(idCorrelacaoAtual(pino)));
    expect(lido).toMatch(UUID);
  });
});
