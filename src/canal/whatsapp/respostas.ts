/**
 * Mensagens ricas montadas pela camada de canal, de forma determinística (issue #182). O agente
 * continua escrevendo só texto verificado (regras 1 e 8); aqui entram botões, lista e botão de link
 * escolhidos pelo id do botão que o dono tocou, nunca pelo texto do modelo. Nada aqui acrescenta
 * número: os textos fixos não têm nenhum, e o corpo de uma mensagem com botões é o texto verificado
 * sem mudança.
 */
import { nomeSeguro } from "../../agente/ferramentas/ask-owner";
import type { BotaoResposta, SaidaWhatsapp } from "./formato";
import { conferirSaida, LIMITES_META } from "./regras-meta";

/** Ações que os botões e a lista do Omnia disparam (`reply.id`, `row.id` ou `payload` do modelo). */
export type Acao =
  | "menu"
  | "resumo_dia"
  | "resumo_semana"
  | "resumo_mes"
  | "avisos"
  | "margens"
  | "sugerir_preco"
  | "confirmar_preco"
  | "cancelar"
  | "como_nota"
  | "painel";

const ACOES: ReadonlySet<string> = new Set<Acao>([
  "menu",
  "resumo_dia",
  "resumo_semana",
  "resumo_mes",
  "avisos",
  "margens",
  "sugerir_preco",
  "confirmar_preco",
  "cancelar",
  "como_nota",
  "painel",
]);

export const ehAcao = (id: string | null): id is Acao => id !== null && ACOES.has(id);

/**
 * O pedido que o agente recebe para cada ação que passa por ele. É texto do código, não do dono; o
 * dono só tocou no botão. As de confirmação viram "sim" e "não", que o `AgenteService` resolve em
 * código antes do modelo (issue #104).
 */
export const PEDIDO_AO_AGENTE: Partial<Record<Acao, string>> = {
  resumo_dia: "Resumo de ontem: faturamento, número de vendas e ticket médio.",
  resumo_semana:
    "Resumo da semana: os 7 dias até ontem comparados com os 7 dias anteriores (faturamento, vendas e ticket médio).",
  resumo_mes:
    "Resumo do mês: do dia 1 deste mês até ontem comparado com os mesmos dias do mês passado (faturamento, vendas e ticket médio).",
  avisos: "Quais são os avisos de hoje? Use os candidatos a alerta do dia e me diga os mais importantes.",
  margens: "Quais produtos estão com a margem abaixo da minha meta?",
  sugerir_preco:
    "Qual produto está mais abaixo da meta de margem? Sugira o preço de venda que devolve a margem à meta e me pergunte se guardo como preço-meta.",
  confirmar_preco: "sim",
  cancelar: "não",
};

/**
 * "Sugerir preço" com o produto já escolhido em código (o de menor margem entre os abaixo da meta): o
 * agente só busca a margem dele e propõe o `preco_para_meta_centavos` que a métrica devolve. O nome é
 * cadastro, não instrução: entra limpo (sem aspas nem quebras de linha).
 */
export const pedidoDePreco = (produto: string): string =>
  `Sugira o preço de venda que leva a margem do produto "${nomeSeguro(produto)}" de volta à meta e me pergunte se guardo como preço-meta.`;

const botao = (id: Acao, title: string): BotaoResposta => ({ type: "reply", reply: { id, title } });

export const BOTOES_CONFIRMACAO: BotaoResposta[] = [
  botao("confirmar_preco", "Sim, guardar"),
  botao("cancelar", "Agora não"),
];

/** Próximos passos depois da resposta do agente a cada ação. */
export const BOTOES_SEGUINTES: Partial<Record<Acao, BotaoResposta[]>> = {
  resumo_dia: [
    botao("resumo_semana", "Resumo da semana"),
    botao("avisos", "Ver avisos"),
    botao("menu", "Menu"),
  ],
  resumo_semana: [botao("resumo_mes", "Resumo do mês"), botao("avisos", "Ver avisos"), botao("menu", "Menu")],
  resumo_mes: [
    botao("resumo_semana", "Resumo da semana"),
    botao("avisos", "Ver avisos"),
    botao("menu", "Menu"),
  ],
  avisos: [botao("sugerir_preco", "Sugerir preço"), botao("margens", "Ver margens"), botao("menu", "Menu")],
  margens: [botao("sugerir_preco", "Sugerir preço"), botao("menu", "Menu")],
};

/** Depois de uma nota lida: o que o dono costuma querer ver em seguida. */
export const BOTOES_NOTA: BotaoResposta[] = [
  botao("avisos", "Ver avisos"),
  botao("margens", "Ver margens"),
  botao("menu", "Menu"),
];

/** Depois do relatório diário dentro da janela de 24 h. */
export const BOTOES_RELATORIO: BotaoResposta[] = [
  botao("avisos", "Ver avisos"),
  botao("resumo_semana", "Resumo da semana"),
  botao("menu", "Menu"),
];

/** Saudação ou pedido de menu, sem mais nada: responde com a lista, sem chamar o modelo. */
export function ehSaudacao(texto: string): boolean {
  const t = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[!?.,;:\s]+/g, " ")
    .trim();
  return /^(oi+|ola|opa|e ai|bom dia|boa tarde|boa noite|menu|ajuda|opcoes|inicio|comecar)( omnia)?$/.test(t);
}

export const TEXTO_COMO_NOTA =
  "Para eu ler uma nota, toque no *+* aqui embaixo e escolha *Fotos* (nota em papel) ou *Documento* (XML da NF-e). Eu confiro itens, quantidades e valores, e aviso se algum custo subiu.";

/** Abertura do menu quando o agente não conseguiu responder um texto livre com os dados: sem número (regra 8). */
export const TEXTO_SEM_RESPOSTA =
  "Não consegui responder isso com os seus dados. Posso ajudar com vendas, ticket médio, margens, reajustes de custo, mais vendidos, estoque parado, avisos do dia e notas de compra. Escolha uma opção ou escreva de outro jeito.";

export const TEXTO_CANCELAR = "Tudo bem. Quando precisar, é só chamar.";

export const TEXTO_SEM_PROPOSTA =
  "Essa proposta já não está valendo. Toque em *Sugerir preço* para eu calcular de novo com os dados de agora.";

export const texto = (body: string): SaidaWhatsapp => ({ type: "text", text: { body } });

/** Lista com as opções do Omnia. O nome do comércio vem do cadastro. */
export function menu(nomeComercio: string, abertura?: string): SaidaWhatsapp {
  return {
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: "Omnia" },
      body: {
        text:
          abertura ??
          `Oi! Sou o Omnia, o gestor do ${nomeComercio} no WhatsApp. Te mando resumos, leio suas notas de compra e aviso o que mexe no seu lucro.\n\nEscolha uma opção ou escreva sua pergunta.`,
      },
      footer: { text: "Você também pode mandar a foto da nota aqui" },
      action: {
        button: "Ver opções",
        sections: [
          {
            title: "Resumos",
            rows: [
              { id: "resumo_dia", title: "Resumo do dia", description: "Vendas e ticket médio de ontem" },
              {
                id: "resumo_semana",
                title: "Resumo da semana",
                description: "Semana até ontem comparada com a anterior",
              },
              {
                id: "resumo_mes",
                title: "Resumo do mês",
                description: "Mês até agora comparado com o mesmo período",
              },
            ],
          },
          {
            title: "Meu negócio",
            rows: [
              {
                id: "avisos",
                title: "Avisos de hoje",
                description: "Reajustes, margens e estoque parado",
              },
              {
                id: "margens",
                title: "Margem dos produtos",
                description: "Produtos abaixo da sua meta de margem",
              },
              {
                id: "como_nota",
                title: "Enviar nota fiscal",
                description: "Foto da nota em papel ou XML da NF-e",
              },
              { id: "painel", title: "Abrir painel", description: "Seus números completos numa página" },
            ],
          },
        ],
      },
    },
  };
}

/** Botão de link para o painel. A URL leva o comerciante da sessão (identidade provisória, ver `sessao.ts`). */
export function painel(url: string): SaidaWhatsapp {
  return {
    type: "interactive",
    interactive: {
      type: "cta_url",
      header: { type: "text", text: "Painel do Omnia" },
      body: { text: "Seus números completos: vendas da semana e do mês, margens e avisos. O link é só seu." },
      action: { name: "cta_url", parameters: { display_text: "Abrir painel", url } },
    },
  };
}

const CORPO_SO_BOTOES = "O que você quer ver agora?";

/** Quebra um texto longo em pedaços de até `max` caracteres, preferindo o fim de parágrafo ou de linha. */
export function quebrarTexto(t: string, max: number = LIMITES_META.texto): string[] {
  const pedacos: string[] = [];
  let resto = t;
  while (resto.length > max) {
    const janela = resto.slice(0, max);
    const corte = Math.max(janela.lastIndexOf("\n\n"), janela.lastIndexOf("\n"), janela.lastIndexOf(" "));
    const fim = corte > max / 2 ? corte : max;
    pedacos.push(resto.slice(0, fim).trimEnd());
    resto = resto.slice(fim).trimStart();
  }
  if (resto) pedacos.push(resto);
  return pedacos;
}

/**
 * O texto verificado com os botões, como a Cloud API aceita: até 1024 caracteres vira uma mensagem de
 * botões com o texto no corpo; acima disso, o texto vai sozinho (em pedaços de até 4096) e os botões
 * seguem numa mensagem curta sem número. Sem botões, só o texto.
 */
export function comBotoes(
  corpo: string,
  botoes: BotaoResposta[] | null | undefined,
  extra: { cabecalho?: string; rodape?: string } = {},
): SaidaWhatsapp[] {
  const interativo = (body: string): SaidaWhatsapp => ({
    type: "interactive",
    interactive: {
      type: "button",
      ...(extra.cabecalho ? { header: { type: "text", text: extra.cabecalho } } : {}),
      body: { text: body },
      ...(extra.rodape ? { footer: { text: extra.rodape } } : {}),
      action: { buttons: botoes ?? [] },
    },
  });
  if (!botoes?.length) return quebrarTexto(corpo).map(texto);
  if (corpo.length <= LIMITES_META.corpoInterativo) return [interativo(corpo)];
  return [...quebrarTexto(corpo).map(texto), interativo(CORPO_SO_BOTOES)];
}

/**
 * Última barreira antes de gravar: mensagem que a Meta recusaria vira texto puro (o corpo verificado
 * continua o mesmo). Devolve também os motivos, para o log.
 */
export function garantirRegras(s: SaidaWhatsapp): { saida: SaidaWhatsapp; recusas: string[] } {
  const recusas = conferirSaida(s);
  if (recusas.length === 0 || s.type !== "interactive") return { saida: s, recusas };
  return { saida: texto(s.interactive.body.text), recusas };
}
