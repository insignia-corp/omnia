/**
 * Mensagem do dono no formato do webhook da Cloud API (`messages[]`), como o front simulado manda.
 * O esquema só aceita os tipos que a conversa trata; foto e documento entram por `POST /chat/notas`.
 */
import { z } from "zod";
import type { TipoMensagem } from "./formato";
import { LIMITES_META } from "./regras-meta";

/** Id da mensagem dado pelo canal (`wamid.*` na Meta, uuid no chat web antigo). */
export const ID_MENSAGEM = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/, "id inválido");

const contexto = z.strictObject({ id: ID_MENSAGEM });
const titulo = z.string().trim().min(1).max(LIMITES_META.tituloLinha);
const idBotao = z.string().trim().min(1).max(LIMITES_META.idBotao);

export const entradaWhatsapp = z.discriminatedUnion("type", [
  z.strictObject({
    id: ID_MENSAGEM,
    type: z.literal("text"),
    text: z.strictObject({ body: z.string().trim().min(1).max(LIMITES_META.texto) }),
    context: contexto.optional(),
  }),
  z.strictObject({
    id: ID_MENSAGEM,
    type: z.literal("interactive"),
    interactive: z.discriminatedUnion("type", [
      z.strictObject({
        type: z.literal("button_reply"),
        button_reply: z.strictObject({ id: idBotao, title: titulo }),
      }),
      z.strictObject({
        type: z.literal("list_reply"),
        list_reply: z.strictObject({
          id: idBotao,
          title: titulo,
          description: z.string().max(LIMITES_META.descricaoLinha).optional(),
        }),
      }),
    ]),
    context: contexto.optional(),
  }),
  z.strictObject({
    id: ID_MENSAGEM,
    type: z.literal("button"),
    button: z.strictObject({ payload: idBotao, text: titulo }),
    context: contexto.optional(),
  }),
]);

export type EntradaWhatsapp = z.infer<typeof entradaWhatsapp>;

export interface EntradaLida {
  /** O que o dono escreveu ou o título do botão que tocou: é o `texto` gravado. */
  texto: string;
  /** Id do botão ou da linha tocada; nulo em texto livre. */
  acao: string | null;
  tipo: TipoMensagem;
  conteudo: Record<string, unknown> | null;
}

export function lerEntrada(m: EntradaWhatsapp): EntradaLida {
  if (m.type === "text") return { texto: m.text.body, acao: null, tipo: "text", conteudo: null };
  if (m.type === "button") {
    return { texto: m.button.text, acao: m.button.payload, tipo: "button", conteudo: { ...m.button } };
  }
  const resposta =
    m.interactive.type === "button_reply" ? m.interactive.button_reply : m.interactive.list_reply;
  return { texto: resposta.title, acao: resposta.id, tipo: "interactive", conteudo: { ...m.interactive } };
}
