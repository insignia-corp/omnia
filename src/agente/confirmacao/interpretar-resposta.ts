export type RespostaDoDono = "sim" | "nao" | "outra";

const SIM = new Set([
  "sim",
  "s",
  "pode",
  "pode sim",
  "pode ser",
  "pode registrar",
  "pode gravar",
  "sim pode",
  "sim confirmo",
  "confirmo",
  "confirmado",
  "isso",
  "isso mesmo",
  "ok",
  "okay",
  "claro",
  "com certeza",
  "positivo",
  "fechado",
]);

const NAO = new Set([
  "nao",
  "n",
  "nao quero",
  "nao pode",
  "melhor nao",
  "cancela",
  "cancelar",
  "cancelado",
  "deixa",
  "deixa quieto",
  "deixa pra la",
  "negativo",
]);

const normalizar = (texto: string) =>
  texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Confirmação explícita: a mensagem inteira é uma das frases da lista. "Sim, mas com 20" ou "sim e
 * qual a margem?" são `outra`: não confirmam nada e seguem para o agente. Em dúvida, não confirma.
 */
export function interpretarResposta(texto: string): RespostaDoDono {
  const t = normalizar(texto);
  if (SIM.has(t)) return "sim";
  if (NAO.has(t)) return "nao";
  return "outra";
}
