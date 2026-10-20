import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  formatarMicrodolares,
  gravarRodada,
  nomeDaEvidencia,
  nomeDoRelatorio,
  renderizarRelatorio,
  resumir,
} from "./relatorio";
import type { ResultadoCaso, Rodada } from "./tipos";

const resultado = (extra: Partial<ResultadoCaso>): ResultadoCaso => ({
  id: "q01",
  categoria: "numerica",
  descricao: "Quanto vendi ontem?",
  aprovado: true,
  motivos: [],
  resultadoAgente: "aprovada",
  mensagem: "Ontem você vendeu R$ 1.221,51.",
  ferramentasChamadas: [{ ferramenta: "get_daily_summary", erro: null, latenciaMs: 4 }],
  bloqueios: 0,
  iteracoes: 2,
  modelo: "claude-sonnet-5-5",
  custoEstimadoMicrodolares: 41_200,
  latenciaMs: 1800,
  tokensEntrada: 3000,
  tokensSaida: 400,
  execucaoId: "e1",
  ...extra,
});

const rodada = (resultados: ResultadoCaso[], extra: Partial<Rodada> = {}): Rodada => ({
  iniciadaEm: "2026-10-21T14:30:15.000Z",
  modo: "real",
  modelo: "claude-sonnet-5-5",
  versaoPrompt: "sistema-v2",
  comerciante: "Mercadinho Vila Nova",
  dataReferencia: "2026-10-20",
  resultados,
  ...extra,
});

const mista = rodada([
  resultado({}),
  resultado({ id: "q02", custoEstimadoMicrodolares: 38_800, latenciaMs: 2200 }),
  resultado({
    id: "q33",
    categoria: "sem_resposta",
    descricao: "Qual foi meu lucro do mês?",
    aprovado: false,
    motivos: ["Respondeu com número em vez de dizer que não sabe: R$ 5.000,00", "Outro | motivo"],
    mensagem: "Seu lucro foi R$ 5.000,00.",
    ferramentasChamadas: [],
    bloqueios: 1,
    custoEstimadoMicrodolares: 20_000,
    latenciaMs: 1000,
  }),
]);

describe("resumir", () => {
  it("conta acertos por categoria e soma custo e latência", () => {
    expect(resumir(mista.resultados)).toEqual({
      total: 3,
      acertos: 2,
      porCategoria: [
        { categoria: "numerica", total: 2, acertos: 2 },
        { categoria: "sem_resposta", total: 1, acertos: 0 },
      ],
      custoTotalMicrodolares: 100_000,
      latenciaMediaMs: 1667,
      latenciaMaximaMs: 2200,
    });
  });

  it("rodada vazia não divide por zero", () => {
    expect(resumir([])).toMatchObject({ total: 0, acertos: 0, latenciaMediaMs: 0, latenciaMaximaMs: 0 });
  });
});

describe("formatarMicrodolares", () => {
  it("mostra dólares com 4 casas, em aritmética inteira", () => {
    expect(formatarMicrodolares(0)).toBe("US$ 0,0000");
    expect(formatarMicrodolares(41_200)).toBe("US$ 0,0412");
    expect(formatarMicrodolares(2_100_000)).toBe("US$ 2,1000");
  });
});

describe("renderizarRelatorio", () => {
  const md = renderizarRelatorio(mista);

  it("traz modelo, versão do prompt, comerciante e a data da rodada", () => {
    expect(md).toContain("# Avaliação do agente: sistema-v2, claude-sonnet-5-5");
    expect(md).toContain("| Versão do prompt | sistema-v2 |");
    expect(md).toContain("| Modelo | claude-sonnet-5-5 |");
    expect(md).toContain("| Comerciante | Mercadinho Vila Nova |");
    expect(md).toContain("| Rodada | 2026-10-21T14:30:15.000Z |");
  });

  it("traz acertos por categoria e o total", () => {
    expect(md).toContain("**2 de 3 casos passaram (66,7%).**");
    expect(md).toContain("| numerica | 2 | 2 | 100% |");
    expect(md).toContain("| sem_resposta | 0 | 1 | 0% |");
  });

  it("lista cada falha com o motivo e a mensagem enviada", () => {
    expect(md).toContain("### q33 (sem_resposta)");
    expect(md).toContain("- Respondeu com número em vez de dizer que não sabe: R$ 5.000,00");
    expect(md).toContain('Mensagem enviada: "Seu lucro foi R$ 5.000,00."');
    expect(md).not.toContain("### q01");
  });

  it("traz custo e latência de cada execução e o custo total", () => {
    expect(md).toContain("Custo estimado da rodada: US$ 0,1000.");
    expect(md).toContain("média de 1667 ms, máxima de 2200 ms");
    expect(md).toContain(
      "| q01 (passou) | numerica | aprovada | get_daily_summary | 2 | 0 | US$ 0,0412 | 1800 |",
    );
    expect(md).toContain("| q33 (falhou) | sem_resposta | aprovada | nenhuma | 2 | 1 | US$ 0,0200 | 1000 |");
  });

  it("sem falhas, diz isso", () => {
    expect(renderizarRelatorio(rodada([resultado({})]))).toContain("Nenhuma falha nesta rodada.");
  });

  it("não usa travessões e não quebra a tabela com barra vertical", () => {
    expect(md).not.toMatch(/[–—]/);
    const falsa = renderizarRelatorio(
      rodada([resultado({ ferramentasChamadas: [{ ferramenta: "a|b", erro: null, latenciaMs: 1 }] })]),
    );
    expect(falsa).toContain("a\\|b");
  });

  it("no modo falso, avisa que é roteirizado e que não há custo", () => {
    const md2 = renderizarRelatorio(rodada([resultado({})], { modo: "falso", modelo: "falso-roteirizado" }));
    expect(md2).toContain("# Avaliação do agente: sistema-v2, modelo falso");
    expect(md2).toContain("| Modo | falso (roteirizado, sem custo) |");
  });
});

describe("nomes e gravação", () => {
  it("relatório real: data, versão do prompt e modelo; falso: sufixo falso", () => {
    expect(nomeDoRelatorio(mista)).toBe("2026-10-21-sistema-v2-claude-sonnet-5-5.md");
    expect(nomeDoRelatorio(rodada([], { modo: "falso" }))).toBe("2026-10-21-sistema-v2-falso.md");
  });

  it("saída bruta leva a hora, para rodadas do mesmo dia não se perderem", () => {
    expect(nomeDaEvidencia(mista)).toBe("2026-10-21-eval-real-143015.json");
  });

  it("grava o relatório versionado e a saída bruta completa, criando as pastas", () => {
    const base = mkdtempSync(path.join(tmpdir(), "omnia-eval-"));
    try {
      const arquivos = gravarRodada(mista, {
        relatorios: path.join(base, "docs/avaliacoes"),
        evidencias: path.join(base, "evidencias"),
      });
      expect(path.basename(arquivos.relatorio)).toBe("2026-10-21-sistema-v2-claude-sonnet-5-5.md");
      expect(readFileSync(arquivos.relatorio, "utf8")).toBe(renderizarRelatorio(mista));
      const bruto = JSON.parse(readFileSync(arquivos.evidencia, "utf8")) as Rodada;
      expect(bruto.resultados).toHaveLength(3);
      expect(bruto.resultados[2]?.mensagem).toBe("Seu lucro foi R$ 5.000,00.");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
