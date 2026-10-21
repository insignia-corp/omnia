# Canal (plano C)

Fala com o dono. O agente e as ferramentas só conhecem `MessageChannel` (`message-channel.ts`); a implementação vem de `CANAL` no `.env` (`criar-canal.ts`). `web` é o padrão; `whatsapp` ainda lança erro claro (#61, #62).

- `CaixaMensagens`: único dono das escritas em `mensagem`. Grava a linha antes de enviar, e as restrições do banco (chave de idempotência, uma proativa por dia, id externo) decidem quem envia. O canal só transporta.
- `ConversaService`: mensagem do dono entra, o agente responde (`PORTA_AGENTE`), a resposta sai. Reentrega do mesmo `id_externo` não roda o agente de novo.
- Chat web (#66): `GET /chat` (página), `POST /chat/mensagens`, `POST /chat/notas`, `GET /chat/mensagens`. Identidade pelo `X-Comerciante-Id` conferido no banco (provisório, ver `src/comerciante/sessao.ts`).
- Relatório diário (#64, regra 9): `jobs/`. Agendador BullMQ (`RELATORIO_DIARIO_CRON`, `FUSO_HORARIO`) cria um job por comerciante com `jobId` = `relatorio_<comerciante>_<data>`. Em horário de silêncio (`SILENCIO_INICIO`, `SILENCIO_FIM`) o job é adiado para o fim da janela. O texto vem do agente com a entrada de `FONTE_RELATORIO`, que o plano A troca quando o resumo diário (#40) existir.

Testes: unitários em `src/canal`, e2e em `tests/canal` e `tests/demo` (`npm run test:e2e -- tests/canal tests/demo`).
