import {
  BadRequestException,
  Body,
  Controller,
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
import { PlanilhasService } from "./planilhas.service";

@Controller("documentos/planilhas")
@UseGuards(SessaoGuard)
export class PlanilhasController {
  constructor(private readonly planilhas: PlanilhasService) {}

  /**
   * Recebe a planilha de vendas (campo `arquivo`, CSV ou XLSX). Com mapeamento já confirmado para
   * o formato, importa na hora; senão devolve `precisa_confirmar` com a sugestão de colunas.
   */
  @Post()
  @HttpCode(200)
  @UseInterceptors(FileInterceptor("arquivo"))
  enviar(
    @ComercianteDaSessao() comercianteId: string,
    @UploadedFile() arquivo: { buffer: Buffer } | undefined,
  ) {
    if (!arquivo) throw new BadRequestException("Envie a planilha no campo `arquivo`");
    return this.planilhas.receber(comercianteId, arquivo.buffer);
  }

  /** `{ "mapeamento": { "data": "Data", "produto": "Produto", ... } }`, com os nomes exatos das colunas. */
  @Post(":id/confirmar")
  @HttpCode(200)
  confirmar(
    @ComercianteDaSessao() comercianteId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() corpo: unknown,
  ) {
    return this.planilhas.confirmar(comercianteId, id, corpo);
  }
}
