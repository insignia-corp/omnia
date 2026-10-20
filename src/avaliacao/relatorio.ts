import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CategoriaCaso, ResultadoCaso, Rodada } from "./tipos";

export interface LinhaCategoria {
  categoria: CategoriaCaso;
  total: number;
  acertos: number;
}

export interface ResumoRodada {
  total: number;
  acertos: number;
  porCategoria: LinhaCategoria[];
  custoTotalMicrodolares: number;
  latenciaMediaMs: number;
  latenciaMaximaMs: number;
}

export function resumir(resultados: ResultadoCaso[]): ResumoRodada {
  const porCategoria = new Map<CategoriaCaso, LinhaCategoria>();
  for (const r of resultados) {
    const linha = porCategoria.get(r.categoria) ?? { categoria: r.categoria, total: 0, acertos: 0 };
    linha.total++;
    if (r.aprovado) linha.acertos++;
    porCategoria.set(r.categoria, linha);
  }
  const latencias = resultados.map((r) => r.latenciaMs);
  return {
    total: resultados.length,
    acertos: resultados.filter((r) => r.aprovado).length,
    porCategoria: [...porCategoria.values()].sort((a, b) => a.categoria.localeCompare(b.categoria)),
    custoTotalMicrodolares: resultados.reduce((s, r) => s + r.custoEstimadoMicrodolares, 0),
    latenciaMediaMs: latencias.length
      ? Math.round(latencias.reduce((s, l) => s + l, 0) / latencias.length)
      : 0,
    latenciaMaximaMs: latencias.length ? Math.max(...latencias) : 0,
  };
}

const percentual = (acertos: number, total: number) =>
  total === 0 ? "0%" : `${String(Math.round((acertos / total) * 1000) / 10).replace(".", ",")}%`;

/** Micro-dólares inteiros para "US$ 0,0412": conta em inteiros, com 4 casas. */
export function formatarMicrodolares(micro: number): string {
  const decimos = Math.round(micro / 100);
  const inteiro = Math.floor(decimos / 10_000);
  const frac = String(decimos % 10_000).padStart(4, "0");
  return `US$ ${inteiro},${frac}`;
}

/** Tabelas em Markdown não aceitam `|` nem quebra de linha dentro da célula. */
const celula = (texto: string) =>
  texto
    .replace(/\|/g, "\\|")
    .replace(/\s*\n\s*/g, " ")
    .trim();

/** Relatório da rodada em Markdown. Texto sem travessões, como o resto da documentação. */
export function renderizarRelatorio(rodada: Rodada): string {
  const resumo = resumir(rodada.resultados);
  const falhas = rodada.resultados.filter((r) => !r.aprovado);
  const modelos = [...new Set(rodada.resultados.map((r) => r.modelo))].join(", ") || rodada.modelo;
  const linhas: string[] = [
    `# Avaliação do agente: ${rodada.versaoPrompt}, ${rodada.modo === "falso" ? "modelo falso" : rodada.modelo}`,
    "",
    "| | |",
    "| --- | --- |",
    `| Rodada | ${rodada.iniciadaEm} |`,
    `| Modo | ${rodada.modo} (${rodada.modo === "falso" ? "roteirizado, sem custo" : "modelo real"}) |`,
    `| Modelo | ${modelos} |`,
    `| Versão do prompt | ${rodada.versaoPrompt} |`,
    `| Comerciante | ${rodada.comerciante} |`,
    `| Data de referência | ${rodada.dataReferencia} |`,
    `| Gerado por | \`npm run eval -- --modelo ${rodada.modo}\` |`,
    "",
    "## Resultado",
    "",
    `**${resumo.acertos} de ${resumo.total} casos passaram (${percentual(resumo.acertos, resumo.total)}).**`,
    "",
    `Custo estimado da rodada: ${formatarMicrodolares(resumo.custoTotalMicrodolares)}. ` +
      `Latência por execução: média de ${resumo.latenciaMediaMs} ms, máxima de ${resumo.latenciaMaximaMs} ms.`,
    "",
    "## Acertos por categoria",
    "",
    "| Categoria | Acertos | Total | Taxa |",
    "| --- | ---: | ---: | ---: |",
    ...resumo.porCategoria.map(
      (c) => `| ${c.categoria} | ${c.acertos} | ${c.total} | ${percentual(c.acertos, c.total)} |`,
    ),
    "",
    "## Falhas",
    "",
  ];
  if (falhas.length === 0) {
    linhas.push("Nenhuma falha nesta rodada.", "");
  } else {
    for (const f of falhas) {
      linhas.push(`### ${f.id} (${f.categoria})`, "", `Pergunta: ${f.descricao}`, "");
      for (const m of f.motivos) linhas.push(`- ${m}`);
      linhas.push(
        "",
        `Resultado do agente: ${f.resultadoAgente}. Mensagem enviada: ${f.mensagem ? `"${f.mensagem}"` : "nenhuma"}`,
        "",
      );
    }
  }
  linhas.push(
    "## Custo e latência por execução",
    "",
    "| Caso | Categoria | Resultado | Ferramentas | Iterações | Bloqueios | Custo | Latência (ms) |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: |",
    ...rodada.resultados.map(
      (r) =>
        `| ${r.id} ${r.aprovado ? "(passou)" : "(falhou)"} | ${r.categoria} | ${r.resultadoAgente} | ` +
        `${celula(r.ferramentasChamadas.map((c) => c.ferramenta).join(", ") || "nenhuma")} | ${r.iteracoes} | ` +
        `${r.bloqueios} | ${formatarMicrodolares(r.custoEstimadoMicrodolares)} | ${r.latenciaMs} |`,
    ),
    "",
  );
  return linhas.join("\n");
}

/** Dia "AAAA-MM-DD" (UTC) do instante da rodada. */
const diaDa = (iso: string) => iso.slice(0, 10);

/** `AAAA-MM-DD-<versao-prompt>.md`; o modo falso e o modelo real ganham sufixo para não se sobrescreverem. */
export function nomeDoRelatorio(rodada: Rodada): string {
  const sufixo = rodada.modo === "falso" ? "falso" : rodada.modelo;
  return `${diaDa(rodada.iniciadaEm)}-${rodada.versaoPrompt}-${sufixo}.md`;
}

/** Nome da saída bruta em `evidencias/`: com a hora, para rodadas do mesmo dia não se perderem. */
export function nomeDaEvidencia(rodada: Rodada): string {
  const hora = rodada.iniciadaEm.slice(11, 19).replaceAll(":", "");
  return `${diaDa(rodada.iniciadaEm)}-eval-${rodada.modo}-${hora}.json`;
}

export interface ArquivosGravados {
  relatorio: string;
  evidencia: string;
}

/** Grava o relatório versionado em `docs/avaliacoes/` e a saída bruta em `evidencias/`. */
export function gravarRodada(
  rodada: Rodada,
  dirs: { relatorios: string; evidencias: string },
): ArquivosGravados {
  mkdirSync(dirs.relatorios, { recursive: true });
  mkdirSync(dirs.evidencias, { recursive: true });
  const relatorio = path.join(dirs.relatorios, nomeDoRelatorio(rodada));
  const evidencia = path.join(dirs.evidencias, nomeDaEvidencia(rodada));
  writeFileSync(relatorio, renderizarRelatorio(rodada));
  writeFileSync(evidencia, `${JSON.stringify(rodada, null, 2)}\n`);
  return { relatorio, evidencia };
}
