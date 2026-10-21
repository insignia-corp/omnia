import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ComercianteDaSessao, SessaoGuard } from "../../comerciante/sessao";
import { BastidoresService } from "../bastidores/bastidores.service";

/** Dados da tela de bastidores (issue #77). Só leitura, só do comerciante da sessão. */
@Controller("bastidores")
@UseGuards(SessaoGuard)
export class BastidoresController {
  constructor(private readonly bastidores: BastidoresService) {}

  @Get("painel")
  painel(@ComercianteDaSessao() comercianteId: string, @Query("limite") limite?: string) {
    const n = Math.min(Math.max(Number.parseInt(limite ?? "10", 10) || 10, 1), 50);
    return this.bastidores.painel(comercianteId, n);
  }
}
