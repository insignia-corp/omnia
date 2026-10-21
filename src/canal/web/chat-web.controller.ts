import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { z } from "zod";
import { ComercianteDaSessao, SessaoGuard } from "../../comerciante/sessao";
import { DocumentosService } from "../../ingestao/documentos.service";
import { CaixaMensagens, type MensagemGravada } from "../caixa-mensagens";
import { ConversaService } from "../conversa.service";

const entradaMensagem = z.strictObject({
  id_externo: z.uuid(),
  texto: z.string().trim().min(1).max(2000),
});

const paraApi = (m: MensagemGravada) => ({
  id: m.id,
  direcao: m.direcao,
  texto: m.texto,
  proativa: m.proativa,
  criada_em: m.criadaEm,
});

/** API do chat web (issues #66 e #63). O comerciante vem só da sessão. */
@Controller("chat")
@UseGuards(SessaoGuard)
export class ChatWebController {
  constructor(
    private readonly conversa: ConversaService,
    private readonly caixa: CaixaMensagens,
    private readonly documentos: DocumentosService,
  ) {}

  /** Texto do dono; devolve a resposta do agente. Repetir o `id_externo` não roda o agente de novo. */
  @Post("mensagens")
  @HttpCode(200)
  async enviar(@ComercianteDaSessao() comercianteId: string, @Body() corpo: unknown) {
    const entrada = entradaMensagem.safeParse(corpo);
    if (!entrada.success) throw new BadRequestException("Informe `id_externo` (uuid) e `texto` (1 a 2000)");
    const resposta = await this.conversa.tratar(comercianteId, entrada.data.id_externo, entrada.data.texto);
    return paraApi(resposta);
  }

  /** Foto de nota (campo `arquivo`): segue o fluxo de ingestão e avisa o dono no chat. */
  @Post("notas")
  @HttpCode(202)
  @UseInterceptors(FileInterceptor("arquivo"))
  async enviarNota(
    @ComercianteDaSessao() comercianteId: string,
    @UploadedFile() arquivo: { buffer: Buffer } | undefined,
  ) {
    if (!arquivo) throw new BadRequestException("Envie a foto no campo `arquivo`");
    const r = await this.documentos.receberNota(comercianteId, arquivo.buffer);
    const aviso = await this.conversa.avisarNotaRecebida(comercianteId, r.documentoId);
    return {
      documento_id: r.documentoId,
      status: r.status,
      duplicado: r.duplicado,
      mensagem: paraApi(aviso),
    };
  }

  /** Últimas mensagens, da mais antiga para a mais nova (o navegador consulta de tempos em tempos). */
  @Get("mensagens")
  async listar(@ComercianteDaSessao() comercianteId: string, @Query("limite") limite?: string) {
    const n = Math.min(Math.max(Number.parseInt(limite ?? "50", 10) || 50, 1), 200);
    return (await this.caixa.listar(comercianteId, n)).map(paraApi);
  }
}
