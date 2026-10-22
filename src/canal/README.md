# Canal (plano C)

Fala com o dono. O agente e as ferramentas só conhecem `MessageChannel` (`message-channel.ts`); a implementação vem de `CANAL` no `.env` (`criar-canal.ts`). `web` é o padrão; `whatsapp` ainda lança erro claro (#61, #62).

- `CaixaMensagens`: único dono das escritas em `mensagem`. Grava a linha antes de enviar, e as restrições do banco (chave de idempotência, uma proativa por dia, id externo) decidem quem envia. O canal só transporta.
- `ConversaService`: mensagem do dono entra, o agente responde (`PORTA_AGENTE`), a resposta sai. Reentrega do mesmo `id_externo` não roda o agente de novo. Também avisa o dono quando a leitura de uma nota enviada pelo chat falha de vez (#158): resposta fixa, sem número, idempotente pela chave `nota_falha_<id>`, nunca mensagem proativa.
- Chat web (#66): `GET /chat` (página), `POST /chat/mensagens`, `POST /chat/notas`, `GET /chat/mensagens`. Identidade pelo `X-Comerciante-Id` conferido no banco (provisório, ver `src/comerciante/sessao.ts`).
- WhatsApp simulado para o pitch (#179): front estático em `web/whatsapp/` com as regras da Cloud API e modo demonstração; ainda não chama estas rotas. Contrato e regras em `web/whatsapp/README.md`.
- Relatório diário (#64, regra 9): `jobs/`. Agendador BullMQ (`RELATORIO_DIARIO_CRON`, `FUSO_HORARIO`) cria um job por comerciante com `jobId` = `relatorio_<comerciante>_<data>`. Em horário de silêncio (`SILENCIO_INICIO`, `SILENCIO_FIM`) o job é adiado para o fim da janela. O texto vem do agente com a entrada de `FONTE_RELATORIO`, que o plano A troca quando o resumo diário (#40) existir.

- Bastidores (#77): `GET /bastidores` (página) e `GET /bastidores/painel` (execuções com chamadas de ferramenta em ordem, verificador, última nota com confiança por item, candidatos a alerta). Atualiza por polling a cada 3 s, sem estado no processo. Os candidatos a alerta vêm de `FONTE_DECISOES_ALERTA` (padrão: tabela `alerta`, que os planos A e B preenchem).
- Reset da demo (#76): `npm run demo:reset` (`scripts/demo`). Com `DEMO_DATA_REFERENCIA=AAAA-MM-DD` no `.env`, o relógio do canal usa essa data (e a hora real), então a conversa e o relatório diário olham o período dos dados de teste, que terminam em 2026-10-19. Recusado em produção.

Testes: unitários em `src/canal`, e2e em `tests/canal` e `tests/demo` (`npm run test:e2e -- tests/canal tests/demo`).
