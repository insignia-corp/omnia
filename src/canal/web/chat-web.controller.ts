import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { z } from "zod";
import { ComercianteDaSessao, SessaoGuard } from "../../comerciante/sessao";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { DocumentosService } from "../../ingestao/documentos.service";
import { CaixaMensagens, type MensagemGravada } from "../caixa-mensagens";
import { ConversaService } from "../conversa.service";
import { RelatorioDiarioService } from "../jobs/relatorio-diario.service";
import { dataLocal, RELOGIO, type Relogio } from "../relogio";
import { entradaWhatsapp, ID_MENSAGEM } from "../whatsapp/entrada";
import { paraWhatsapp } from "../whatsapp/formato";
import { LIMITES_META } from "../whatsapp/regras-meta";

const entradaMensagem = z.strictObject({
  id_externo: z.uuid(),
  texto: z.string().trim().min(1).max(LIMITES_META.texto),
});

/** Campos de texto que acompanham a foto quando ela vem do front do WhatsApp (multipart). */
const entradaNota = z.strictObject({
  id: ID_MENSAGEM.optional(),
  legenda: z.string().trim().max(LIMITES_META.legenda).optional(),
  nome_arquivo: z.string().trim().max(255).optional(),
});

const paraApi = (m: MensagemGravada) => ({
  id: m.id,
  direcao: m.direcao,
  texto: m.texto,
  proativa: m.proativa,
  criada_em: m.criadaEm,
});

const MENSAGENS_PROATIVA: Record<string, string | null> = {
  enviada: null,
  duplicada: "O Omnia manda no máximo 1 mensagem proativa por dia.",
  ja_enviada_hoje: "O Omnia manda no máximo 1 mensagem proativa por dia.",
  silencio: "Agora é horário de silêncio: o resumo sai no fim dele.",
  sem_dados: "Faltam vendas importadas para montar o resumo do dia.",
  sem_comerciante: "Comerciante não encontrado.",
};

/**
 * API do chat (issues #66, #63 e #182). O comerciante vem só da sessão. As rotas falam dois formatos:
 * o do chat web antigo (`/chat`, texto puro) e o da Cloud API, usado pelo front do WhatsApp simulado
 * (`/whatsapp`): mensagem no formato do webhook na entrada e `?formato=whatsapp` na leitura.
 */
@Controller("chat")
@UseGuards(SessaoGuard)
export class ChatWebController {
  constructor(
    private readonly conversa: ConversaService,
    private readonly caixa: CaixaMensagens,
    private readonly documentos: DocumentosService,
    private readonly relatorio: RelatorioDiarioService,
    @Inject(ENV) private readonly env: Env,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /**
   * Mensagem do dono. Chat web antigo: `{ id_externo, texto }`, devolve a resposta do agente. Front do
   * WhatsApp: o objeto `messages[]` do webhook (texto, botão ou linha de lista), devolve
   * `{ mensagens }` com a do dono (e o status dela) e as respostas. Repetir o id não roda o agente de novo.
   */
  @Post("mensagens")
  @HttpCode(200)
  async enviar(@ComercianteDaSessao() comercianteId: string, @Body() corpo: unknown) {
    const whatsapp = entradaWhatsapp.safeParse(corpo);
    if (whatsapp.success) {
      const mensagens = await this.conversa.tratarWhatsapp(comercianteId, whatsapp.data);
      return { mensagens: mensagens.map(paraWhatsapp) };
    }
    const entrada = entradaMensagem.safeParse(corpo);
    if (!entrada.success) {
      throw new BadRequestException(
        `Informe \`id_externo\` (uuid) e \`texto\` (1 a ${LIMITES_META.texto}), ou uma mensagem no formato do webhook da Cloud API`,
      );
    }
    const resposta = await this.conversa.tratar(comercianteId, entrada.data.id_externo, entrada.data.texto);
    return paraApi(resposta);
  }

  /**
   * Foto ou XML de nota (campo `arquivo`): segue o fluxo de ingestão e avisa o dono no chat. Com `id`
   * (front do WhatsApp), a mensagem do dono leva esse id, a legenda e o nome do arquivo, e a resposta
   * traz `mensagens` no formato da Cloud API.
   */
  @Post("notas")
  @HttpCode(202)
  @UseInterceptors(FileInterceptor("arquivo"))
  async enviarNota(
    @ComercianteDaSessao() comercianteId: string,
    @UploadedFile() arquivo: { buffer: Buffer; mimetype?: string; originalname?: string } | undefined,
    @Body() corpo: unknown,
  ) {
    if (!arquivo) throw new BadRequestException("Envie a foto no campo `arquivo`");
    const campos = entradaNota.safeParse(corpo ?? {});
    if (!campos.success) throw new BadRequestException("Campos `id`, `legenda` ou `nome_arquivo` inválidos");
    const r = await this.documentos.receberNota(comercianteId, arquivo.buffer);
    const { id, legenda, nome_arquivo } = campos.data;
    const aviso = await this.conversa.avisarNotaRecebida(
      comercianteId,
      r.documentoId,
      id
        ? {
            idExterno: id,
            duplicado: r.duplicado,
            ...(legenda && { legenda }),
            ...((nome_arquivo ?? arquivo.originalname) && {
              nomeArquivo: nome_arquivo ?? arquivo.originalname,
            }),
            ...(arquivo.mimetype && { mimeType: arquivo.mimetype }),
          }
        : undefined,
    );
    const base = { documento_id: r.documentoId, status: r.status, duplicado: r.duplicado };
    if (!id) return { ...base, mensagem: paraApi(aviso) };
    const doDono = await this.caixa.buscarRecebida(comercianteId, id);
    const posteriores = (await this.caixa.listar(comercianteId, 20)).filter(
      (m) => m.direcao === "enviada" && doDono && m.criadaEm >= doDono.criadaEm,
    );
    return { ...base, mensagens: [doDono, ...posteriores].filter((m) => m !== undefined).map(paraWhatsapp) };
  }

  /** O arquivo de uma nota enviada, para a conversa mostrar a foto de novo depois de recarregar. */
  @Get("notas/:documentoId/arquivo")
  async arquivoDaNota(
    @ComercianteDaSessao() comercianteId: string,
    @Param("documentoId", new ParseUUIDPipe()) documentoId: string,
    @Res() res: Response,
  ) {
    const { conteudo, mime } = await this.documentos.arquivo(comercianteId, documentoId);
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "private, max-age=3600");
    // O arquivo é do dono, mas nunca roda como página: um XML com script não executa nesta origem.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    if (!mime.startsWith("image/")) res.setHeader("Content-Disposition", "attachment");
    res.send(conteudo);
  }

  /**
   * Últimas mensagens, da mais antiga para a mais nova (o navegador consulta de tempos em tempos). Com
   * `?formato=whatsapp`: `{ mensagens, digitando, janela_aberta }`, tudo calculado do banco.
   */
  @Get("mensagens")
  async listar(
    @ComercianteDaSessao() comercianteId: string,
    @Query("limite") limite?: string,
    @Query("formato") formato?: string,
  ) {
    const n = Math.min(Math.max(Number.parseInt(limite ?? "50", 10) || 50, 1), 200);
    const mensagens = await this.caixa.listar(comercianteId, n);
    if (formato !== "whatsapp") return mensagens.map(paraApi);
    const [digitando, janelaAberta] = await Promise.all([
      this.conversa.digitando(comercianteId),
      this.caixa.janelaAberta(comercianteId),
    ]);
    return { mensagens: mensagens.map(paraWhatsapp), digitando, janela_aberta: janelaAberta };
  }

  /**
   * Roda agora o relatório diário do comerciante da sessão (o "resumo das 7h" do pitch). É o mesmo
   * serviço do job: chave comerciante + data e no máximo uma mensagem proativa por dia (regra 9).
   */
  @Post("proativa")
  @HttpCode(200)
  async proativa(@ComercianteDaSessao() comercianteId: string) {
    const data = dataLocal(this.relogio.agora(), this.env.FUSO_HORARIO);
    const resultado = await this.relatorio.processar({ comercianteId, data });
    return { resultado, aviso: MENSAGENS_PROATIVA[resultado] ?? null };
  }
}
