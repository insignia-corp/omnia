import type { ExecucaoRegistrada } from "../agente/execucao/registro-execucoes";
import { extrairNumeros } from "../lib/verificador-numeros/verificador-numeros";
import type { CasoAvaliacao, NumeroEsperado } from "./tipos";

/** "Não sei" em português, com o jeito de o agente dizer que falta dado. */
const PADRAO_NAO_SEI =
  /n[ãa]o\s+(?:sei|tenho|consigo|encontr|h[áa]\b|existe|dispon[ií]vel)|ainda\s+n[ãa]o|falt(?:a|am|ando)\b|sem\s+(?:dados?|informa)/i;

/**
 * Número da mensagem que corresponde ao esperado. Dinheiro vem em centavos no gabarito e é escrito
 * em reais na mensagem. Percentual compara o módulo: o sentido (queda, alta) vem da palavra.
 */
function escritoNaMensagem(mensagem: string, esperado: NumeroEsperado): boolean {
  return extrairNumeros(mensagem).some(({ valor }) => {
    switch (esperado.unidade) {
      case "centavos":
        return Math.round(valor * 100) === esperado.valor;
      case "percentual":
        return Math.round(Math.abs(valor) * 100) === Math.round(Math.abs(esperado.valor) * 100);
      default:
        return valor === esperado.valor;
    }
  });
}

/**
 * Julga um caso e devolve um motivo para cada critério que falhou (vazio quando passou).
 * Só lê a execução registrada: nenhum número é recalculado aqui, o gabarito vem do caso.
 */
export function avaliarCriterios(caso: CasoAvaliacao, execucao: ExecucaoRegistrada): string[] {
  const motivos: string[] = [];
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
        if (!escritoNaMensagem(mensagem, esperado)) {
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
