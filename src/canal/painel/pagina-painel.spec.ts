import { PAGINA_PAINEL } from "./pagina-painel";

describe("página do painel", () => {
  it("não usa travessões nos textos", () => {
    expect(PAGINA_PAINEL).not.toMatch(/[—–]/);
  });

  it("não escreve dado como HTML", () => {
    expect(PAGINA_PAINEL).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  });

  it("não converte dinheiro com ponto flutuante (regra 2)", () => {
    expect(PAGINA_PAINEL).not.toMatch(/parseFloat|toFixed|\/ ?100\b/);
  });

  it("consulta os dados com o comerciante no cabeçalho da sessão", () => {
    expect(PAGINA_PAINEL).toContain(
      'fetch("/painel/dados", { headers: { "X-Comerciante-Id": comerciante } })',
    );
  });

  it("não carrega nada de fora (a demonstração roda sem internet)", () => {
    expect(PAGINA_PAINEL).not.toMatch(/<link|<script src|@import|https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
  });

  it("usa as cores combinadas com a tela de bastidores", () => {
    for (const token of [
      "--verde: #15803D",
      "--verde-escuro: #14532D",
      "--vermelho: #DC2626",
      "--ambar: #D97706",
    ]) {
      expect(PAGINA_PAINEL).toContain(token);
    }
  });

  it("mantém as referências das comparações", () => {
    for (const ref of [
      "da média dos 7 dias anteriores",
      "da semana anterior",
      "do mesmo período do mês anterior",
    ]) {
      expect(PAGINA_PAINEL).toContain(ref);
    }
  });

  it("o botão do WhatsApp volta para a conversa do mesmo comerciante", () => {
    expect(PAGINA_PAINEL).toContain('"/whatsapp?comerciante=" + encodeURIComponent(comerciante)');
  });
});
