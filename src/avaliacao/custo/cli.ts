import path from "node:path";
import { parseArgs } from "node:util";
import {
  amostrasDaExtracao,
  amostrasDoAgente,
  ErroDeCusto,
  lerRodadaAgente,
  lerRodadaExtracao,
} from "./amostras";
import {
  inteiroPositivo,
  maisRecente,
  microdolaresDe,
  PADRAO_AGENTE_REAL,
  PADRAO_EXTRACAO_REAL,
} from "./argumentos";
import { estatisticas } from "./estatisticas";
import { PREMISSAS_PADRAO, projetarMes, type PremissasMensais } from "./projecao";
import { gravarRelatorioDeCusto, META_PERGUNTA_P95_MS, type RodadaDeCusto } from "./relatorio";

const USO = `Uso: npm run eval:custo -- [--agente evidencias/<rodada>.json] [--extracao evidencias/<rodada>.json]
                             [--relatorios 30] [--perguntas 10] [--notas 14] [--lojistas 1]
                             [--mensagem-usd 0.0068] [--agregador-usd-mes 460]

Custo por execução, custo mensal por lojista e tempo p50 e p95, a partir da saída bruta de rodadas com modelo real:
  npm run eval -- --modelo real           (agente; precisa do seed: npm run seed:demo)
  npm run eval:extracao -- --modelo real  (Extrator)
Sem --agente e --extracao, usa a rodada real mais recente de evidencias/.

Mensagem e agregador não têm cotação no repositório: sem as flags, ficam fora do total e o relatório diz isso.
--lojistas divide a mensalidade do agregador. O padrão de uso é o da especificação dos agentes (seção 4).`;

function principal(): number {
  const { values } = parseArgs({
    options: {
      agente: { type: "string" },
      extracao: { type: "string" },
      relatorios: { type: "string" },
      perguntas: { type: "string" },
      notas: { type: "string" },
      lojistas: { type: "string" },
      "mensagem-usd": { type: "string" },
      "agregador-usd-mes": { type: "string" },
      ajuda: { type: "boolean", default: false },
    },
  });
  if (values.ajuda) {
    console.log(USO);
    return 0;
  }
  const evidencias = path.resolve("evidencias");
  const caminhoAgente = values.agente ?? maisRecente(evidencias, PADRAO_AGENTE_REAL);
  const caminhoExtracao = values.extracao ?? maisRecente(evidencias, PADRAO_EXTRACAO_REAL);
  if (!caminhoAgente)
    throw new ErroDeCusto(
      `Nenhuma rodada real do agente em evidencias/. Rode: npm run eval -- --modelo real\n\n${USO}`,
    );
  if (!caminhoExtracao)
    throw new ErroDeCusto(
      `Nenhuma rodada real da extração em evidencias/. Rode: npm run eval:extracao -- --modelo real\n\n${USO}`,
    );

  const agente = lerRodadaAgente(caminhoAgente);
  const extracao = lerRodadaExtracao(caminhoExtracao);
  const medidas = estatisticas([...amostrasDoAgente(agente), ...amostrasDaExtracao(extracao)]);

  const relatorios = values.relatorios
    ? inteiroPositivo(values.relatorios, "--relatorios")
    : PREMISSAS_PADRAO.relatoriosPorMes;
  const perguntas = values.perguntas
    ? inteiroPositivo(values.perguntas, "--perguntas")
    : PREMISSAS_PADRAO.perguntasPorMes;
  const premissas: PremissasMensais = {
    ...PREMISSAS_PADRAO,
    relatoriosPorMes: relatorios,
    perguntasPorMes: perguntas,
    notasPorMes: values.notas ? inteiroPositivo(values.notas, "--notas") : PREMISSAS_PADRAO.notasPorMes,
    lojistas: values.lojistas ? inteiroPositivo(values.lojistas, "--lojistas") : PREMISSAS_PADRAO.lojistas,
    // Um relatório proativo por dia e uma resposta por pergunta.
    mensagensPorMes: relatorios + perguntas,
    custoPorMensagemMicrodolares: values["mensagem-usd"]
      ? microdolaresDe(values["mensagem-usd"], "--mensagem-usd")
      : null,
    agregadorMensalMicrodolares: values["agregador-usd-mes"]
      ? microdolaresDe(values["agregador-usd-mes"], "--agregador-usd-mes")
      : null,
  };
  const rodada: RodadaDeCusto = {
    iniciadaEm: new Date().toISOString(),
    modelo: agente.modelo,
    modeloExtrator: extracao.modelo,
    versaoPromptAgente: agente.versaoPrompt,
    versaoPromptExtrator: extracao.versaoPrompt,
    fontes: {
      agente: path.relative(process.cwd(), caminhoAgente),
      extracao: path.relative(process.cwd(), caminhoExtracao),
    },
    estatisticas: medidas,
    premissas,
    projecao: projetarMes(medidas, premissas),
  };
  const arquivo = gravarRelatorioDeCusto(rodada, path.resolve("docs/avaliacoes"));
  const pergunta = medidas.find((m) => m.gatilho === "mensagem_dono");
  console.log(`Relatório: ${path.relative(process.cwd(), arquivo)}`);
  console.log(`Pergunta p95: ${pergunta?.latenciaP95Ms ?? "n/d"} ms (meta ${META_PERGUNTA_P95_MS} ms)`);
  return pergunta && pergunta.execucoes > 0 && pergunta.latenciaP95Ms > META_PERGUNTA_P95_MS ? 1 : 0;
}

try {
  process.exitCode = principal();
} catch (e) {
  console.error(e instanceof ErroDeCusto ? e.message : e);
  process.exitCode = 2;
}
