import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  amostrasDaExtracao,
  amostrasDoAgente,
  ErroDeCusto,
  lerRodadaAgente,
  lerRodadaExtracao,
} from "./amostras";

const agente = (extra: Record<string, unknown> = {}) => ({
  iniciadaEm: "2026-10-21T10:00:00.000Z",
  modo: "real",
  modelo: "claude-sonnet-5-5",
  versaoPrompt: "sistema-v3",
  resultados: [
    {
      id: "q01",
      gatilho: "mensagem_dono",
      resultadoAgente: "aprovada",
      custoEstimadoMicrodolares: 20_000,
      latenciaMs: 5000,
      modelo: "claude-sonnet-5-5",
    },
    {
      id: "d01",
      gatilho: "relatorio_diario",
      resultadoAgente: "aprovada",
      custoEstimadoMicrodolares: 40_000,
      latenciaMs: 9000,
      modelo: "claude-sonnet-5-5",
    },
    {
      id: "x",
      gatilho: "mensagem_dono",
      resultadoAgente: "sem_execucao",
      custoEstimadoMicrodolares: 0,
      latenciaMs: 1,
      modelo: "claude-sonnet-5-5",
    },
  ],
  ...extra,
});

const extracao = (extra: Record<string, unknown> = {}) => ({
  iniciadaEm: "2026-10-21T10:00:00.000Z",
  modo: "real",
  modelo: "claude-sonnet-5-5",
  versaoPrompt: "extrator-v1",
  resultados: [
    {
      id: "nota-01",
      falha: null,
      custoEstimadoMicrodolares: 9000,
      latenciaMs: 4000,
      modelo: "claude-sonnet-5-5",
    },
    {
      id: "nota-02",
      falha: { tipo: "erro_transitorio" },
      custoEstimadoMicrodolares: 0,
      latenciaMs: 1,
      modelo: "claude-sonnet-5-5",
    },
    { id: "nota-03", falha: null, custoEstimadoMicrodolares: null, latenciaMs: 5000, modelo: "modelo-novo" },
  ],
  ...extra,
});

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "amostras-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function arquivo(nome: string, conteudo: unknown): string {
  const caminho = path.join(dir, nome);
  writeFileSync(caminho, typeof conteudo === "string" ? conteudo : JSON.stringify(conteudo));
  return caminho;
}

describe("lerRodadaAgente e amostrasDoAgente", () => {
  it("lê a saída bruta e ignora o caso que nem chegou a executar", () => {
    const r = lerRodadaAgente(arquivo("a.json", agente()));
    expect(amostrasDoAgente(r)).toEqual([
      { gatilho: "mensagem_dono", custoMicrodolares: 20_000, latenciaMs: 5000, modelo: "claude-sonnet-5-5" },
      {
        gatilho: "relatorio_diario",
        custoMicrodolares: 40_000,
        latenciaMs: 9000,
        modelo: "claude-sonnet-5-5",
      },
    ]);
  });

  it("recusa a rodada falsa: custo e tempo do modelo roteirizado não valem", () => {
    expect(() => lerRodadaAgente(arquivo("f.json", agente({ modo: "falso" })))).toThrow(/modo "falso"/);
  });

  it("recusa saída antiga sem gatilho por caso e arquivo ilegível", () => {
    const antiga = agente();
    antiga.resultados = antiga.resultados.map(({ gatilho: _g, ...resto }) => resto) as never;
    expect(() => lerRodadaAgente(arquivo("antiga.json", antiga))).toThrow(ErroDeCusto);
    expect(() => lerRodadaAgente(arquivo("lixo.json", "{não é json"))).toThrow(ErroDeCusto);
    expect(() => lerRodadaAgente(path.join(dir, "nao-existe.json"))).toThrow(ErroDeCusto);
  });
});

describe("lerRodadaExtracao e amostrasDaExtracao", () => {
  it("só conta nota que o Extrator devolveu e preserva custo indisponível", () => {
    const r = lerRodadaExtracao(arquivo("e.json", extracao()));
    expect(amostrasDaExtracao(r)).toEqual([
      { gatilho: "extracao_nota", custoMicrodolares: 9000, latenciaMs: 4000, modelo: "claude-sonnet-5-5" },
      { gatilho: "extracao_nota", custoMicrodolares: null, latenciaMs: 5000, modelo: "modelo-novo" },
    ]);
  });

  it("recusa a rodada falsa", () => {
    expect(() => lerRodadaExtracao(arquivo("ef.json", extracao({ modo: "falso" })))).toThrow(/modo "falso"/);
  });
});
