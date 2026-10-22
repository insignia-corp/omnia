import { Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from "@nestjs/common";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { DB, type Db } from "../infra/database/database.module";
import {
  comerciante,
  compra,
  documento,
  fornecedor,
  itemDeCompra,
  perguntaDono,
} from "../infra/database/schema";
import { FilaExtracao } from "../ingestao/fila/fila-extracao";
import { ErroPergunta, responderPergunta } from "../ingestao/revisao/responder-pergunta";
import { MetricasService } from "../metricas/metricas.service";
import { CaixaMensagens, type MensagemGravada } from "./caixa-mensagens";
import { MESSAGE_CHANNEL, type MessageChannel } from "./message-channel";
import { PORTA_AGENTE, type PortaAgente } from "./porta-agente";
import { dataLocal, RELOGIO, type Relogio } from "./relogio";
import { lerEntrada, type EntradaLida, type EntradaWhatsapp } from "./whatsapp/entrada";
import type { SaidaWhatsapp } from "./whatsapp/formato";
import { MAX_PERGUNTAS_NA_CONVERSA, textoNotaLida, type NotaParaMensagem } from "./whatsapp/nota-lida";
import {
  lerAcaoDaPergunta,
  perguntaParaSaida,
  TEXTO_NOTA_CONFERIDA,
  TEXTO_PERGUNTA_FALHOU,
  TEXTO_PERGUNTA_JA_RESPONDIDA,
  TEXTO_PERGUNTA_RESOLVIDA,
  TEXTO_REENVIAR_NOTA,
  TEXTO_SEM_PRODUTO,
  type PerguntaDaNota,
  type RespostaDaNota,
} from "./whatsapp/perguntas-da-nota";
import {
  BOTOES_CONFIRMACAO,
  BOTOES_NOTA,
  BOTOES_SEGUINTES,
  comBotoes,
  ehAcao,
  ehSaudacao,
  garantirRegras,
  menu,
  painel,
  PEDIDO_AO_AGENTE,
  pedidoDePreco,
  texto,
  TEXTO_CANCELAR,
  TEXTO_COMO_NOTA,
  TEXTO_SEM_PROPOSTA,
} from "./whatsapp/respostas";

/** Aviso fixo, sem números e sem texto do modelo (regra 1): a leitura da nota falhou de vez. */
export const TEXTO_FALHA_NOTA =
  "Não consegui ler esta nota. Pode mandar outra foto, com a nota inteira, reta e bem iluminada?";

const INTERVALO_ESPERA_MS = 250;
/** Folga sobre o tempo limite do modelo para a primeira chamada gravar a resposta. */
const ESPERA_FOLGA_MS = 5_000;
/**
 * Quantas chaves a reentrega consulta. Uma resposta vira várias mensagens (texto longo em pedaços de
 * até 4096 caracteres e os botões); com o teto de tokens do modelo, nem perto de 64 pedaços.
 */
const MAX_MENSAGENS_POR_RESPOSTA = 64;
/** Por quanto tempo uma nota em leitura mostra "digitando" (a extração tem 3 tentativas com espera). */
const MINUTOS_DIGITANDO_NOTA = 5;

/** Chaves de idempotência das mensagens de uma resposta: a primeira é a do chat web antigo. */
const chavesDaResposta = (idExterno: string, quantas = MAX_MENSAGENS_POR_RESPOSTA): string[] =>
  Array.from({ length: quantas }, (_, i) =>
    i === 0 ? `resposta_${idExterno}` : `resposta_${idExterno}_${i + 1}`,
  );

/** Como o dono mandou a nota pela conversa: o id que o canal deu à mensagem e o que ela mostra. */
export interface NotaPelaConversa {
  idExterno: string;
  legenda?: string;
  nomeArquivo?: string;
  mimeType?: string;
}

/**
 * Modo conversa: mensagem do dono entra, o agente responde, a resposta sai pelo canal. O
 * `comercianteId` vem da sessão (ou do remetente já resolvido pelo canal), nunca do modelo.
 */
@Injectable()
export class ConversaService implements OnModuleInit {
  private readonly log = new Logger(ConversaService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(MESSAGE_CHANNEL) private readonly canal: MessageChannel,
    @Inject(PORTA_AGENTE) private readonly agente: PortaAgente,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    private readonly caixa: CaixaMensagens,
    private readonly filaExtracao: FilaExtracao,
    private readonly metricas: MetricasService,
  ) {}

  onModuleInit(): void {
    // Canais que entregam por callback (WhatsApp, canal em memória). No web a entrada é HTTP.
    // O remetente precisa ser o id do comerciante; o WhatsApp resolverá o número antes (#61).
    this.canal.aoReceber(async (m) => {
      if (m.texto) await this.tratar(m.remetente, m.idExterno, m.texto);
    });
    // A ingestão não conhece o canal: registra aqui quem avisa o dono quando a nota falha de vez ou é lida.
    this.filaExtracao.aoFalharDeVez(async ({ comercianteId, documentoId }) => {
      await this.avisarFalhaExtracao(comercianteId, documentoId);
    });
    this.filaExtracao.aoConcluir(async ({ comercianteId, documentoId }) => {
      await this.avisarNotaLida(comercianteId, documentoId);
    });
  }

  /** Reentrega do mesmo `idExterno` não roda o agente de novo: devolve a resposta já gravada. */
  async tratar(comercianteId: string, idExterno: string, texto: string): Promise<MensagemGravada> {
    const dono = await this.buscarDono(comercianteId);
    const chave = `resposta_${idExterno}`;
    const recebida = await this.caixa.registrarRecebida({ comercianteId, idExterno, texto });
    if (!recebida.nova) {
      // Reentrega: a primeira ainda pode estar no modelo. Espera a resposta dela em vez de chamar (e
      // cobrar) o agente de novo; só se ela não aparecer a tempo, tenta de novo.
      const anterior = await this.aguardarResposta(comercianteId, chave);
      if (anterior) return anterior;
    }

    await this.caixa.marcarStatus(comercianteId, recebida.id, "read");
    const resposta = await this.executarAgente(comercianteId, dono.nome, texto);
    await this.caixa.enviarResposta({
      comercianteId,
      texto: resposta.mensagem,
      execucaoId: resposta.execucaoId,
      chave,
    });
    const gravada = await this.caixa.buscarPorChave(comercianteId, chave);
    return gravada!;
  }

  /**
   * Mensagem do dono no formato do webhook da Cloud API (front do WhatsApp simulado, issue #182).
   * Gravar marca "entregue"; antes de responder, "lida" (é o que liga o "digitando" no front). A
   * resposta é o texto verificado do agente, com botões, lista ou link escolhidos em código pela ação
   * do botão tocado. Devolve a mensagem do dono e as respostas, na ordem.
   */
  async tratarWhatsapp(comercianteId: string, m: EntradaWhatsapp): Promise<MensagemGravada[]> {
    const dono = await this.buscarDono(comercianteId);
    const lida = lerEntrada(m);
    const chaves = chavesDaResposta(m.id);
    const recebida = await this.caixa.registrarRecebida({
      comercianteId,
      idExterno: m.id,
      texto: lida.texto,
      tipo: lida.tipo,
      conteudo: lida.conteudo,
      contextoId: m.context?.id ?? null,
    });
    const doDono = async () => (await this.caixa.buscarRecebida(comercianteId, m.id))!;

    if (!recebida.nova && (await this.aguardarResposta(comercianteId, chaves[0]!))) {
      return [await doDono(), ...(await this.caixa.buscarPorChaves(comercianteId, chaves))];
    }

    await this.caixa.marcarStatus(comercianteId, recebida.id, "read");
    const { saidas, execucaoId } = await this.responder(comercianteId, dono.nome, lida);
    // Uma chave por mensagem: nenhum pedaço da resposta fica de fora.
    await this.enviarSaidas(comercianteId, saidas, chavesDaResposta(m.id, saidas.length), execucaoId);
    return [await doDono(), ...(await this.caixa.buscarPorChaves(comercianteId, chaves))];
  }

  /**
   * "Digitando" para o front: há mensagem do dono lida e ainda sem resposta (o agente está rodando),
   * ou uma nota enviada pela conversa ainda em leitura. Tudo vem do banco, nada do processo (regra 11).
   */
  async digitando(comercianteId: string): Promise<boolean> {
    const limiteAgenteMs = this.env.AGENTE_TIMEOUT_MS + ESPERA_FOLGA_MS;
    const r = await this.db.execute<{ digitando: boolean }>(sql`
      select exists (
        select 1 from mensagem m
        where m.comerciante_id = ${comercianteId} and m.direcao = 'recebida' and m.status = 'read'
          and m.criado_em > now() - make_interval(secs => ${limiteAgenteMs / 1000})
          and not exists (
            select 1 from mensagem r
            where r.comerciante_id = m.comerciante_id and r.chave_idempotencia = 'resposta_' || m.id_externo
          )
      ) or exists (
        select 1 from documento d
        where d.comerciante_id = ${comercianteId} and d.status_extracao in ('pendente', 'processando')
          and d.criado_em > now() - make_interval(mins => ${MINUTOS_DIGITANDO_NOTA})
          and exists (
            select 1 from mensagem a
            where a.comerciante_id = d.comerciante_id and a.chave_idempotencia = 'nota_' || d.id::text
          )
      ) as digitando
    `);
    return r.rows[0]?.digitando === true;
  }

  private async responder(
    comercianteId: string,
    nomeComercio: string,
    lida: EntradaLida,
  ): Promise<{ saidas: SaidaWhatsapp[]; execucaoId: string | null }> {
    const fixa = (saida: SaidaWhatsapp) => ({ saidas: [saida], execucaoId: null });
    const daNota = lerAcaoDaPergunta(lida.acao);
    if (daNota) return fixa(texto(await this.responderPerguntaDaNota(comercianteId, daNota)));
    const acao = ehAcao(lida.acao) ? lida.acao : null;
    if (acao === "menu" || (lida.acao === null && ehSaudacao(lida.texto))) return fixa(menu(nomeComercio));
    if (acao === "como_nota") return fixa(texto(TEXTO_COMO_NOTA));
    if (acao === "painel") return fixa(painel(`/painel/?comerciante=${comercianteId}`));
    // "Sim, guardar" e "Agora não" só valem com proposta pendente; sem ela, o modelo não precisa rodar.
    if (
      (acao === "cancelar" || acao === "confirmar_preco") &&
      !(await this.temConfirmacaoPendente(comercianteId))
    ) {
      return fixa(texto(acao === "cancelar" ? TEXTO_CANCELAR : TEXTO_SEM_PROPOSTA));
    }

    const produto = acao === "sugerir_preco" ? await this.maisAbaixoDaMeta(comercianteId) : null;
    const pedido = produto ? pedidoDePreco(produto) : ((acao && PEDIDO_AO_AGENTE[acao]) ?? lida.texto);
    const resposta = await this.executarAgente(comercianteId, nomeComercio, pedido);
    // O agente encerra a proposta pendente antes de rodar (a não ser no próprio "sim" ou "não"): uma
    // pendente agora foi criada nesta execução e espera o toque do dono.
    const botoes = (await this.temConfirmacaoPendente(comercianteId))
      ? BOTOES_CONFIRMACAO
      : acao
        ? BOTOES_SEGUINTES[acao]
        : null;
    return { saidas: comBotoes(resposta.mensagem, botoes), execucaoId: resposta.execucaoId };
  }

  /**
   * Resposta tocada numa pergunta da nota: vai ao mesmo resolvedor de `POST /perguntas/:id/resposta`,
   * com o corpo montado em código. "Sim" no item confirma o valor que a leitura gravou; "não" não grava
   * nada e diz como seguir. Devolve o texto fixo da confirmação, sem número.
   */
  private async responderPerguntaDaNota(comercianteId: string, r: RespostaDaNota): Promise<string> {
    const [p] = await this.db
      .select({ tipo: perguntaDono.tipo, status: perguntaDono.status, itemId: perguntaDono.itemDeCompraId })
      .from(perguntaDono)
      .where(and(eq(perguntaDono.id, r.perguntaId), eq(perguntaDono.comercianteId, comercianteId)))
      .limit(1);
    if (!p) return TEXTO_PERGUNTA_FALHOU;
    if (p.status !== "pendente") return TEXTO_PERGUNTA_JA_RESPONDIDA;
    if (r.tipo === "nao") return p.tipo === "confirmar_vinculo" ? TEXTO_SEM_PRODUTO : TEXTO_REENVIAR_NOTA;

    let corpo: unknown;
    if (r.tipo === "produto") corpo = { produto_id: r.produtoId };
    else if (p.tipo === "confirmar_documento") corpo = { confirmado: true };
    else if (p.tipo === "confirmar_item" && p.itemId) {
      const [item] = await this.db
        .select({ valor: itemDeCompra.valorUnitarioCentavos })
        .from(itemDeCompra)
        .where(and(eq(itemDeCompra.id, p.itemId), eq(itemDeCompra.comercianteId, comercianteId)))
        .limit(1);
      if (!item) return TEXTO_PERGUNTA_FALHOU;
      corpo = { valor_unitario_centavos: Number(item.valor) };
    } else return TEXTO_PERGUNTA_FALHOU;

    try {
      const feito = await responderPergunta(this.db, comercianteId, r.perguntaId, corpo, {
        limiteConfiancaItem: this.env.LIMITE_CONFIANCA_ITEM,
      });
      return feito.statusDocumento === "extraido" ? TEXTO_NOTA_CONFERIDA : TEXTO_PERGUNTA_RESOLVIDA;
    } catch (e) {
      if (!(e instanceof ErroPergunta)) throw e;
      return e.codigo === "ja_respondida" ? TEXTO_PERGUNTA_JA_RESPONDIDA : TEXTO_PERGUNTA_FALHOU;
    }
  }

  /** O produto de menor margem entre os abaixo da meta, pela mesma métrica do agente; nulo se nenhum. */
  private async maisAbaixoDaMeta(comercianteId: string): Promise<string | null> {
    const abaixo = await this.metricas.margensAbaixoDaMeta({
      comercianteId,
      dataReferencia: dataLocal(this.relogio.agora(), this.env.FUSO_HORARIO),
    });
    return abaixo[0]?.valor.nome ?? null;
  }

  private async enviarSaidas(
    comercianteId: string,
    saidas: SaidaWhatsapp[],
    chaves: string[],
    execucaoId: string | null,
  ): Promise<void> {
    for (const [i, s] of saidas.entries()) {
      const { saida, recusas } = garantirRegras(s);
      if (recusas.length)
        this.log.warn(`Mensagem fora das regras da Meta virou texto: ${recusas.join("; ")}`);
      await this.caixa.enviarResposta({ comercianteId, saida, execucaoId, chave: chaves[i]! });
    }
  }

  private executarAgente(comercianteId: string, nomeComercio: string, entrada: string) {
    return this.agente.executar({
      contexto: {
        comercianteId,
        nomeComercio,
        dataReferencia: dataLocal(this.relogio.agora(), this.env.FUSO_HORARIO),
      },
      gatilho: "mensagem_dono",
      entrada,
    });
  }

  private async buscarDono(comercianteId: string): Promise<{ nome: string }> {
    const [dono] = await this.db
      .select({ nome: comerciante.nome })
      .from(comerciante)
      .where(eq(comerciante.id, comercianteId))
      .limit(1);
    if (!dono) throw new NotFoundException("Comerciante não encontrado");
    return dono;
  }

  private async temConfirmacaoPendente(comercianteId: string): Promise<boolean> {
    const [p] = await this.db
      .select({ id: perguntaDono.id })
      .from(perguntaDono)
      .where(
        and(
          eq(perguntaDono.comercianteId, comercianteId),
          eq(perguntaDono.tipo, "confirmar_acao"),
          eq(perguntaDono.status, "pendente"),
        ),
      )
      .limit(1);
    return p !== undefined;
  }

  private async aguardarResposta(comercianteId: string, chave: string): Promise<MensagemGravada | undefined> {
    const limite = Date.now() + this.env.LLM_TIMEOUT_MS + ESPERA_FOLGA_MS;
    for (;;) {
      const gravada = await this.caixa.buscarPorChave(comercianteId, chave);
      if (gravada || Date.now() >= limite) return gravada;
      await new Promise((r) => setTimeout(r, INTERVALO_ESPERA_MS));
    }
  }

  /**
   * Aviso de que a nota chegou, sem números: não passa pelo agente. Com `pelaConversa` (front do
   * WhatsApp), a mensagem do dono é a foto ou o documento com o id que o canal deu a ela. Nota que já
   * estava no histórico (mesmo arquivo) não é lida de novo: o dono recebe a leitura guardada.
   */
  async avisarNotaRecebida(
    comercianteId: string,
    documentoId: string,
    pelaConversa?: NotaPelaConversa & { duplicado: boolean },
  ): Promise<MensagemGravada> {
    const [doc] = await this.db
      .select({ tipo: documento.tipo })
      .from(documento)
      .where(and(eq(documento.id, documentoId), eq(documento.comercianteId, comercianteId)))
      .limit(1);
    const xml = doc?.tipo === "nfe";
    const idExterno = pelaConversa?.idExterno ?? `nota-${documentoId}`;
    const recebida = await this.caixa.registrarRecebida({
      comercianteId,
      idExterno,
      texto: pelaConversa?.legenda ?? (xml ? "XML de nota enviado" : "Foto de nota enviada"),
      ...(pelaConversa && {
        tipo: xml ? "document" : "image",
        conteudo: {
          id: documentoId,
          ...(pelaConversa.mimeType && { mime_type: pelaConversa.mimeType }),
          ...(pelaConversa.legenda && { caption: pelaConversa.legenda }),
          ...(xml && { filename: pelaConversa.nomeArquivo ?? "nota.xml" }),
        },
      }),
    });
    if (pelaConversa) await this.caixa.marcarStatus(comercianteId, recebida.id, "read");

    if (pelaConversa?.duplicado && recebida.nova) {
      const repetida = await this.avisarNotaLida(comercianteId, documentoId, `nota_repetida_${idExterno}`);
      if (repetida) return repetida;
    }
    const chave = `nota_${documentoId}`;
    await this.caixa.enviarResposta({
      comercianteId,
      texto: xml
        ? "Recebi o XML da nota e estou lendo. Se algum item ficar em dúvida, eu pergunto."
        : "Recebi a foto da nota e estou lendo. Se algum item ficar em dúvida, eu pergunto.",
      execucaoId: null,
      chave,
    });
    // A leitura pode ter terminado (o XML é lido na própria requisição) ou falhado antes deste aviso
    // existir; aí o worker não achou a conversa e quem avisa é aqui.
    await this.avisarFalhaExtracao(comercianteId, documentoId);
    await this.avisarNotaLida(comercianteId, documentoId);
    return (await this.caixa.buscarPorChave(comercianteId, chave))!;
  }

  /**
   * Aviso de que a nota foi lida (issue #182): fornecedor, itens e total como a ingestão gravou e
   * conferiu em código, montado sem modelo, seguido das primeiras perguntas pendentes da nota. Como o aviso de
   * falha, só sai para nota que entrou pela conversa e é idempotente (`nota_lida_<id>`); a nota
   * repetida usa a chave da mensagem que a reenviou. Devolve a mensagem da leitura.
   */
  async avisarNotaLida(
    comercianteId: string,
    documentoId: string,
    chaveRepetida?: string,
  ): Promise<MensagemGravada | undefined> {
    const [doc] = await this.db
      .select({ status: documento.statusExtracao })
      .from(documento)
      .where(and(eq(documento.id, documentoId), eq(documento.comercianteId, comercianteId)))
      .limit(1);
    if (doc?.status !== "extraido" && doc?.status !== "revisao") return undefined;
    if (!chaveRepetida && !(await this.caixa.buscarPorChave(comercianteId, `nota_${documentoId}`))) {
      return undefined;
    }
    const nota = await this.notaParaMensagem(comercianteId, documentoId, doc.status === "revisao");
    if (!nota) return undefined;

    const chave = chaveRepetida ?? `nota_lida_${documentoId}`;
    const perguntas = chaveRepetida ? [] : nota.perguntas;
    const saidas = comBotoes(
      textoNotaLida({
        ...nota.dados,
        perguntasPendentes: perguntas.length,
        repetida: Boolean(chaveRepetida),
      }),
      perguntas.length ? null : BOTOES_NOTA,
      { cabecalho: "Nota lida" },
    );
    const chaves = saidas.map((_, i) => (i === 0 ? chave : `${chave}_${i + 1}`));
    await this.enviarSaidas(comercianteId, saidas, chaves, null);
    // Cada pergunta sai com botões ou lista que levam o id dela: a resposta vai ao resolvedor, sem modelo.
    const primeiras = perguntas.slice(0, MAX_PERGUNTAS_NA_CONVERSA);
    await this.enviarSaidas(
      comercianteId,
      primeiras.map(perguntaParaSaida),
      primeiras.map((p) => `pergunta_${p.id}`),
      null,
    );
    return this.caixa.buscarPorChave(comercianteId, chave);
  }

  private async notaParaMensagem(
    comercianteId: string,
    documentoId: string,
    emRevisao: boolean,
  ): Promise<
    | {
        dados: Omit<NotaParaMensagem, "perguntasPendentes" | "repetida">;
        perguntas: PerguntaDaNota[];
      }
    | undefined
  > {
    const [c] = await this.db
      .select({
        id: compra.id,
        data: compra.data,
        total: compra.totalCentavos,
        soma: compra.somaItensCentavos,
        fornecedor: fornecedor.nome,
      })
      .from(compra)
      .innerJoin(
        fornecedor,
        and(eq(fornecedor.id, compra.fornecedorId), eq(fornecedor.comercianteId, compra.comercianteId)),
      )
      .where(and(eq(compra.comercianteId, comercianteId), eq(compra.documentoId, documentoId)))
      .limit(1);
    if (!c) return undefined;
    const itens = await this.db
      .select({
        id: itemDeCompra.id,
        descricao: itemDeCompra.descricaoNota,
        quantidade: itemDeCompra.quantidade,
        valorUnitarioCentavos: itemDeCompra.valorUnitarioCentavos,
        valorTotalCentavos: itemDeCompra.valorTotalCentavos,
      })
      .from(itemDeCompra)
      .where(and(eq(itemDeCompra.comercianteId, comercianteId), eq(itemDeCompra.compraId, c.id)))
      .orderBy(asc(itemDeCompra.ordem));
    const idsItens = itens.map((i) => i.id);
    const perguntas = await this.db
      .select({
        id: perguntaDono.id,
        tipo: perguntaDono.tipo,
        pergunta: perguntaDono.pergunta,
        contexto: perguntaDono.contexto,
      })
      .from(perguntaDono)
      .where(
        and(
          eq(perguntaDono.comercianteId, comercianteId),
          eq(perguntaDono.status, "pendente"),
          or(
            idsItens.length ? inArray(perguntaDono.itemDeCompraId, idsItens) : sql`false`,
            sql`${perguntaDono.contexto}->>'documento_id' = ${documentoId}`,
          ),
        ),
      )
      .orderBy(asc(perguntaDono.criadoEm));
    return {
      dados: {
        fornecedor: c.fornecedor,
        data: c.data,
        totalCentavos: Number(c.total),
        somaItensCentavos: Number(c.soma),
        emRevisao,
        itens: itens.map((i) => ({
          descricao: i.descricao,
          quantidade: String(i.quantidade),
          valorUnitarioCentavos: Number(i.valorUnitarioCentavos),
          valorTotalCentavos: Number(i.valorTotalCentavos),
        })),
      },
      perguntas,
    };
  }

  /**
   * Aviso de que a leitura da nota falhou de vez. É resposta ao envio do dono, não mensagem proativa
   * (regra 9): só sai quando a nota entrou pela conversa (existe o aviso `nota_<id>`); nota enviada por
   * `POST /documentos/notas` não tem conversa a responder. Só avisa documento em `falha` (o worker
   * também chama em job repetido). Idempotente pela chave `nota_falha_<id>`.
   */
  async avisarFalhaExtracao(
    comercianteId: string,
    documentoId: string,
  ): Promise<MensagemGravada | undefined> {
    const [doc] = await this.db
      .select({ status: documento.statusExtracao })
      .from(documento)
      .where(and(eq(documento.id, documentoId), eq(documento.comercianteId, comercianteId)))
      .limit(1);
    if (doc?.status !== "falha") return undefined;
    const pelaConversa = await this.caixa.buscarPorChave(comercianteId, `nota_${documentoId}`);
    if (!pelaConversa) return undefined;
    const chave = `nota_falha_${documentoId}`;
    await this.caixa.enviarResposta({ comercianteId, texto: TEXTO_FALHA_NOTA, execucaoId: null, chave });
    return this.caixa.buscarPorChave(comercianteId, chave);
  }
}
