import { PAGINA_BASTIDORES } from "./pagina-bastidores";
import { PAGINA_CHAT } from "./pagina-chat";

describe.each([
  ["bastidores", PAGINA_BASTIDORES],
  ["chat", PAGINA_CHAT],
])("página %s", (_nome, pagina) => {
  it("não usa travessões nos textos", () => {
    expect(pagina).not.toMatch(/[—–]/);
  });

  it("não escreve dado como HTML", () => {
    expect(pagina).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write/);
  });

  it("manda o comerciante no cabeçalho da sessão", () => {
    expect(pagina).toContain("X-Comerciante-Id");
  });
});

describe("página bastidores", () => {
  it("consulta o painel", () => {
    expect(PAGINA_BASTIDORES).toContain("/bastidores/painel");
  });
});
