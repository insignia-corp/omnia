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

  it("define os tokens de cor do painel do dono no :root", () => {
    const tokens: Record<string, string> = {
      "--verde": "#15803D",
      "--verde-escuro": "#14532D",
      "--verde-claro": "#DCFCE7",
      "--vermelho": "#DC2626",
      "--vermelho-claro": "#FEE2E2",
      "--ambar": "#D97706",
      "--ambar-claro": "#FEF3C7",
      "--cinza": "#6B7280",
      "--borda": "#E5E7EB",
      "--fundo": "#FFFFFF",
      "--texto": "#111827",
    };
    for (const [nome, valor] of Object.entries(tokens)) {
      expect(PAGINA_BASTIDORES).toContain(`${nome}: ${valor}`);
    }
  });

  it("funciona offline: sem CDN, fonte externa nem script remoto", () => {
    expect(PAGINA_BASTIDORES).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(PAGINA_BASTIDORES).not.toMatch(/<link|@import|<script src/);
  });

  it("tem a barra lateral com as âncoras das seções da mesma página", () => {
    for (const ancora of ["ao-vivo", "execucoes", "notas", "alertas"]) {
      expect(PAGINA_BASTIDORES).toContain(`href="#${ancora}"`);
      expect(PAGINA_BASTIDORES).toContain(`id="${ancora}"`);
    }
  });

  it("não calcula dinheiro nem custo com ponto flutuante", () => {
    expect(PAGINA_BASTIDORES).not.toMatch(/parseFloat|toFixed\([^)]*\).*(?:centavos|dolares)/);
  });

  it("o script embutido é JavaScript válido", () => {
    const script = /<script>([\s\S]*)<\/script>/.exec(PAGINA_BASTIDORES)![1]!;
    expect(() => new Function(script)).not.toThrow();
  });
});
