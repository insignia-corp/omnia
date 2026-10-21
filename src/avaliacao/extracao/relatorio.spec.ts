import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gravarRodada, nomeDaEvidencia, nomeDoRelatorio, renderizarRelatorio, resumir } from "./relatorio";
import { lerEnvExtracao, rodarAvaliacaoExtracao } from "./rodada";
import type { RodadaExtracao } from "./runner";

const env = lerEnvExtracao({});

async function rodadaComErroSilencioso(): Promise<RodadaExtracao> {
  const falsa = await rodarAvaliacaoExtracao({ modo: "falso", env, notas: ["nota-01", "nota-11"] });
  // Quantidade do primeiro item da nota 01 lida errada, com a confiança no máximo.
  const nota = falsa.resultados.find((r) => r.id === "nota-01");
  const item = nota?.extracao?.itens[0];
  if (!nota?.comparacao || !item) throw new Error("fixture inesperada");
  const errado = structuredClone(nota.comparacao);
  const par = errado.itens[0];
  if (par?.obtido) {
    par.obtido.quantidade += 1;
    par.camposErrados = ["quantidade"];
  }
  nota.comparacao = errado;
  return falsa;
}

describe("resumir", () => {
  it("conta o erro silencioso e reprova a meta de erro com confiança baixa", async () => {
    const r = resumir(await rodadaComErroSilencioso());
    expect(r.erros).toEqual({ total: 1, sinalizados: 0, silenciosos: 1 });
    expect(r.camposItem.quantidade).toEqual({ certos: 17, total: 18 });
    expect(r.metas.errosComConfiancaBaixa).toBe(false);
  });

  it("calibração: o limite vigente aparece e abaixo de 0,6 o item borrado deixa de ser perguntado", async () => {
    const r = resumir(await rodarAvaliacaoExtracao({ modo: "falso", env, notas: ["nota-11"] }));
    expect(r.calibracao.map((l) => l.limite)).toContain(0.8);
    expect(r.calibracao.find((l) => l.limite === 0.5)?.itensAbaixo).toBe(0);
    expect(r.calibracao.find((l) => l.limite === 0.8)?.itensAbaixo).toBe(1);
  });
});

describe("renderizarRelatorio", () => {
  it("traz metas, campos, calibração, erro silencioso e itens abaixo do limite, sem travessões", async () => {
    const md = renderizarRelatorio(await rodadaComErroSilencioso());
    for (const trecho of [
      "# Avaliação da extração de notas: extrator-v1",
      "Modo falso:",
      "NÃO atingida",
      "(vigente)",
      "item 1: quantidade (SILENCIOSO, confiança alta)",
      "| nota-11 | 3 | SALG MILHO 100G | 0,5 |",
    ]) {
      expect(md).toContain(trecho);
    }
    expect(md).not.toMatch(/[—–]/);
  });

  it("rodada sem erro: diz que não houve divergência", async () => {
    const md = renderizarRelatorio(await rodarAvaliacaoExtracao({ modo: "falso", env, notas: ["nota-01"] }));
    expect(md).toContain("Nenhuma divergência nesta rodada.");
    expect(md).toContain("atingida");
    expect(md).not.toContain("NÃO atingida");
  });
});

describe("gravarRodada", () => {
  it("grava o relatório e a saída bruta e a rodada falsa não colide com a real", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "eval-extracao-"));
    try {
      const rodada = await rodarAvaliacaoExtracao({ modo: "falso", env, notas: ["nota-01"] });
      const a = gravarRodada(rodada, {
        relatorios: path.join(dir, "docs"),
        evidencias: path.join(dir, "evid"),
      });
      expect(path.basename(a.relatorio)).toBe(nomeDoRelatorio(rodada));
      expect(path.basename(a.relatorio)).toMatch(/^\d{4}-\d{2}-\d{2}-extrator-v1-falso\.md$/);
      expect(path.basename(a.evidencia)).toBe(nomeDaEvidencia(rodada));
      expect(readFileSync(a.relatorio, "utf8")).toContain("# Avaliação da extração de notas");
      expect((JSON.parse(readFileSync(a.evidencia, "utf8")) as RodadaExtracao).resultados).toHaveLength(1);
      expect(nomeDoRelatorio({ ...rodada, modo: "real", modelo: "claude-sonnet-5-5" })).toMatch(
        /-extrator-v1-claude-sonnet-5-5\.md$/,
      );
      // A saída bruta nunca é sobrescrita.
      expect(() =>
        gravarRodada(rodada, { relatorios: path.join(dir, "docs"), evidencias: path.join(dir, "evid") }),
      ).toThrow();
      expect(existsSync(a.evidencia)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
