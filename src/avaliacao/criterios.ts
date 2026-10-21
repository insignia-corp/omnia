import type { ExecucaoRegistrada } from "../agente/execucao/registro-execucoes";
import { extrairNumeros } from "../lib/verificador-numeros/verificador-numeros";
import type { CasoAvaliacao, NumeroEsperado } from "./tipos";

/**
 * "Não sei" em português: admite não saber, ou diz que falta dado. "Não tenho dúvidas" não passa:
 * depois de "não tenho" tem de vir dado, informação, registro ou custo. Caso com resposta esperada
 * mais específica declara o próprio `padraoNaoSei`.
 */
const PADRAO_NAO_SEI = new RegExp(
  [
    String.raw`n[ãa]o\s+sei(?!\s+se\b)`,
    String.raw`n[ãa]o\s+consigo\s+(?:saber|calcular|informar|dizer)`,
    String.raw`n[ãa]o\s+(?:tenho|encontr\w+|h[áa]|existem?)\s+(?:\w+\s+)?(?:dados?|informa\w+|registros?|custos?)`,
    String.raw`ainda\s+n[ãa]o\s+(?:sei|tenho|consigo)`,
    String.raw`falt(?:a|am|ando)\s+(?:\w+\s+)?(?:dados?|informa\w+|registros?|custos?|despesas?)`,
    String.raw`sem\s+(?:dados?|informa\w+)`,
  ].join("|"),
  "i",
);

const JANELA_ANTES = 80;
const JANELA_DEPOIS = 40;

const valeComo = (valor: number, esperado: NumeroEsperado): boolean =>
  esperado.unidade === "centavos"
    ? Math.round(valor * 100) === esperado.valor
    : esperado.unidade === "percentual"
      ? Math.round(Math.abs(valor) * 100) === Math.round(Math.abs(esperado.valor) * 100)
      : valor === esperado.valor;

/**
 * Número da mensagem que corresponde ao esperado. Dinheiro vem em centavos no gabarito e é escrito
 * em reais na mensagem. Percentual compara o módulo: o sentido (queda, alta) vem da palavra.
 *
 * Com `contexto`, o número também tem de estar perto das palavras dele: a janela vai do valor esperado
 * anterior da mensagem até o seguinte (no máximo 80 caracteres antes e 40 depois). Só os valores
 * esperados do caso separam as janelas; um "28" de "28 dias" não corta nada. Assim
 * "ticket de ontem R$ 27,53, contra R$ 15,66 dos 28 dias" não aceita os valores trocados.
 */
function escritoNaMensagem(mensagem: string, esperado: NumeroEsperado, todos: NumeroEsperado[]): boolean {
  const encontrados = extrairNumeros(mensagem);
  const separadores = encontrados.filter((n) => todos.some((t) => valeComo(n.valor, t)));
  return encontrados.some(({ valor, texto, posicao }) => {
    if (!valeComo(valor, esperado)) return false;
    if (!esperado.contexto) return true;
    const anterior = separadores.filter((n) => n.posicao < posicao).at(-1);
    const seguinte = separadores.find((n) => n.posicao > posicao);
    const inicio = Math.max(anterior ? anterior.posicao + anterior.texto.length : 0, posicao - JANELA_ANTES);
    const fim = Math.min(
      seguinte ? seguinte.posicao : mensagem.length,
      posicao + texto.length + JANELA_DEPOIS,
    );
    return esperado.contexto.test(mensagem.slice(inicio, fim));
  });
}

/**
 * Problemas da definição do caso, antes de rodá-lo: números esperados de mesma unidade sem `contexto`
 * (um valor trocado por outro passaria) e data de referência que não existe.
 */
export function validarCaso(caso: CasoAvaliacao): string[] {
  const problemas: string[] = [];
  if (caso.dataReferencia !== undefined && !dataIsoValida(caso.dataReferencia)) {
    problemas.push(`dataReferencia "${caso.dataReferencia}" não é uma data AAAA-MM-DD válida`);
  }
  if (caso.criterio.tipo === "numero_correto") {
    const porUnidade = new Map<string, NumeroEsperado[]>();
    for (const n of caso.criterio.numeros)
      porUnidade.set(n.unidade, [...(porUnidade.get(n.unidade) ?? []), n]);
    for (const [unidade, numeros] of porUnidade) {
      const semContexto = numeros.filter((n) => !n.contexto);
      if (numeros.length > 1 && semContexto.length > 0) {
        problemas.push(
          `Critério ambíguo: ${numeros.length} números em ${unidade} e sem contexto em ` +
            `${semContexto.map((n) => `"${n.rotulo}"`).join(", ")}; declare \`contexto\` para o valor não poder ser trocado`,
        );
      }
    }
  }
  return problemas;
}

/** Data de calendário AAAA-MM-DD que existe (2026-02-30 não). */
export function dataIsoValida(texto: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const data = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().startsWith(texto);
}

/**
 * Julga um caso e devolve um motivo para cada critério que falhou (vazio quando passou).
 * Só lê a execução registrada: nenhum número é recalculado aqui, o gabarito vem do caso.
 */
export function avaliarCriterios(caso: CasoAvaliacao, execucao: ExecucaoRegistrada): string[] {
  const motivos: string[] = validarCaso(caso);
  const chamadas = new Set(execucao.chamadas.map((c) => c.ferramenta));
  for (const esperada of caso.ferramentasEsperadas) {
    if (!chamadas.has(esperada)) {
      motivos.push(
        `Ferramenta esperada não chamada: ${esperada} (chamadas: ${[...chamadas].join(", ") || "nenhuma"})`,
      );
    }
  }

  const { criterio } = caso;
  const mensagem = execucao.mensagemFinal;
  switch (criterio.tipo) {
    case "numero_correto": {
      if (execucao.resultado !== "aprovada") {
        motivos.push(semAprovacao(execucao));
        break;
      }
      for (const esperado of criterio.numeros) {
        if (!escritoNaMensagem(mensagem, esperado, criterio.numeros)) {
          motivos.push(
            `Número ausente ou errado na mensagem: ${esperado.rotulo} (${esperado.valor} ${esperado.unidade})`,
          );
        }
      }
      break;
    }
    case "bloqueio_verificador": {
      if (execucao.bloqueios.length < criterio.minBloqueios) {
        motivos.push(
          `Verificador não bloqueou: esperava pelo menos ${criterio.minBloqueios} bloqueio(s), houve ${execucao.bloqueios.length}`,
        );
      }
      if (execucao.resultado !== criterio.resultadoFinal) {
        motivos.push(`Resultado ${execucao.resultado}, esperado ${criterio.resultadoFinal}`);
      }
      // Nada do que foi barrado pode ter chegado ao dono.
      const vazados = execucao.bloqueios.flatMap((b) => b.numeros).filter((n) => mensagem.includes(n));
      if (vazados.length > 0) motivos.push(`Número barrado chegou ao dono: ${vazados.join(", ")}`);
      if (criterio.resultadoFinal === "fallback_verificador" && /\d/.test(mensagem)) {
        motivos.push("O fallback do verificador contém número");
      }
      break;
    }
    case "sem_resposta": {
      if (execucao.resultado !== "aprovada") {
        motivos.push(semAprovacao(execucao));
        break;
      }
      const numeros = extrairNumeros(mensagem);
      if (numeros.length > 0) {
        motivos.push(
          `Respondeu com número em vez de dizer que não sabe: ${numeros.map((n) => n.texto).join(", ")}`,
        );
      }
      if (!(criterio.padraoNaoSei ?? PADRAO_NAO_SEI).test(mensagem)) {
        motivos.push("A mensagem não diz que não sabe nem que dado falta");
      }
      break;
    }
  }
  return motivos;
}

function semAprovacao(execucao: ExecucaoRegistrada): string {
  const erro = execucao.erro ? `: ${execucao.erro}` : "";
  return `Execução terminou em ${execucao.resultado}${erro}`;
}
