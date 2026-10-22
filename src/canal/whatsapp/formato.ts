/**
 * Mensagens no formato da WhatsApp Cloud API, o mesmo do front simulado (`web/whatsapp/tipos.js`):
 * saída é o corpo de `POST /{phone-number-id}/messages`, entrada é o objeto `messages[]` do webhook.
 * O banco guarda o tipo e o objeto do tipo (`mensagem.tipo` e `mensagem.conteudo`); o texto legível
 * fica em `mensagem.texto`.
 */
import type { MensagemGravada } from "../caixa-mensagens";

export type TipoMensagem = "text" | "image" | "document" | "interactive" | "template" | "button";
export type StatusMensagem = "sent" | "delivered" | "read" | "failed";

export interface BotaoResposta {
  type: "reply";
  reply: { id: string; title: string };
}

export interface LinhaLista {
  id: string;
  title: string;
  description?: string;
}

interface BaseInterativo {
  header?: { type: "text"; text: string };
  body: { text: string };
  footer?: { text: string };
}

export type Interativo =
  | (BaseInterativo & { type: "button"; action: { buttons: BotaoResposta[] } })
  | (BaseInterativo & {
      type: "list";
      action: { button: string; sections: { title?: string; rows: LinhaLista[] }[] };
    })
  | (BaseInterativo & {
      type: "cta_url";
      action: { name: "cta_url"; parameters: { display_text: string; url: string } };
    });

export interface ParametroTexto {
  type: "text";
  text: string;
}

export interface Template {
  name: string;
  language: { code: string };
  components: (
    | { type: "body"; parameters: ParametroTexto[] }
    | {
        type: "button";
        sub_type: "quick_reply";
        index: number;
        parameters: { type: "payload"; payload: string }[];
      }
  )[];
}

/** O que a empresa (o agente ou a camada de canal) manda ao dono. */
export type SaidaWhatsapp =
  | { type: "text"; text: { body: string } }
  | { type: "interactive"; interactive: Interativo }
  | { type: "template"; template: Template };

/** Mensagem como a API do chat devolve ao front (`tipos.js`, `Mensagem`). */
export interface MensagemWhatsapp {
  id: string;
  direcao: "entrada" | "saida";
  timestamp: number;
  type: TipoMensagem;
  status?: StatusMensagem;
  context?: { id: string };
  [objetoDoTipo: string]: unknown;
}

/** Texto legível de uma saída, guardado em `mensagem.texto` (histórico, bastidores, contexto do agente). */
export function textoDaSaida(s: SaidaWhatsapp, corpoDoModelo: (t: Template) => string): string {
  if (s.type === "text") return s.text.body;
  if (s.type === "template") return corpoDoModelo(s.template);
  return s.interactive.body.text;
}

/** O objeto do tipo, guardado em `mensagem.conteudo`. Texto puro não precisa: o corpo é o `texto`. */
export function conteudoDaSaida(s: SaidaWhatsapp): Record<string, unknown> | null {
  if (s.type === "interactive") return { ...s.interactive };
  if (s.type === "template") return { ...s.template };
  return null;
}

/**
 * Linha gravada para o formato da API. A mensagem do dono usa o id que o canal deu a ela (o front
 * gera o id, como a Meta no webhook), então o status chega à bolha certa; a do agente usa o id do banco,
 * que é o que o dono cita ao tocar num botão. O status só vai nas mensagens do dono (tiques).
 */
export function paraWhatsapp(m: MensagemGravada): MensagemWhatsapp {
  const entrada = m.direcao === "recebida";
  const saida: MensagemWhatsapp = {
    id: entrada ? (m.idExterno ?? m.id) : m.id,
    direcao: entrada ? "entrada" : "saida",
    timestamp: m.criadaEm.getTime(),
    type: m.tipo,
  };
  if (entrada && m.status) saida.status = m.status;
  if (m.contextoId) saida.context = { id: m.contextoId };
  saida[m.tipo] = m.tipo === "text" ? { body: m.texto } : (m.conteudo ?? {});
  return saida;
}
