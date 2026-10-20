import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { ComercianteDaSessao, SessaoGuard } from "../comerciante/sessao";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { DB, type Db } from "../infra/database/database.module";
import { perguntaDono } from "../infra/database/schema";
import { ErroPergunta, responderPergunta } from "./revisao/responder-pergunta";

@Controller("perguntas")
@UseGuards(SessaoGuard)
export class PerguntasController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Perguntas que o agente fez ao dono e ainda esperam resposta. */
  @Get()
  async pendentes(@ComercianteDaSessao() comercianteId: string) {
    const linhas = await this.db
      .select()
      .from(perguntaDono)
      .where(and(eq(perguntaDono.comercianteId, comercianteId), eq(perguntaDono.status, "pendente")))
      .orderBy(asc(perguntaDono.criadoEm));
    return linhas.map((p) => ({
      id: p.id,
      tipo: p.tipo,
      pergunta: p.pergunta,
      contexto: p.contexto,
      item_de_compra_id: p.itemDeCompraId,
      criada_em: p.criadoEm,
    }));
  }

  /**
   * Resposta estruturada: `{ valor_unitario_centavos, quantidade? }` para item duvidoso e
   * `{ produto_id }` para vínculo. A interpretação de texto livre do dono é do agente (#53).
   */
  @Post(":id/resposta")
  @HttpCode(200)
  async responder(
    @ComercianteDaSessao() comercianteId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() corpo: unknown,
  ) {
    try {
      const r = await responderPergunta(this.db, comercianteId, id, corpo, {
        limiteConfiancaItem: this.env.LIMITE_CONFIANCA_ITEM,
      });
      return {
        pergunta_id: r.perguntaId,
        tipo: r.tipo,
        status_documento: r.statusDocumento ?? null,
        itens_ligados: r.itensLigados,
      };
    } catch (e) {
      if (!(e instanceof ErroPergunta)) throw e;
      if (e.codigo === "nao_encontrada") throw new NotFoundException(e.message);
      if (e.codigo === "ja_respondida") throw new ConflictException(e.message);
      throw new BadRequestException(e.message);
    }
  }
}
