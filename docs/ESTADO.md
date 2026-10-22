# ESTADO: você está aqui

Fonte única do estado atual. Atualizado por `/checkpoint`. Só números datados e com o comando que os gerou; método e decisões moram nos docs-dono (ver [README](README.md)).

Atualizado em: 2026-10-21 · commit base: `d62d2a7` (`develop` após o PR 169) · branch `docs/estado-checkpoint-2`

## Etapa

- Etapa 0 (base): feita. A CI também confere variáveis de ambiente contra `.env.example`, deriva das migrações e `comerciante_id` em toda tabela (guardas no `.github/workflows/ci.yml`, PR 152). Id de correlação entre requisição e jobs nos logs (#10). Resta ligar a CI como status obrigatório na proteção das branches (#7).
- Etapa 1 (dados de teste e gabarito): feita. Falta só a revisão do gabarito de métricas por uma segunda pessoa (#16). Detalhe em `fixtures/README.md`.
- Etapa 2 (ingestão): na `develop`, armazenamento, upload e fila BullMQ, Extrator com Zod, validações em código, revisão de item e pergunta ao dono, vínculo por catálogo, similaridade, código de barras e sugestão do modelo confirmada pelo dono (#27), planilha de vendas CSV e XLSX (#28) e NF-e em XML (#29). Falta a integração Pluggy em sandbox (#30, P2, adiada: só entra se sobrar tempo; o que está fora do escopo é o Open Finance real), e o fluxo de resolução de importação parcial de planilha (#142). Detalhe em `src/ingestao/README.md`.
- Etapa 3 (métricas): feita, com o épico #31 fechado. Margem, variação de custo, giro, resumo diário, ticket médio, gasto fora do padrão, estoque parado e espaço para subir preço batem com o gabarito, e o conjunto de alertas esperados também (#41). Débitos em #143 (extrato por conta), #144 (propagar origem e confiança do produto) e #148 (critério de receita). Detalhe em `src/metricas/README.md`.
- Etapa 4 (motor de alertas): o motor de regras com prioridade e supressão está na `develop` (#43 e #44, fechadas; PR 153). O job de reajuste e o teste de detecção (#45, #46) e `list_alert_candidates` (#52) não começaram. Abertas: limites configuráveis por comerciante (#147), status `enviado` e `descartado` do alerta (#155) e candidato do dia que fica velho (#157).
- Etapa 5 (agente): na `develop`, núcleo, verificador, registro de execuções, loop diário e modo conversa (#55, fechada), `ask_owner`, `save_owner_answer`, `propose_target_price` e `select_alerts` (o envio não é ferramenta: o `AgenteService` devolve o texto verificado e o `MessageChannel` entrega), ação com confirmação do dono e preço-meta (#104), as ferramentas de leitura `get_daily_summary`, `get_top_products`, `get_product_margin` e `get_cost_changes` (#50, #51, #149 e #156, fechadas; PRs 145, 160 e 168). Falta `list_alert_candidates` (#52, não começou). Critério `receita` em `get_top_products` e receita por produto (#148, fechada; PR 169).
- Etapa 6 (canal): na `develop`, `MessageChannel`, chat web como plano B, escolha por `CANAL`, job do relatório diário com chave de idempotência e horário de silêncio (#64, #66, #106); o ciclo completo com modelo real depende de #52 e #45 (ver Pendências). WhatsApp (#59 a #63) e áudio (#107) não começaram.
- Etapa 7 (avaliação): o harness `npm run eval` existe (#68) e a rodada com modelo falso tem 50 casos: perguntas numéricas, casos do verificador, perguntas sem resposta e injeção de instrução (#69, #70, #72 e #73, fechadas). A avaliação da extração de notas tem runner próprio, `npm run eval:extracao` (#71, fechada). Falta custo e tempo por execução (#74).
- Etapa 8 (demo): dataset fixo com reset em um comando (#76) e tela de bastidores (#77) na `develop`. Faltam roteiro, gravação e checklist de congelamento (#78, #79, #111).
- Próxima ação: `list_alert_candidates` (#52) e o job de reajuste (#45, #46) sobre o motor que já está na `develop`; gravar os status do alerta (#155) e os limites por comerciante (#147); o aviso de falha da extração (PR 163); o extrato por data de sincronização (#166). Fila atual: `gh issue list --label prioridade:P0 --state open`.

## Números vigentes

Gerados em 2026-10-21 sobre a `develop` em `d62d2a7`, com Node 24 (via `npx`), PostgreSQL 18 e Redis 8 descartáveis.

| O quê | Valor | Gerado por | Em |
| --- | --- | --- | --- |
| Testes unitários | 970 passam em 67 suítes | `npm test` (Node 24) | 2026-10-21 |
| Testes e2e | 433 passam em 29 suítes (PostgreSQL e Redis reais, cliente de visão e modelo falsos) | `npm run test:e2e` (Node 24) | 2026-10-21 |
| Lint | 0 erros | `npm run lint` | 2026-10-21 |
| Typecheck | 0 erros | `npm run typecheck` | 2026-10-21 |
| Build | passa | `npm run build` | 2026-10-21 |
| Eval (modelo falso, prompt `sistema-v2`) | 50 de 50 casos passam (numéricas, verificador, sem resposta e injeção); relatório em `docs/avaliacoes/2026-10-21-sistema-v2-falso.md` | `npm run seed:demo` e `npm run eval` | 2026-10-21 |
| Vínculo nota-produto sem perguntar | 97,9% (92 de 94 itens das 18 notas), 0 ligações erradas. O e2e `tests/vinculo-notas` (94 itens, 0 ligações erradas, pelo menos 90% sem perguntar) faz parte dos 433 e reconfirmou essas condições em 2026-10-21; só o 97,9% exato não foi medido de novo | `npm run test:e2e -- tests/vinculo` | 2026-10-20 |

## Em PR aberto

- PR 163: aviso ao dono quando a leitura da nota falha de vez (#158) e id de correlação entre requisição e jobs (#10).
- PR 164: `get_product_margin` resolve produtos de mesmo nome e usa descrições confirmadas (#156).
- PR 165: modelo padrão do agente passa a `claude-sonnet-5-5`.
- PR 171: este checkpoint.

## Pendências

- Eval com modelo real ainda não rodou (`npm run eval -- --modelo real` exige `ANTHROPIC_API_KEY`); custo e latência da decisão 0003 seguem estimativas até lá, e a troca do modelo padrão `claude-opus-5-5` por Sonnet (decisão 0002) depende dele; o PR 165 faz a troca para `claude-sonnet-5-5`.
- A chamada real ao modelo com visão (`cliente-visao-anthropic.ts`) não foi exercida: sem chave no ambiente. Primeiro uso: enviar 3 fotos de `fixtures/notas/` e conferir `execucao_agente`.
- Extração de nota que falha não avisa o dono: `ProcessadorExtracao.falhar` só grava `documento.statusExtracao` e `erro` e registra a execução, e o `ConversaService` envia só o aviso inicial de leitura. Fica pendente até o worker enviar a mensagem fixa de falha (#158, em PR 163; detalhe em `src/ingestao/README.md`).
- O relatório diário com modelo real ainda não fecha na `develop`: o `AgenteService` exige um `select_alerts` bem-sucedido ou um `list_alert_candidates` sem candidato, o catálogo real não tem `list_alert_candidates` (#52) e nada chama o motor de alertas, que já está na `develop`, até #45 e #52, então um relatório real termina no fallback de erro. Só os testes usam dublês.
- Alertas: o candidato do dia pode ficar velho quando o dado muda (#157). Higiene de documentação (`send_message`, status de PRs, label do Pluggy) em #159.
- A CLI do eval e a rodada usam por padrão o prompt `sistema-v2`, e o `AgenteModule` carrega o `v3`: alinhar antes da primeira rodada com `--modelo real`.
- O alerta ainda não grava os status `enviado` e `descartado`, então a supressão por status não funciona de ponta a ponta (#155).
- `get_product_margin`: a descrição de nota deve seguir o mesmo critério da busca por nome (#167).
- Planilha importada com linha rejeitada fica em `revisao` e as vendas dela entram nas métricas com confiança 0,5 sem caminho para voltar (#142).
- O extrato de uma conta vale até a última transação importada (a cobertura por conta e a origem do produto nas métricas entraram no PR 170, #143 e #144 fechadas): uma conta ativa parada ou sem transação deixa o dia sem total de gastos até haver data da última sincronização (#166).
- A exclusão em cascata de um comerciante com a planilha da demo importada (cerca de 15 mil linhas) leva cerca de 6 s; considerar ao implementar a exclusão LGPD (#85).
- Ambiente: `npm test` e `npm run test:e2e` exigem Node 24 (a CI usa 24); no Node 22 as suítes que carregam o Nest não rodam. Banco que já aplicou a migração com a numeração antiga (`0004_ingestao`) precisa ser recriado (`npm run db:reset`).
- Identidade do comerciante nas rotas HTTP é o cabeçalho `X-Comerciante-Id` conferido no banco (`src/comerciante/sessao.ts`), provisório até o canal autenticar.
- Nem `develop` nem `main` têm proteção de branch com a CI como status obrigatório (#7).
- Decisão 0003 (arquitetura do agente) está como proposta.

## Linha do tempo

- 2026-10-19: Etapa 0 e núcleo do agente.
- 2026-10-20: modelo de dados e seed (#120), Etapa 1 integrada (#119), AGENTS.md, especificação dos agentes e ecossistema de contexto.
- 2026-10-20: Etapa 2, PRs 122 a 124: armazenamento, upload com fila, Extrator, validações, perguntas ao dono, vínculo e planilha de vendas. Detalhe em `src/ingestao/README.md`.
- 2026-10-20: divisão técnica em 3 planos (PR 128). Ticket médio, gasto fora do padrão, estoque parado e espaço para subir preço (PR 127).
- 2026-10-21: Etapa 3 completa (PRs 126 e 146): métricas, correções do Codex e regressão contra o gabarito. Canal com chat web (PR 129), registro de execuções e retentativas (PR 131), `ask_owner` e `save_owner_answer` (PR 132), loop diário e modo conversa (PR 133), reset da demo e bastidores (PR 134), NF-e em XML (PR 136), vínculo por código de barras e sugestão do modelo (PR 137), harness de avaliação (PR 138), ação com confirmação do dono (PR 141). Também mesclados: ponto de encaixe do catálogo e módulos vazios (PR 130), documentação do fluxo do agente (PR 135), ajuste do e2e de revisão de notas (PR 140) e correção do verificador para ignorar ids (PR 150). No fim do dia: ferramentas de leitura do agente (PRs 145 e 160), guardas de CI com a renumeração da migração `0012` para `0007` (PR 152), sobras da revisão do PR 134 (PR 154) e os casos de avaliação numéricos, do verificador e sem resposta (commit `151a03b`).
- 2026-10-21 (noite): motor de regras de alertas com prioridade e supressão (PR 153), avaliação de injeção de instrução (PR 161) e da extração de notas (PR 162), `get_product_margin` com apelidos confirmados e produtos de mesmo nome (PR 168), e este checkpoint (PR 151, versão anterior). Issues novas: #166 (extrato por data de sincronização) e #167 (descrição de nota em `get_product_margin`).
- 2026-10-21 (madrugada de 22): cobertura de extrato por conta e origem e confiança do produto nas métricas (PR 170).
- 2026-10-24 15h30: congelamento do código.
