import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ComercianteDaSessao, SessaoGuard } from "../../comerciante/sessao";
import { CONSULTA_EXECUCOES, type ConsultaExecucoes } from "./consulta-execucoes";

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Leitura do registro de execuções para a tela de bastidores (#77) e para o acompanhamento
 * da degradação do verificador. O comerciante vem da sessão, nunca do pedido.
 */
@Controller("execucoes")
@UseGuards(SessaoGuard)
export class ExecucoesController {
  constructor(@Inject(CONSULTA_EXECUCOES) private readonly consulta: ConsultaExecucoes) {}

  @Get()
  listar(
    @ComercianteDaSessao() comercianteId: string,
    @Query("limite", new ParseIntPipe({ optional: true })) limite?: number,
  ) {
    return this.consulta.listar(comercianteId, limite === undefined ? {} : { limite });
  }

  /** Taxa de bloqueio do verificador por dia, de `de` a `ate` (AAAA-MM-DD, inclusive). */
  @Get("verificador/bloqueios")
  bloqueios(
    @ComercianteDaSessao() comercianteId: string,
    @Query("de") de?: string,
    @Query("ate") ate?: string,
  ) {
    if (!de || !ate || !DATA_ISO.test(de) || !DATA_ISO.test(ate) || de > ate) {
      throw new BadRequestException("Informe `de` e `ate` no formato AAAA-MM-DD, com de <= ate");
    }
    return this.consulta.bloqueioPorDia(comercianteId, { de, ate });
  }

  /** Execução com as chamadas de ferramenta em ordem. */
  @Get(":id")
  async detalhe(@ComercianteDaSessao() comercianteId: string, @Param("id", ParseUUIDPipe) id: string) {
    const execucao = await this.consulta.buscar(comercianteId, id);
    if (!execucao) throw new NotFoundException("Execução não encontrada");
    return execucao;
  }
}
