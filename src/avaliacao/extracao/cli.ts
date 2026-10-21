import path from "node:path";
import { parseArgs } from "node:util";
import { lerArquivoEnv } from "../../config/arquivo-env";
import { gravarRodada, resumir } from "./relatorio";
import { ErroAvaliacaoExtracao, lerEnvExtracao, rodarAvaliacaoExtracao } from "./rodada";

const USO = `Uso: npm run eval:extracao -- [--modelo falso|real] [--nota nota-01,nota-11] [--prompt v1] [--limite 0.8]

  --modelo  falso (padrão): cliente de visão que devolve o gabarito, sem rede e sem custo, para a CI
            real: modelo com visão da Anthropic (exige ANTHROPIC_API_KEY; usa EXTRATOR_MODELO)
  --nota    só estas notas (ids do manifesto, separados por vírgula)
  --prompt  versão do prompt do Extrator (padrão v1)
  --limite  limite de confiança (padrão LIMITE_CONFIANCA_ITEM, 0,8)

Sai com 1 se uma meta não for atingida e com 2 em erro de uso.`;

async function principal(): Promise<number> {
  const { values } = parseArgs({
    options: {
      modelo: { type: "string", default: "falso" },
      nota: { type: "string" },
      prompt: { type: "string" },
      limite: { type: "string" },
      ajuda: { type: "boolean", default: false },
    },
  });
  if (values.ajuda) {
    console.log(USO);
    return 0;
  }
  if (values.modelo !== "falso" && values.modelo !== "real") {
    throw new ErroAvaliacaoExtracao(
      `--modelo deve ser "falso" ou "real", recebi "${values.modelo}".\n\n${USO}`,
    );
  }
  const limite = values.limite === undefined ? undefined : Number(values.limite.replace(",", "."));
  if (limite !== undefined && !(limite >= 0 && limite <= 1)) {
    throw new ErroAvaliacaoExtracao(`--limite deve ir de 0 a 1, recebi "${values.limite}".`);
  }
  lerArquivoEnv();
  const rodada = await rodarAvaliacaoExtracao({
    modo: values.modelo,
    env: lerEnvExtracao(),
    ...(values.nota ? { notas: values.nota.split(",").map((s) => s.trim()) } : {}),
    ...(values.prompt ? { prompt: values.prompt } : {}),
    ...(limite !== undefined ? { limiteConfianca: limite } : {}),
  });
  const arquivos = gravarRodada(rodada, {
    relatorios: path.resolve("docs/avaliacoes"),
    evidencias: path.resolve("evidencias"),
  });
  const resumo = resumir(rodada);
  for (const x of rodada.resultados) {
    const c = x.comparacao;
    const situacao = x.falha
      ? `FALHOU (${x.falha.tipo})`
      : c?.camposDocumento.total_centavos
        ? "total certo"
        : "TOTAL ERRADO";
    console.log(`${x.id}: ${situacao} ${x.latenciaMs} ms`);
  }
  const t = resumo.totalCorreto;
  console.log(
    `\nTotal correto: ${t.certos} de ${t.total}. Erros: ${resumo.erros.total}, silenciosos: ${resumo.erros.silenciosos}.`,
  );
  console.log(`Relatório: ${path.relative(process.cwd(), arquivos.relatorio)}`);
  console.log(`Saída bruta: ${path.relative(process.cwd(), arquivos.evidencia)}`);
  return resumo.metas.totalCorreto && resumo.metas.errosComConfiancaBaixa ? 0 : 1;
}

principal()
  .then((codigo) => {
    process.exitCode = codigo;
  })
  .catch((e: unknown) => {
    console.error(e instanceof ErroAvaliacaoExtracao ? e.message : e);
    process.exitCode = 2;
  });
