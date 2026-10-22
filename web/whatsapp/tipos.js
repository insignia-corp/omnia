/**
 * Contrato entre a tela e o transporte (demonstração hoje, API do backend na integração).
 * As mensagens seguem o formato da WhatsApp Cloud API para o canal real reaproveitar o mesmo desenho:
 * - saída (empresa para o dono): o corpo de `POST /{phone-number-id}/messages`;
 * - entrada (dono para a empresa): o objeto `messages[]` do webhook.
 * Detalhe e exemplos em README.md.
 */

/**
 * @typedef {"sent" | "delivered" | "read" | "failed"} StatusMensagem
 *
 * @typedef {object} Mensagem
 * @property {string} id                       `wamid.*`
 * @property {"entrada" | "saida"} direcao     entrada = o dono escreveu; saida = o agente escreveu
 * @property {number} timestamp                milissegundos desde a época
 * @property {"text" | "image" | "document" | "interactive" | "template" | "button"} type  `button`: toque em botão de modelo
 * @property {StatusMensagem} [status]         só nas mensagens do dono (tiques)
 * @property {{ id: string }} [context]        mensagem citada (resposta)
 * @property {{ body: string, preview_url?: boolean }} [text]
 * @property {{ link?: string, id?: string, mime_type?: string, caption?: string }} [image]
 * @property {{ link?: string, id?: string, filename: string, mime_type?: string, caption?: string, tamanho?: number }} [document]
 * @property {object} [interactive]            saída: button | list | cta_url; entrada: button_reply | list_reply
 * @property {{ payload: string, text: string }} [button]  entrada: resposta rápida de um modelo
 * @property {{ name: string, language?: { code: string }, components?: object[] }} [template]
 * @property {string[]} [recusada]             motivos quando a mensagem viola regra da Meta (só aviso de integração)
 *
 * @typedef {{ tipo: "mensagem", mensagem: Mensagem }
 *   | { tipo: "status", id: string, status: StatusMensagem }
 *   | { tipo: "digitando", ativo: boolean }} Evento
 *
 * @typedef {object} Transporte
 * @property {string} nome
 * @property {() => Promise<Mensagem[]>} historico
 * @property {(m: Mensagem, arquivo?: File) => Promise<void>} enviar   recebe a mensagem já com id e status "sent"
 * @property {(ouvinte: (e: Evento) => void) => void} aoEvento
 * @property {() => Promise<void>} [reiniciar]
 */

export {};
