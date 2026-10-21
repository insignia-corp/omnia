import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { formatarMicrodolares } from "../relatorio";
import type { EstatisticaGatilho } from "./estatisticas";
import type { LinhaMensal, PremissasMensais, ProjecaoMensal } from "./projecao";

/** Meta da especificação dos agentes (seção 8): resposta a uma pergunta em cerca de 20 s ou menos. */
export const META_PERGUNTA_P95_MS = 20_000;

export interface RodadaDeCusto {
  iniciadaEm: string;
  modelo: string;
  modeloExtrator: string;
  versaoPromptAgente: string;
  versaoPromptExtrator: string;
  /** Arquivos de onde as medidas saíram, relativos à raiz. */
  fontes: { agente: string; extracao: string };
  estatisticas: EstatisticaGatilho[];
  premissas: PremissasMensais;
  projecao: ProjecaoMensal;
}

const NOME_GATILHO: Record<EstatisticaGatilho["gatilho"], string> = {
  relatorio_diario: "Relatório diário",
  mensagem_dono: "Pergunta do dono (conversa)",
  extracao_nota: "Extração de nota",
};

/** Micro-dólares para "US$ 0,0412"; `null` é custo que não existe, nunca zero. */
const usd = (micro: number | null) => (micro === null ? "indisponível" : formatarMicrodolares(micro));
const segundos = (ms: number) => `${(Math.round(ms / 100) / 10).toFixed(1).replace(".", ",")} s`;

function linhaMensal(l: LinhaMensal, naoCotado: string): string {
  return `| ${l.rotulo} | ${l.quantidade} | ${l.custoUnitarioMicrodolares === null ? naoCotado : usd(l.custoUnitarioMicrodolares)} | ${l.custoMensalMicrodolares === null ? naoCotado : usd(l.custoMensalMicrodolares)} |`;
}

/** Relatório de custo e tempo em Markdown. Texto sem travessões, como o resto da documentação. */
export function renderizarRelatorioDeCusto(r: RodadaDeCusto): string {
  const pergunta = r.estatisticas.find((e) => e.gatilho === "mensagem_dono");
  const diario = r.estatisticas.find((e) => e.gatilho === "relatorio_diario");
  const dentroDaMeta =
    pergunta && pergunta.execucoes > 0 ? pergunta.latenciaP95Ms <= META_PERGUNTA_P95_MS : null;
  const p = r.premissas;
  const L: string[] = [
    `# Custo e tempo por execução: ${r.modelo}`,
    "",
    "| | |",
    "| --- | --- |",
    `| Rodada | ${r.iniciadaEm} |`,
    `| Modelo do Analista | ${r.modelo} (prompt ${r.versaoPromptAgente}) |`,
    `| Modelo do Extrator | ${r.modeloExtrator} (prompt ${r.versaoPromptExtrator}) |`,
    `| Fonte do agente | \`${r.fontes.agente}\` |`,
    `| Fonte da extração | \`${r.fontes.extracao}\` |`,
    `| Gerado por | \`npm run eval:custo\` |`,
    "",
    "## Custo e tempo por execução",
    "",
    "| Execução | Amostras | Custo médio | Tempo p50 | Tempo p95 | Tempo máximo |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...r.estatisticas.map(
      (e) =>
        `| ${NOME_GATILHO[e.gatilho]} | ${e.execucoes} | ${e.execucoes === 0 ? "não medido" : usd(e.custoMedioMicrodolares)} | ${e.execucoes === 0 ? "não medido" : segundos(e.latenciaP50Ms)} | ${e.execucoes === 0 ? "não medido" : segundos(e.latenciaP95Ms)} | ${e.execucoes === 0 ? "não medido" : segundos(e.latenciaMaximaMs)} |`,
    ),
    "",
    "Percentis pelo posto mais próximo, sem interpolar. Custo estimado a partir dos tokens e do preço por modelo em `src/agente/llm/modelo-linguagem.ts`.",
    "",
    "## Tempo de resposta",
    "",
    dentroDaMeta === null
      ? "Nenhuma pergunta do dono medida nesta rodada."
      : `Pergunta do dono: p50 de ${segundos(pergunta?.latenciaP50Ms ?? 0)} e p95 de ${segundos(pergunta?.latenciaP95Ms ?? 0)}; a meta é p95 em até ${segundos(META_PERGUNTA_P95_MS)}: **${dentroDaMeta ? "atingida" : "NÃO atingida"}**.`,
    "",
    ...(diario && diario.execucoes > 0
      ? []
      : ["Relatório diário não medido: a rodada não tem caso desse gatilho.", ""]),
    "## Custo mensal por lojista",
    "",
    `Premissas: ${p.relatoriosPorMes} relatórios, ${p.perguntasPorMes} perguntas e ${p.notasPorMes} notas por mês, ${p.mensagensPorMes} mensagens enviadas, ${p.lojistas} lojista${p.lojistas === 1 ? "" : "s"} dividindo o agregador. Mudam com as flags da CLI.`,
    "",
    "| Componente | Por mês | Custo unitário | Custo no mês |",
    "| --- | ---: | ---: | ---: |",
    ...r.projecao.llm.map((l) => linhaMensal(l, "não medido")),
    `| **LLM, total** | | | **${usd(r.projecao.llmTotalMicrodolares)}** |`,
    linhaMensal(r.projecao.mensagens, "sem cotação"),
    linhaMensal(r.projecao.agregador, "sem cotação"),
    `| **Total dos componentes com valor** | | | **${usd(r.projecao.totalCotadoMicrodolares)}** |`,
    "",
    r.projecao.naoCotados.length === 0
      ? "Todos os componentes têm valor."
      : `Sem valor nesta rodada: ${r.projecao.naoCotados.join("; ")}. O total acima não os inclui. Informe-os com \`--mensagem-usd\` e \`--agregador-usd-mes\` (o agregador é cotação pendente: ver \`docs/contexto-hackathon.md\`).`,
    "",
  ];
  return L.join("\n");
}

/** `AAAA-MM-DD-custo-<modelo>.md`: o dia da rodada e o modelo do Analista. */
export function nomeDoRelatorioDeCusto(r: RodadaDeCusto): string {
  return `${r.iniciadaEm.slice(0, 10)}-custo-${r.modelo}.md`;
}

/** Relatório versionado em `docs/avaliacoes/`; o de mesmo dia e modelo é substituído (o git guarda o anterior). */
export function gravarRelatorioDeCusto(r: RodadaDeCusto, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const caminho = path.join(dir, nomeDoRelatorioDeCusto(r));
  writeFileSync(caminho, renderizarRelatorioDeCusto(r));
  return caminho;
}
