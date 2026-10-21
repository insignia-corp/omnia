import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ComercianteDaSessao, SessaoGuard } from "../comerciante/sessao";
import { DocumentosService } from "./documentos.service";

@Controller("documentos")
@UseGuards(SessaoGuard)
export class DocumentosController {
  constructor(private readonly documentos: DocumentosService) {}

  /** Recebe a foto de uma nota (campo `arquivo`), com extração em segundo plano, ou o XML da NF-e, lido na hora. */
  @Post("notas")
  @HttpCode(202)
  @UseInterceptors(FileInterceptor("arquivo"))
  async enviarNota(
    @ComercianteDaSessao() comercianteId: string,
    @UploadedFile() arquivo: { buffer: Buffer } | undefined,
  ) {
    if (!arquivo) throw new BadRequestException("Envie a foto ou o XML da NF-e no campo `arquivo`");
    const r = await this.documentos.receberNota(comercianteId, arquivo.buffer);
    return { documento_id: r.documentoId, status: r.status, duplicado: r.duplicado };
  }

  @Get(":id")
  obter(@ComercianteDaSessao() comercianteId: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.documentos.obter(comercianteId, id);
  }
}
