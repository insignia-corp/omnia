import { Controller, Get, Header, UseGuards } from "@nestjs/common";
import { ComercianteDaSessao, SessaoGuard } from "../../comerciante/sessao";
import { PAGINA_PAINEL } from "./pagina-painel";
import { PainelService } from "./painel.service";

/**
 * Painel do dono (issue #182): `GET /painel` (página, sem guard, como a do chat) e `GET /painel/dados`
 * (números do comerciante da sessão).
 */
@Controller("painel")
export class PainelController {
  constructor(private readonly painel: PainelService) {}

  @Get()
  @Header("Content-Type", "text/html; charset=utf-8")
  pagina(): string {
    return PAGINA_PAINEL;
  }

  @Get("dados")
  @UseGuards(SessaoGuard)
  dados(@ComercianteDaSessao() comercianteId: string) {
    return this.painel.montar(comercianteId);
  }
}
