import { Controller, Get, Header } from "@nestjs/common";
import { PAGINA_BASTIDORES } from "./pagina-bastidores";

/** Serve a página dos bastidores. Sem guard: a identidade é conferida em `/bastidores/painel`. */
@Controller("bastidores")
export class PaginaBastidoresController {
  @Get()
  @Header("Content-Type", "text/html; charset=utf-8")
  pagina(): string {
    return PAGINA_BASTIDORES;
  }
}
