import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { formatarMicrodolares } from "../relatorio";
import {
  CAMPOS_DOCUMENTO,
  CAMPOS_ITEM,
  classificarConfianca,
  errosDaNota,
  type CampoDocumento,
  type CampoItem,
  type ErroDaNota,
} from "./comparador";
import type { RodadaExtracao, ResultadoNota } from "./runner";

/** Meta da especificação dos agentes (seção 8): total correto em pelo menos 90% das notas. */
export const META_TOTAL_CORRETO = 0.9;

/** Limites testados na calibração; o vigente entra na tabela mesmo que não esteja aqui. */
const LIMITES_CALIBRACAO = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95];

export interface Taxa {
  certos: number;
  total: number;
}

export interface LinhaCalibracao {
  limite: number;
  /** Erros que passariam sem pergunta ao dono. */
  errosSilenciosos: number;
  /** Itens sem erro que gerariam pergunta ao dono sem necessidade. */
  perguntasDesnecessarias: number;
  /** Itens abaixo do limite (perguntas ao dono por item). */
  itensAbaixo: number;
}

export interface ResumoExtracao {
  notas: number;
  extraidas: number;
  falhas: Array<{ id: string; tipo: string; mensagem: string }>;
  totalCorreto: Taxa;
  fornecedor: Taxa;
  cnpj: Taxa;
  data: Taxa;
  somaItens: Taxa;
  /** Nota com o CNPJ extraído válido no dígito verificador. */
  cnpjValido: Taxa;
  camposDocumento: Record<CampoDocumento, Taxa>;
  camposItem: Record<CampoItem, Taxa>;
  /** Todos os campos (documento e itens) contra o gabarito, notas sem extração contam como erradas. */
  campos: Taxa;
  itens: { esperados: number; perfeitos: number; omitidos: number; sobrando: number };
  confianca: {
    itensAbaixoDoLimite: number;
    itensEsperadosBaixos: number;
    itensBaixosCapturados: number;
    perguntasDesnecessarias: number;
    documentosAbaixoDoLimite: number;
    documentosEsperadosBaixos: number;
    documentosBaixosCapturados: number;
  };
  erros: { total: number; sinalizados: number; silenciosos: number };
  calibracao: LinhaCalibracao[];
  /** `null`: alguma nota usou modelo sem preço cadastrado, custo indisponível (nunca zero). */
  custoTotalMicrodolares: number | null;
  latenciaMediaMs: number;
  latenciaMaximaMs: number;
  /**
   * Resultados que a especificação exige de notas específicas e que a meta agregada não enxerga: item borrado
   * abaixo do limite (nota 11), documento em dúvida abaixo do limite, soma divergente acusada pelo código (nota 10).
   */
  exigenciasNaoCumpridas: string[];
  metas: { totalCorreto: boolean; errosComConfiancaBaixa: boolean; exigenciasPorNota: boolean };
}

const taxa = (): Taxa => ({ certos: 0, total: 0 });
const contar = (t: Taxa, certo: boolean, n = 1) => {
  t.total += n;
  if (certo) t.certos += n;
};

const quando = (n: number) => String(n).replace(".", ",");

function exigenciasNaoCumpridas(x: ResultadoNota, limite: number): string[] {
  const faltas: string[] = [];
  const c = x.comparacao;
  for (const pos of x.exigencias.itensAbaixoDoLimite) {
    const confianca = c?.itens[pos - 1]?.obtido?.confianca;
    if (confianca === undefined || confianca >= limite) {
      faltas.push(
        `${x.id}: o item ${pos} (pouco legível no gabarito) deveria sair abaixo de ${quando(limite)}`,
      );
    }
  }
  if (x.exigencias.documentoAbaixoDoLimite && !(c && c.confiancaDocumentoObtida < limite)) {
    faltas.push(`${x.id}: o documento (em dúvida no gabarito) deveria sair abaixo de ${quando(limite)}`);
  }
  if (x.exigencias.somaDivergente && !x.motivosValidacao.includes("soma_diverge_do_total")) {
    faltas.push(`${x.id}: o código deveria acusar soma_diverge_do_total`);
  }
  return faltas;
}

export function resumir(rodada: RodadaExtracao): ResumoExtracao {
  const limite = rodada.limiteConfianca;
  const r = rodada.resultados;
  const resumo: ResumoExtracao = {
    notas: r.length,
    extraidas: r.filter((x) => x.comparacao).length,
    falhas: r.flatMap((x) => (x.falha ? [{ id: x.id, tipo: x.falha.tipo, mensagem: x.falha.mensagem }] : [])),
    totalCorreto: taxa(),
    fornecedor: taxa(),
    cnpj: taxa(),
    data: taxa(),
    somaItens: taxa(),
    cnpjValido: taxa(),
    camposDocumento: Object.fromEntries(CAMPOS_DOCUMENTO.map((c) => [c, taxa()])) as Record<
      CampoDocumento,
      Taxa
    >,
    camposItem: Object.fromEntries(CAMPOS_ITEM.map((c) => [c, taxa()])) as Record<CampoItem, Taxa>,
    campos: taxa(),
    itens: { esperados: 0, perfeitos: 0, omitidos: 0, sobrando: 0 },
    confianca: {
      itensAbaixoDoLimite: 0,
      itensEsperadosBaixos: 0,
      itensBaixosCapturados: 0,
      perguntasDesnecessarias: 0,
      documentosAbaixoDoLimite: 0,
      documentosEsperadosBaixos: 0,
      documentosBaixosCapturados: 0,
    },
    erros: { total: 0, sinalizados: 0, silenciosos: 0 },
    calibracao: [],
    custoTotalMicrodolares: r.some((x) => x.custoEstimadoMicrodolares === null)
      ? null
      : r.reduce((s, x) => s + (x.custoEstimadoMicrodolares ?? 0), 0),
    exigenciasNaoCumpridas: r.flatMap((x) => exigenciasNaoCumpridas(x, limite)),
    latenciaMediaMs: r.length ? Math.round(r.reduce((s, x) => s + x.latenciaMs, 0) / r.length) : 0,
    latenciaMaximaMs: r.length ? Math.max(...r.map((x) => x.latenciaMs)) : 0,
    metas: { totalCorreto: false, errosComConfiancaBaixa: false, exigenciasPorNota: false },
  };

  for (const x of r) {
    const c = x.comparacao;
    if (!c) {
      // Sem extração: nada acertado. O dono é avisado da falha (status do documento), então não é erro silencioso.
      for (const k of [
        resumo.totalCorreto,
        resumo.fornecedor,
        resumo.cnpj,
        resumo.data,
        resumo.somaItens,
        resumo.cnpjValido,
      ]) {
        contar(k, false);
      }
      for (const campo of CAMPOS_DOCUMENTO) contar(resumo.camposDocumento[campo], false);
      for (const campo of CAMPOS_ITEM) contar(resumo.camposItem[campo], false, x.itensEsperados);
      resumo.itens.esperados += x.itensEsperados;
      resumo.itens.omitidos += x.itensEsperados;
      resumo.campos.total += x.camposEsperados;
      resumo.erros.total++;
      resumo.erros.sinalizados++;
      continue;
    }
    contar(resumo.totalCorreto, c.camposDocumento.total_centavos);
    contar(resumo.fornecedor, c.camposDocumento.fornecedor_nome);
    contar(resumo.cnpj, c.camposDocumento.fornecedor_cnpj);
    contar(resumo.data, c.camposDocumento.data_emissao);
    contar(resumo.somaItens, c.somaItensCorreta);
    contar(resumo.cnpjValido, c.cnpjObtidoValido);
    for (const campo of CAMPOS_DOCUMENTO) contar(resumo.camposDocumento[campo], c.camposDocumento[campo]);
    for (const i of c.itens) {
      for (const campo of CAMPOS_ITEM) contar(resumo.camposItem[campo], !i.camposErrados.includes(campo));
      if (i.obtido && i.camposErrados.length === 0) resumo.itens.perfeitos++;
      if (!i.obtido) resumo.itens.omitidos++;
      if (i.esperado.confianca < limite) {
        resumo.confianca.itensEsperadosBaixos++;
        if (i.obtido && i.obtido.confianca < limite) resumo.confianca.itensBaixosCapturados++;
      }
    }
    resumo.itens.esperados += c.itens.length;
    resumo.itens.sobrando += c.itensSobrando.length;
    resumo.campos.certos += c.campos.certos;
    resumo.campos.total += c.campos.total;

    const conf = classificarConfianca(c, limite);
    resumo.confianca.itensAbaixoDoLimite += conf.itensAbaixoDoLimite.length;
    resumo.confianca.perguntasDesnecessarias += conf.itensSinalizadosSemErro.length;
    if (conf.documentoAbaixoDoLimite) resumo.confianca.documentosAbaixoDoLimite++;
    if (c.confiancaDocumentoEsperada < limite) {
      resumo.confianca.documentosEsperadosBaixos++;
      if (conf.documentoAbaixoDoLimite) resumo.confianca.documentosBaixosCapturados++;
    }
    resumo.erros.total += errosDaNota(c).length;
    resumo.erros.sinalizados += conf.errosSinalizados.length;
    resumo.erros.silenciosos += conf.errosSilenciosos.length;
  }

  const limites = [...new Set([...LIMITES_CALIBRACAO, limite])].sort((a, b) => a - b);
  resumo.calibracao = limites.map((l) => {
    const linha: LinhaCalibracao = {
      limite: l,
      errosSilenciosos: 0,
      perguntasDesnecessarias: 0,
      itensAbaixo: 0,
    };
    for (const x of r) {
      if (!x.comparacao) continue;
      const conf = classificarConfianca(x.comparacao, l);
      linha.errosSilenciosos += conf.errosSilenciosos.length;
      linha.perguntasDesnecessarias += conf.itensSinalizadosSemErro.length;
      linha.itensAbaixo += conf.itensAbaixoDoLimite.length;
    }
    return linha;
  });

  resumo.metas = {
    totalCorreto:
      resumo.notas > 0 && resumo.totalCorreto.certos / resumo.totalCorreto.total >= META_TOTAL_CORRETO,
    errosComConfiancaBaixa: resumo.notas > 0 && resumo.erros.silenciosos === 0,
    exigenciasPorNota: resumo.exigenciasNaoCumpridas.length === 0,
  };
  return resumo;
}

const percentual = ({ certos, total }: Taxa) =>
  total === 0 ? "0%" : `${String(Math.round((certos / total) * 1000) / 10).replace(".", ",")}%`;
const fracao = (t: Taxa) => `${t.certos} de ${t.total} (${percentual(t)})`;
const casas2 = (n: number) => String(n).replace(".", ",");

const custo = (micro: number | null) => (micro === null ? "indisponível" : formatarMicrodolares(micro));

/** Tabelas em Markdown não aceitam `|` nem quebra de linha dentro da célula. */
const celula = (texto: string) =>
  texto
    .replace(/\|/g, "\\|")
    .replace(/\s*\n\s*/g, " ")
    .trim();

function descreverErro(e: ErroDaNota): string {
  switch (e.tipo) {
    case "documento":
      return `documento: ${e.campo}`;
    case "item":
      return `item ${e.posicao}: ${e.campo}`;
    case "item_omitido":
      return `item ${e.posicao} omitido`;
    case "item_sobrando":
      return `item a mais: ${e.descricao}`;
  }
}

function linhaDaNota(x: ResultadoNota, limite: number): string {
  const casos = celula(x.casos.join(", ") || "nenhum");
  if (!x.comparacao) {
    return `| ${x.id} | ${casos} | falhou (${x.falha?.tipo ?? "?"}) | | | | | | | ${custo(x.custoEstimadoMicrodolares)} | ${x.latenciaMs} |`;
  }
  const c = x.comparacao;
  const conf = classificarConfianca(c, limite);
  const sim = (b: boolean) => (b ? "sim" : "não");
  const perfeitos = c.itens.filter((i) => i.obtido && i.camposErrados.length === 0).length;
  return (
    `| ${x.id} | ${casos} | ${sim(c.camposDocumento.total_centavos)} | ${sim(c.camposDocumento.fornecedor_cnpj)} | ` +
    `${sim(c.camposDocumento.data_emissao)} | ${perfeitos} de ${c.itens.length} | ${conf.errosSinalizados.length + conf.errosSilenciosos.length} | ` +
    `${conf.errosSilenciosos.length} | ${conf.itensAbaixoDoLimite.length} | ${custo(x.custoEstimadoMicrodolares)} | ${x.latenciaMs} |`
  );
}

/** Relatório da rodada em Markdown. Texto sem travessões, como o resto da documentação. */
export function renderizarRelatorio(rodada: RodadaExtracao): string {
  const resumo = resumir(rodada);
  const limite = rodada.limiteConfianca;
  const modelos = [...new Set(rodada.resultados.map((r) => r.modelo))].join(", ") || rodada.modelo;
  const L: string[] = [
    `# Avaliação da extração de notas: ${rodada.versaoPrompt}, ${rodada.modo === "falso" ? "cliente falso" : modelos}`,
    "",
    "| | |",
    "| --- | --- |",
    `| Rodada | ${rodada.iniciadaEm} |`,
    `| Modo | ${rodada.modo} (${rodada.modo === "falso" ? "cliente de visão falso, sem custo" : "modelo real"}) |`,
    `| Modelo | ${modelos} |`,
    `| Versão do prompt | ${rodada.versaoPrompt} |`,
    `| Notas | ${resumo.notas} fotos de \`fixtures/notas/\` (a NF-e em XML não passa pelo modelo) |`,
    `| Limite de confiança | ${casas2(limite)} |`,
    `| Data de hoje nas validações | ${rodada.hoje} |`,
    `| Gerado por | \`npm run eval:extracao -- --modelo ${rodada.modo}\` |`,
    "",
  ];
  if (rodada.modo === "falso") {
    L.push(
      "> Modo falso: o cliente de visão devolve o gabarito de cada foto. Prova que o caminho (Extrator, validações em código, comparador, relatório) funciona; não mede nenhum modelo. Os números de acerto só valem na rodada com modelo real.",
      "",
    );
  }
  const ok = (b: boolean) => (b ? "atingida" : "NÃO atingida");
  L.push(
    "## Resultado",
    "",
    "| Meta | Resultado | |",
    "| --- | --- | --- |",
    `| Total correto em pelo menos ${Math.round(META_TOTAL_CORRETO * 100)}% das notas | ${fracao(resumo.totalCorreto)} | ${ok(resumo.metas.totalCorreto)} |`,
    `| Todo erro com confiança baixa (nenhum erro silencioso) | ${resumo.erros.sinalizados} de ${resumo.erros.total} erros sinalizados, ${resumo.erros.silenciosos} silenciosos | ${ok(resumo.metas.errosComConfiancaBaixa)} |`,
    `| Resultados exigidos por nota (item borrado abaixo do limite, soma divergente acusada pelo código) | ${resumo.exigenciasNaoCumpridas.length === 0 ? "todos cumpridos" : `${resumo.exigenciasNaoCumpridas.length} não cumpridos`} | ${ok(resumo.metas.exigenciasPorNota)} |`,
    "",
    ...resumo.exigenciasNaoCumpridas.map((f) => `- ${f}`),
    ...(resumo.exigenciasNaoCumpridas.length > 0 ? [""] : []),
    "Erro sinalizado: o item sai abaixo do limite, ou o documento sai abaixo do limite (o dono confirma a nota). Nota que o Extrator não devolveu conta como um erro sinalizado, porque o documento fica com status de erro.",
    "",
    `Custo estimado da rodada: ${custo(resumo.custoTotalMicrodolares)}${resumo.custoTotalMicrodolares === null ? " (modelo sem preço cadastrado em `PRECOS`)" : ""}. Latência por nota: média de ${resumo.latenciaMediaMs} ms, máxima de ${resumo.latenciaMaximaMs} ms.`,
    "",
    "## Acerto por campo",
    "",
    "| Campo | Acertos |",
    "| --- | --- |",
    `| Total da nota | ${fracao(resumo.totalCorreto)} |`,
    `| Soma dos itens | ${fracao(resumo.somaItens)} |`,
    `| CNPJ do fornecedor | ${fracao(resumo.cnpj)} |`,
    `| CNPJ extraído com dígito verificador válido | ${fracao(resumo.cnpjValido)} |`,
    `| Data de emissão | ${fracao(resumo.data)} |`,
    `| Nome do fornecedor | ${fracao(resumo.fornecedor)} |`,
    ...CAMPOS_ITEM.map((c) => `| Item: ${c} | ${fracao(resumo.camposItem[c])} |`),
    `| **Todos os campos** | ${fracao(resumo.campos)} |`,
    "",
    `Itens do gabarito: ${resumo.itens.esperados}; todos os campos certos em ${resumo.itens.perfeitos}; omitidos ${resumo.itens.omitidos}; itens a mais ${resumo.itens.sobrando}.`,
    "",
    `## Confiança e o limite de ${casas2(limite)}`,
    "",
    "| | |",
    "| --- | --- |",
    `| Itens abaixo do limite na extração | ${resumo.confianca.itensAbaixoDoLimite} |`,
    `| Itens que o gabarito marca como pouco legíveis | ${resumo.confianca.itensEsperadosBaixos} (extraídos abaixo do limite: ${resumo.confianca.itensBaixosCapturados}) |`,
    `| Itens abaixo do limite sem erro e legíveis no gabarito (pergunta desnecessária) | ${resumo.confianca.perguntasDesnecessarias} |`,
    `| Documentos abaixo do limite na extração | ${resumo.confianca.documentosAbaixoDoLimite} |`,
    `| Documentos que o gabarito marca como duvidosos | ${resumo.confianca.documentosEsperadosBaixos} (extraídos abaixo do limite: ${resumo.confianca.documentosBaixosCapturados}) |`,
    "",
    "### Calibração do limite",
    "",
    "Os mesmos resultados lidos com outros limites. O limite certo é o menor que deixa zero erro silencioso: acima dele só crescem as perguntas desnecessárias ao dono.",
    "",
    "| Limite | Erros silenciosos | Perguntas por item | Perguntas desnecessárias |",
    "| ---: | ---: | ---: | ---: |",
    ...resumo.calibracao.map(
      (l) =>
        `| ${casas2(l.limite)}${l.limite === limite ? " (vigente)" : ""} | ${l.errosSilenciosos} | ${l.itensAbaixo} | ${l.perguntasDesnecessarias} |`,
    ),
    "",
    "## Notas",
    "",
    "| Nota | Casos | Total certo | CNPJ certo | Data certa | Itens perfeitos | Erros | Silenciosos | Itens abaixo do limite | Custo | Latência (ms) |",
    "| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ...rodada.resultados.map((x) => linhaDaNota(x, limite)),
    "",
    "## Divergências",
    "",
  );
  const comErro = rodada.resultados.filter((x) => !x.comparacao || errosDaNota(x.comparacao).length > 0);
  if (comErro.length === 0) {
    L.push("Nenhuma divergência nesta rodada.", "");
  } else {
    for (const x of comErro) {
      L.push(`### ${x.id}`, "");
      if (!x.comparacao) {
        L.push(
          `- O Extrator não devolveu a nota: ${x.falha?.tipo ?? "?"}. ${celula(x.falha?.mensagem ?? "")}`,
          "",
        );
        continue;
      }
      const conf = classificarConfianca(x.comparacao, limite);
      for (const e of conf.errosSilenciosos) L.push(`- ${descreverErro(e)} (SILENCIOSO, confiança alta)`);
      for (const e of conf.errosSinalizados) L.push(`- ${descreverErro(e)} (sinalizado)`);
      L.push("");
    }
  }
  const baixos = rodada.resultados.flatMap((x) =>
    (x.extracao?.itens ?? []).flatMap((i, k) =>
      i.confianca < limite
        ? [`| ${x.id} | ${k + 1} | ${celula(i.descricao)} | ${casas2(i.confianca)} |`]
        : [],
    ),
  );
  L.push(
    "## Itens abaixo do limite",
    "",
    ...(baixos.length === 0
      ? ["Nenhum item abaixo do limite nesta rodada.", ""]
      : [
          "| Nota | Posição na extração | Descrição | Confiança |",
          "| --- | ---: | --- | ---: |",
          ...baixos,
          "",
        ]),
  );
  const validacoes = rodada.resultados.filter((x) => x.motivosValidacao.length > 0);
  L.push(
    "## Conferências em código que reduziram a confiança",
    "",
    ...(validacoes.length === 0
      ? ["Nenhuma nota foi reduzida pelas conferências em código.", ""]
      : [...validacoes.map((x) => `- ${x.id}: ${x.motivosValidacao.join(", ")}`), ""]),
  );
  return L.join("\n");
}

/** Dia "AAAA-MM-DD" (UTC) do instante da rodada. */
const diaDa = (iso: string) => iso.slice(0, 10);

/** `AAAA-MM-DD-<versao-prompt>-<falso|modelo>.md`: a rodada falsa e a real do mesmo dia não se sobrescrevem. */
export function nomeDoRelatorio(rodada: RodadaExtracao): string {
  const sufixo = rodada.modo === "falso" ? "falso" : rodada.modelo;
  return `${diaDa(rodada.iniciadaEm)}-${rodada.versaoPrompt}-${sufixo}.md`;
}

/** Saída bruta em `evidencias/`, com hora e milissegundos para rodadas do mesmo dia não se perderem. */
export function nomeDaEvidencia(rodada: RodadaExtracao): string {
  const hora = rodada.iniciadaEm.slice(11, 23).replace(/[:.]/g, "");
  return `${diaDa(rodada.iniciadaEm)}-eval-extracao-${rodada.modo}-${hora}.json`;
}

export interface ArquivosGravados {
  relatorio: string;
  evidencia: string;
}

/**
 * Relatório versionado em `docs/avaliacoes/` (o de mesmo dia, prompt e modelo é substituído; o git guarda o
 * anterior) e saída bruta em `evidencias/`, que nunca é sobrescrita (`wx` falha em vez de apagar).
 */
export function gravarRodada(
  rodada: RodadaExtracao,
  dirs: { relatorios: string; evidencias: string },
): ArquivosGravados {
  mkdirSync(dirs.relatorios, { recursive: true });
  mkdirSync(dirs.evidencias, { recursive: true });
  const relatorio = path.join(dirs.relatorios, nomeDoRelatorio(rodada));
  const evidencia = path.join(dirs.evidencias, nomeDaEvidencia(rodada));
  writeFileSync(relatorio, renderizarRelatorio(rodada));
  writeFileSync(evidencia, `${JSON.stringify(rodada, null, 2)}\n`, { flag: "wx" });
  return { relatorio, evidencia };
}
