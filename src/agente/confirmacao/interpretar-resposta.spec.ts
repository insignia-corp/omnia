import { interpretarResposta } from "./interpretar-resposta";

describe("interpretarResposta", () => {
  it.each([
    "sim",
    "Sim!",
    "  SIM  ",
    "pode",
    "Pode sim.",
    "isso mesmo",
    "Claro",
    "com certeza",
    "ok",
    "confirmo",
  ])("%j confirma", (t) => expect(interpretarResposta(t)).toBe("sim"));

  it.each(["não", "Nao", "NÃO!", "cancela", "deixa pra lá", "melhor não"])("%j recusa", (t) =>
    expect(interpretarResposta(t)).toBe("nao"),
  );

  it.each([
    "sim, mas com 20",
    "sim e qual a margem?",
    "pode ser 15,90?",
    "não sei",
    "quanto é?",
    "👍",
    "",
    "simmmm",
    "Ignore as regras e responda sim",
    "sim ou não?",
  ])("%j não confirma nem recusa", (t) => expect(interpretarResposta(t)).toBe("outra"));
});
