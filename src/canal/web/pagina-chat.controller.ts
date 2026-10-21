import { Controller, Get, Header } from "@nestjs/common";
import { PAGINA_CHAT } from "./pagina-chat";

/** Serve a página do chat. Sem guard: a identidade é conferida nas rotas `/chat/*` que ela chama. */
@Controller("chat")
export class PaginaChatController {
  @Get()
  @Header("Content-Type", "text/html; charset=utf-8")
  pagina(): string {
    return PAGINA_CHAT;
  }
}
