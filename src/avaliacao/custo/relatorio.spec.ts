import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { estatisticas, type Amostra } from "./estatisticas";
import { PREMISSAS_PADRAO, projetarMes } from "./projecao";
import {
  gravarRelatorioDeCusto,
  nomeDoRelatorioDeCusto,
  renderizarRelatorioDeCusto,
  type RodadaDeCusto,
} from "./relatorio";

const a = (gatilho: Amostra["gatilho"], custo: number | null, ms: number): Amostra => ({
  gatilho,
  custoMicrodolares: custo,
  latenciaMs: ms,
  modelo: "claude-sonnet-5-5",
});

function rodada(amostras: Amostra[], extra: Partial<RodadaDeCusto["premissas"]> = {}): RodadaDeCusto {
  const medidas = estatisticas(amostras);
  const premissas = { ...PREMISSAS_PADRAO, mensagensPorMes: 40, ...extra };
  return {
    iniciadaEm: "2026-10-21T22:00:00.000Z",
    modelo: "claude-sonnet-5-5",
    modeloExtrator: "claude-sonnet-5-5",
    versaoPromptAgente: "sistema-v3",
    versaoPromptExtrator: "extrator-v1",
    fontes: { agente: "evidencias/a.json", extracao: "evidencias/e.json" },
    estatisticas: medidas,
    premissas,
    projecao: projetarMes(medidas, premissas),
  };
}

const completo = [
  a("relatorio_diario", 40_000, 9000),
  a("mensagem_dono", 20_000, 5000),
  a("mensagem_dono", 24_000, 8000),
  a("extracao_nota", 9_000, 4000),
];

describe("renderizarRelatorioDeCusto", () => {
  it("traz custo por execução, tempo p50 e p95, meta de 20 s e custo mensal, sem travessões", () => {
    const md = renderizarRelatorioDeCusto(rodada(completo));
    for (const trecho of [
      "# Custo e tempo por execução: claude-sonnet-5-5",
      "| Pergunta do dono (conversa) | 2 | US$ 0,0220 | 5,0 s | 8,0 s | 8,0 s |",
      "p95 de 8,0 s; a meta é p95 em até 20,0 s: **atingida**",
      "| **LLM, total** | | | **US$ 1,5460** |",
      "Sem valor nesta rodada: mensagens do canal; agregador.",
    ]) {
      expect(md).toContain(trecho);
    }
    expect(md).not.toMatch(/[—–]/);
  });

  it("pergunta lenta reprova a meta de tempo", () => {
    const md = renderizarRelatorioDeCusto(
      rodada([a("mensagem_dono", 1000, 25_000), ...completo.slice(0, 1)]),
    );
    expect(md).toContain("**NÃO atingida**");
  });

  it("execução não medida aparece como não medido, e o LLM como indisponível, nunca US$ 0", () => {
    const md = renderizarRelatorioDeCusto(rodada(completo.slice(1)));
    expect(md).toContain("Relatório diário não medido");
    expect(md).toContain("| Relatório diário | 0 | não medido | não medido |");
    expect(md).toContain("| **LLM, total** | | | **indisponível** |");
  });

  it("com mensagem e agregador informados, entram no total e nada fica sem valor", () => {
    const md = renderizarRelatorioDeCusto(
      rodada(completo, {
        custoPorMensagemMicrodolares: 6_800,
        agregadorMensalMicrodolares: 460_000_000,
        lojistas: 100,
      }),
    );
    expect(md).toContain("Todos os componentes têm valor.");
    expect(md).toContain("Agregador (dividido por 100 lojistas)");
  });
});

describe("gravarRelatorioDeCusto", () => {
  it("grava em AAAA-MM-DD-custo-<modelo>.md", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "custo-rel-"));
    try {
      const r = rodada(completo);
      const caminho = gravarRelatorioDeCusto(r, path.join(dir, "docs"));
      expect(path.basename(caminho)).toBe("2026-10-21-custo-claude-sonnet-5-5.md");
      expect(nomeDoRelatorioDeCusto(r)).toBe(path.basename(caminho));
      expect(readFileSync(caminho, "utf8")).toContain("## Custo mensal por lojista");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
