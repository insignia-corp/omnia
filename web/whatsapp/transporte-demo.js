/**
 * Transporte de demonstração: simula o agente sem backend, para desenvolver a tela e ensaiar o pitch.
 * Os números são os do gabarito (`fixtures/gabarito/metricas.json` e `fixtures/notas/nota-16.esperado.json`,
 * data de referência 2026-10-19), em centavos e pontos-base como no backend. No modo `api` eles vêm
 * das ferramentas do agente; este arquivo some do caminho.
 *
 * O tempo das respostas imita o canal real: tique simples, tique duplo, "lida" com indicador de
 * digitação (a Cloud API marca como lida e mostra "digitando" na mesma chamada) e só então a resposta.
 */
import { conferirSaida } from "./regras-meta.js";

const LOJA = "Mercadinho Vila Nova";

/** Centavos inteiros para "R$ 1.234,56" sem passar por ponto flutuante. */
export function reais(centavos) {
  const s = String(Math.abs(centavos)).padStart(3, "0");
  const inteiro = s.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${centavos < 0 ? "-" : ""}R$ ${inteiro},${s.slice(-2)}`;
}

/** Pontos-base para "12,05%" (ou "25%" quando não há centésimos). */
export function porcento(bps) {
  const s = String(Math.abs(bps)).padStart(3, "0");
  const decimais = s.slice(-2) === "00" ? "" : `,${s.slice(-2)}`;
  return `${bps < 0 ? "-" : ""}${s.slice(0, -2)}${decimais}%`;
}

const D = {
  dia: {
    rotulo: "segunda, 19/10",
    data: "19/10",
    faturamento: 122151,
    cupons: 78,
    ticket: 1566,
    media7: 175072,
    variacaoBps: -3023,
  },
  semana: {
    rotulo: "13/10 a 19/10",
    faturamento: 1170942,
    anterior: 1193945,
    cupons: 447,
  },
  mes: {
    rotulo: "01/10 a 19/10",
    faturamento: 3165305,
    anterior: 3029588,
    cupons: 1159,
  },
  arroz: {
    nome: "Arroz branco tipo 1 5kg",
    custoAnterior: 2490,
    custoAtual: 2790,
    variacaoBps: 1205,
    margemBps: 2026,
    precoMedio: 3499,
  },
  metaBps: 2500,
  margens: [
    ["Arroz branco tipo 1 5kg", 2026],
    ["Leite integral 1L", 2067],
    ["Cerveja pilsen lata 350ml", 2128],
    ["Óleo de soja 900ml", 2318],
  ],
  nota: {
    fornecedor: "Distribuidora Aurora Alimentos",
    data: "16/10",
    itens: [
      ["Arroz branco 5kg", 16, 2790],
      ["Farinha de trigo 1kg", 6, 330],
      ["Sal refinado 1kg", 6, 125],
    ],
    total: 47370,
  },
};

// Variação em bps arredondada: (atual - anterior) / anterior, só com inteiros.
const variacaoBps = (atual, anterior) => Math.round(((atual - anterior) * 10000) / anterior);
const ticket = (fat, cupons) => Math.round(fat / cupons);
const comparacao = (bps, referencia) =>
  `${bps < 0 ? "📉" : "📈"} ${porcento(Math.abs(bps))} ${bps < 0 ? "abaixo" : "acima"} ${referencia}`;

const RODAPE = "Dados até 19/10, conferidos pelo Omnia";

const texto = (body) => ({ type: "text", text: { body } });
const botoes = (body, lista, extra = {}) => ({
  type: "interactive",
  interactive: {
    type: "button",
    ...extra,
    body: { text: body },
    action: { buttons: lista.map(([id, title]) => ({ type: "reply", reply: { id, title } })) },
  },
});

function menu(corpo) {
  return {
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: "Omnia" },
      body: { text: corpo },
      footer: { text: "Você também pode mandar a foto da nota aqui" },
      action: {
        button: "Ver opções",
        sections: [
          {
            title: "Resumos",
            rows: [
              {
                id: "resumo_dia",
                title: "Resumo do dia",
                description: "Vendas e ticket médio do último dia",
              },
              {
                id: "resumo_semana",
                title: "Resumo da semana",
                description: "Últimos 7 dias comparados com a semana anterior",
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
              { id: "painel", title: "Abrir painel", description: "Gráficos e números completos" },
            ],
          },
        ],
      },
    },
  };
}

function resumoDia() {
  const d = D.dia;
  return botoes(
    [
      `*Resumo de ${d.rotulo}*`,
      "",
      `💰 Faturamento: *${reais(d.faturamento)}* em ${d.cupons} vendas`,
      `${comparacao(d.variacaoBps, "da média dos 7 dias anteriores")} (${reais(d.media7)})`,
      `🧾 Ticket médio: ${reais(d.ticket)}`,
    ].join("\n"),
    [
      ["resumo_semana", "Resumo da semana"],
      ["avisos", "Ver avisos"],
      ["menu", "Menu"],
    ],
    { footer: { text: RODAPE } },
  );
}

function resumoPeriodo(p, titulo, referencia, proximo) {
  return botoes(
    [
      `*${titulo}, ${p.rotulo}*`,
      "",
      `💰 Faturamento: *${reais(p.faturamento)}* em ${p.cupons.toLocaleString("pt-BR")} vendas`,
      `${comparacao(variacaoBps(p.faturamento, p.anterior), referencia)} (${reais(p.anterior)})`,
      `🧾 Ticket médio: ${reais(ticket(p.faturamento, p.cupons))}`,
    ].join("\n"),
    [proximo, ["avisos", "Ver avisos"], ["menu", "Menu"]],
    { footer: { text: RODAPE } },
  );
}

function avisos() {
  const a = D.arroz;
  return botoes(
    [
      "Separei 2 avisos para hoje:",
      "",
      `1️⃣ *${a.nome} subiu ${porcento(a.variacaoBps)}* na ${D.nota.fornecedor} (${reais(a.custoAnterior)} para ${reais(a.custoAtual)}, nota de ${D.nota.data}). A margem dele caiu para ${porcento(a.margemBps)}, abaixo da sua meta de ${porcento(D.metaBps)}.`,
      "",
      "2️⃣ *Vinagre de álcool 750ml está parado há 41 dias*. Uma promoção pode ajudar a girar esse estoque.",
    ].join("\n"),
    [
      ["sugerir_preco", "Sugerir preço"],
      ["margens", "Ver margens"],
      ["menu", "Menu"],
    ],
  );
}

function margens() {
  return botoes(
    [
      `*Produtos abaixo da meta de ${porcento(D.metaBps)}*`,
      "",
      ...D.margens.map(([nome, bps]) => `• ${nome}: ${porcento(bps)}`),
      "",
      "Os outros produtos estão na meta ou acima.",
    ].join("\n"),
    [
      ["sugerir_preco", "Sugerir preço"],
      ["menu", "Menu"],
    ],
    { footer: { text: RODAPE } },
  );
}

// Preço que devolve a margem à meta: custo / (1 - meta), em centavos inteiros.
const precoParaMeta = (custo, metaBps) => Math.ceil((custo * 10000) / (10000 - metaBps));

function sugerirPreco() {
  const a = D.arroz;
  const preco = precoParaMeta(a.custoAtual, D.metaBps);
  return botoes(
    [
      `Para o *${a.nome}* voltar à meta de ${porcento(D.metaBps)} com o custo de ${reais(a.custoAtual)}, o preço de venda precisa ser *${reais(preco)}*. Hoje a média de venda está em ${reais(a.precoMedio)}.`,
      "",
      `Quer que eu guarde ${reais(preco)} como preço-meta do arroz? Isso só muda o seu cadastro aqui no Omnia, não altera nada no caixa.`,
    ].join("\n"),
    [
      ["confirmar_preco", "Sim, guardar"],
      ["cancelar", "Agora não"],
    ],
  );
}

function notaLida(origem) {
  const n = D.nota;
  return botoes(
    [
      `Li ${origem} da *${n.fornecedor}*, de ${n.data}:`,
      "",
      ...n.itens.map(([nome, qtd, unit]) => `• ${nome}: ${qtd} un. x ${reais(unit)} = ${reais(qtd * unit)}`),
      "",
      `*Total: ${reais(n.total)}* (confere com a soma dos itens)`,
      "",
      `⚠️ O arroz subiu *${porcento(D.arroz.variacaoBps)}* desde a última compra (${reais(D.arroz.custoAnterior)}). Com o preço de venda atual, a margem dele fica em ${porcento(D.arroz.margemBps)}, abaixo da sua meta de ${porcento(D.metaBps)}.`,
    ].join("\n"),
    [
      ["sugerir_preco", "Sugerir preço"],
      ["nota_ok", "Está tudo certo"],
      ["nota_corrigir", "Corrigir item"],
    ],
    { header: { type: "text", text: "Nota lida" } },
  );
}

function painel(url) {
  return {
    type: "interactive",
    interactive: {
      type: "cta_url",
      header: { type: "text", text: "Painel do Omnia" },
      body: { text: "Seus números completos, com gráficos de vendas e margens. O link é só seu." },
      footer: { text: RODAPE },
      action: { name: "cta_url", parameters: { display_text: "Abrir painel", url } },
    },
  };
}

const normalizar = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

// "sal 6 por 1,30", "arroz 16 x 27,90", "sal 6 por r$ 1,30"
const CORRECAO = /^([a-z][a-z ]*?)\s+(\d+)\s*(?:un\.?\s*)?(?:por|x|a)\s*(?:r\$\s*)?(\d+(?:,\d{1,2})?)$/;

/** "1,3" e "1,30" para 130 centavos, só com inteiros (regra 2). */
const centavosDoTexto = (valor) => {
  const [inteiro, decimais = ""] = valor.split(",");
  return Number(inteiro) * 100 + Number(decimais.padEnd(2, "0"));
};

/** Descobre a intenção pelo id do botão ou por palavras do texto. */
function intencao(m, estado) {
  const it = m.interactive;
  const id = it?.button_reply?.id ?? it?.list_reply?.id ?? m.button?.payload;
  if (id) return id;
  if (m.type === "image") return "nota_foto";
  if (m.type === "document") return "nota_xml";
  const t = normalizar(m.text?.body ?? "");
  if (estado.aguardandoCorrecao && CORRECAO.test(t)) return "corrigir_valor";
  // Perguntas que o agente não sabe responder vêm antes dos períodos (casos q33 e q36 da avaliação).
  if (/\blucro\b/.test(t)) return "sem_lucro";
  if (/\b(que vem|proximo|proxima|previsao|prever|vai ser|vou faturar|vai dar)\b/.test(t))
    return "sem_previsao";
  if (/\b(semana|semanal)\b/.test(t)) return "resumo_semana";
  if (/\b(mes|mensal)\b/.test(t)) return "resumo_mes";
  if (/\b(resumo|diario|ontem|vendi|vendas|faturamento|faturei)\b/.test(t)) return "resumo_dia";
  if (/\b(painel|dashboard|grafico|graficos|relatorio)\b/.test(t)) return "painel";
  if (/\b(margem|margens)\b/.test(t)) return "margens";
  if (/\b(preco|precos|sugest)/.test(t)) return "sugerir_preco";
  if (/\b(aviso|avisos|alerta|alertas|feedback|como (estou|esta|ta)|importa|novidade)/.test(t))
    return "avisos";
  if (/\b(nota|notas|xml|nf-?e)\b/.test(t)) return "como_nota";
  if (/\b(sim|confirmo|pode guardar)\b/.test(t)) return "confirmar_preco";
  if (/\b(nao|agora nao|depois)\b/.test(t)) return "cancelar";
  if (/\b(obrigad|valeu|ok|beleza|show)/.test(t)) return "agradecer";
  if (/\b(oi|ola|bom dia|boa tarde|boa noite|menu|ajuda|opcoes|comecar|inicio)\b/.test(t)) return "menu";
  return "nao_sei";
}

function corrigirItem(texto) {
  const [, nome, qtd, valor] = CORRECAO.exec(normalizar(texto)) ?? [];
  const primeira = nome?.trim().split(" ")[0] ?? "";
  const item = D.nota.itens.find(([n]) =>
    normalizar(n)
      .split(" ")
      .some((p) => p.startsWith(primeira)),
  );
  if (!item) return null;
  const [nomeItem, qtdAntes, unitAntes] = item;
  const quantidade = Number(qtd);
  const unitario = centavosDoTexto(valor);
  const novaSoma = D.nota.total - qtdAntes * unitAntes + quantidade * unitario;
  return botoes(
    [
      `Anotei a correção: *${nomeItem}*: ${quantidade} un. x ${reais(unitario)} = ${reais(quantidade * unitario)} (antes ${qtdAntes} un. x ${reais(unitAntes)}).`,
      "",
      novaSoma === D.nota.total
        ? `A soma dos itens continua batendo com o total da nota (${reais(D.nota.total)}).`
        : `Com isso a soma dos itens fica em *${reais(novaSoma)}*, diferente do total impresso na nota (${reais(D.nota.total)}). Confere?`,
    ].join("\n"),
    [
      ["nota_ok", "Está certo"],
      ["nota_corrigir", "Corrigir de novo"],
    ],
  );
}

const AJUDA_CORRECAO = `Me diga o item, a quantidade e o valor unitário certo, por exemplo: _sal 6 por 1,30_. Os itens da nota são: ${D.nota.itens.map(([n]) => n).join(", ")}.`;

/**
 * Respostas do agente para uma mensagem do dono: lista de mensagens de saída, em ordem.
 * `estado` guarda o que a conversa espera (proposta de preço, correção de item) e é alterado aqui.
 * @param {{ propostaPendente?: boolean, aguardandoCorrecao?: boolean }} [estado]
 */
export function responder(m, config, estado = {}) {
  const tinhaProposta = Boolean(estado.propostaPendente);
  estado.propostaPendente = false;
  const intento = intencao(m, estado);
  estado.aguardandoCorrecao = false;
  switch (intento) {
    case "menu":
      return [
        menu(
          `Oi! Sou o Omnia, o gestor do ${LOJA} no WhatsApp. Te mando resumos, leio suas notas de compra e aviso o que mexe no seu lucro.\n\nEscolha uma opção ou escreva sua pergunta.`,
        ),
      ];
    case "resumo_dia":
      return [resumoDia()];
    case "resumo_semana":
      return [
        resumoPeriodo(D.semana, "Resumo da semana", "da semana anterior", ["resumo_mes", "Resumo do mês"]),
      ];
    case "resumo_mes":
      return [
        resumoPeriodo(D.mes, "Resumo do mês", "do mesmo período de setembro", [
          "resumo_semana",
          "Resumo da semana",
        ]),
      ];
    case "avisos":
      return [avisos()];
    case "margens":
      return [margens()];
    case "sugerir_preco":
      estado.propostaPendente = true;
      return [sugerirPreco()];
    case "confirmar_preco":
      // Regra 7: só grava o que o dono confirmou. O botão já é contextual; um "sim" solto só vale com proposta aberta.
      if (!tinhaProposta && m.type === "text")
        return [
          botoes("Não tenho nenhuma sugestão de preço esperando sua confirmação. Quer que eu calcule uma?", [
            ["sugerir_preco", "Sugerir preço"],
            ["menu", "Menu"],
          ]),
        ];
      return [
        texto(
          `Pronto, guardei *${reais(precoParaMeta(D.arroz.custoAtual, D.metaBps))}* como preço-meta do ${D.arroz.nome}. Te aviso se a margem cair de novo.`,
        ),
      ];
    case "cancelar":
      return [texto("Tudo bem. Quando precisar, é só chamar.")];
    case "agradecer":
      return [texto("Por nada! Estou por aqui. 👍")];
    case "como_nota":
      return [
        texto(
          "Para eu ler uma nota, toque no *+* aqui embaixo e escolha *Fotos* (nota em papel) ou *Documento* (XML da NF-e). Eu confiro itens, quantidades e valores, e aviso se algum custo subiu.",
        ),
      ];
    case "nota_foto":
      return [
        texto("Recebi a foto da nota e estou lendo. Se algum item ficar em dúvida, eu pergunto."),
        notaLida("a nota"),
      ];
    case "nota_xml":
      return [texto("Recebi o XML da nota e estou lendo."), notaLida("o XML da nota")];
    case "nota_ok":
      return [texto("Obrigado! Guardei a nota no seu histórico de compras.")];
    case "nota_corrigir":
      estado.aguardandoCorrecao = true;
      return [texto(AJUDA_CORRECAO)];
    case "corrigir_valor": {
      const correcao = corrigirItem(m.text?.body ?? "");
      if (correcao) return [correcao];
      estado.aguardandoCorrecao = true;
      return [texto(`Não achei esse item na nota. ${AJUDA_CORRECAO}`)];
    }
    case "sem_lucro":
      return [
        texto(
          "Ainda não consigo dizer o seu lucro: faltam o custo de todos os produtos. Se você me mandar as notas de compra que faltam, eu passo a calcular. Enquanto isso, posso te mostrar faturamento, ticket médio e margem dos produtos que já conheço.",
        ),
      ];
    case "sem_previsao":
      return [
        texto(
          "Não faço previsão de faturamento com os dados que tenho. Posso te mostrar como foram os últimos dias, a semana e o mês até agora.",
        ),
      ];
    case "painel":
      return [painel(config.painelUrl)];
    default:
      return [
        menu(
          "Ainda não sei responder isso por aqui. Posso te mandar resumos, ler notas e mostrar seus avisos.",
        ),
      ];
  }
}

const novoId = () => `wamid.demo${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const tempoDigitando = (m) => {
  const tamanho = JSON.stringify(m).length;
  return Math.min(900 + tamanho * 2, 2800);
};

/**
 * @param {{ painelUrl: string }} config
 * @returns {import("./tipos.js").Transporte & { simularProativa(): Promise<string | null> }}
 */
export function criarTransporteDemo(config) {
  /** @type {((e: import("./tipos.js").Evento) => void)[]} */
  const ouvintes = [];
  let ultimaDoDono = null;
  let proativaEnviadaEm = null;
  let fila = Promise.resolve();
  let estado = {};
  // Limpar a conversa troca a geração; respostas de mensagens anteriores param no próximo passo.
  let geracao = 0;

  const emitir = (e) => ouvintes.forEach((o) => o(e));

  function entregar(saida) {
    const m = { id: novoId(), direcao: "saida", timestamp: Date.now(), ...saida };
    const recusa = conferirSaida(m, ultimaDoDono, m.timestamp);
    if (recusa.length) {
      m.recusada = recusa;
      console.warn("[regras da Meta]", recusa, m);
    }
    emitir({ tipo: "mensagem", mensagem: m });
  }

  async function processar(m, g) {
    const valendo = () => g === geracao;
    await esperar(250);
    if (!valendo()) return;
    emitir({ tipo: "status", id: m.id, status: "delivered" });
    await esperar(500);
    if (!valendo()) return;
    emitir({ tipo: "status", id: m.id, status: "read" });
    const respostas = responder(m, config, estado);
    for (const [i, r] of respostas.entries()) {
      emitir({ tipo: "digitando", ativo: true });
      await esperar(tempoDigitando(r) + (m.type === "image" && i === 1 ? 2200 : 0));
      if (!valendo()) return;
      emitir({ tipo: "digitando", ativo: false });
      entregar(r);
      await esperar(250);
    }
  }

  return {
    nome: "demonstração",
    async historico() {
      return [];
    },
    async enviar(m) {
      ultimaDoDono = m.timestamp;
      const g = geracao;
      fila = fila.then(() => processar(m, g)).catch((e) => console.error(e));
      await Promise.resolve();
    },
    aoEvento(ouvinte) {
      ouvintes.push(ouvinte);
    },
    /**
     * Limpa só a conversa: cancela respostas pendentes e esquece o que ela esperava. A janela de 24 h e
     * a marca da proativa do dia continuam, como no WhatsApp (apagar a conversa não muda o lado da empresa).
     */
    async reiniciar() {
      geracao += 1;
      estado = {};
      emitir({ tipo: "digitando", ativo: false });
    },
    /** Relatório das 7h (modelo). Regra 9: no máximo 1 mensagem proativa por dia. */
    async simularProativa() {
      const hoje = new Date().toDateString();
      if (proativaEnviadaEm === hoje) return "O Omnia manda no máximo 1 mensagem proativa por dia.";
      proativaEnviadaEm = hoje;
      emitir({ tipo: "digitando", ativo: false });
      const d = D.dia;
      entregar({
        type: "template",
        template: {
          name: "resumo_diario",
          language: { code: "pt_BR" },
          components: [
            {
              type: "body",
              parameters: [
                d.rotulo,
                LOJA,
                reais(d.faturamento),
                String(d.cupons),
                `${porcento(Math.abs(d.variacaoBps))} ${d.variacaoBps < 0 ? "abaixo" : "acima"}`,
                "3",
              ].map((text) => ({ type: "text", text })),
            },
            {
              type: "button",
              sub_type: "quick_reply",
              index: 0,
              parameters: [{ type: "payload", payload: "avisos" }],
            },
            {
              type: "button",
              sub_type: "quick_reply",
              index: 1,
              parameters: [{ type: "payload", payload: "resumo_dia" }],
            },
            {
              type: "button",
              sub_type: "quick_reply",
              index: 2,
              parameters: [{ type: "payload", payload: "cancelar" }],
            },
          ],
        },
      });
      return null;
    },
  };
}
