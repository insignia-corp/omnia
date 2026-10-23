# ESTADO: você está aqui

Fonte única do estado atual. Atualizado por `/checkpoint`. Só números datados e com o comando que os gerou; método e decisões moram nos docs-dono (ver [README](README.md)).

Atualizado em: 2026-10-23 · commit base: `6011fb5` (`develop` após o PR 194) · branch `docs/estado-checkpoint-23-10`

## Etapa

- Etapa 0 (base): feita. A CI também confere variáveis de ambiente contra `.env.example`, deriva das migrações e `comerciante_id` em toda tabela (guardas no `.github/workflows/ci.yml`, PR 152). Id de correlação entre requisição e jobs nos logs (#10). Resta ligar a CI como status obrigatório na proteção das branches (#7).
- Etapa 1 (dados de teste e gabarito): feita. Falta só a revisão do gabarito de métricas por uma segunda pessoa (#16). Detalhe em `fixtures/README.md`.
- Etapa 2 (ingestão): na `develop`, armazenamento, upload e fila BullMQ, Extrator com Zod, validações em código, revisão de item e pergunta ao dono, vínculo por catálogo, similaridade, código de barras e sugestão do modelo confirmada pelo dono (#27), planilha de vendas CSV e XLSX (#28) e NF-e em XML (#29). Falta a integração Pluggy em sandbox (#30, P2, adiada: só entra se sobrar tempo; o que está fora do escopo é o Open Finance real). A resolução de importação parcial de planilha entrou no PR 187 (#142, fechada). Detalhe em `src/ingestao/README.md`.
- Etapa 3 (métricas): feita, com o épico #31 fechado. Resumo da semana e do mês e o preço que leva a margem à meta entram com o #182. O extrato de uma conta vale até a data da última sincronização, e a conta ativa sem sincronização fica sem total de gastos em vez de zero (#166, PR 183). Margem, variação de custo, giro, resumo diário, ticket médio, gasto fora do padrão, estoque parado e espaço para subir preço batem com o gabarito, e o conjunto de alertas esperados também (#41). Os débitos #143 (extrato por conta), #144 (origem e confiança do produto) e #148 (critério de receita) estão fechados. Detalhe em `src/metricas/README.md`.
- Etapa 4 (motor de alertas): na `develop`, o motor de regras com prioridade e supressão (#43 e #44; PR 153), job de reajuste e teste de detecção (#45, #46), `list_alert_candidates` (#52), status final `enviado` e `descartado` (#155; PR 177), status `obsoleto` para o candidato que a correção do dono desfez (#157; PR 185) e, para o reajuste de custo, a variação da própria compra refeita em ordem estável das compras (#186; PR 191), limites de alerta por comerciante em tabela append-only (#147; PR 188) e a exceção da regra 7 para estado derivado das métricas (#172; PR 189). Menor confiança dos candidatos conferida (PR 184). Detalhe em `src/alertas/README.md`.
- Etapa 5 (agente): na `develop`, núcleo, verificador, registro de execuções, loop diário e modo conversa (#55, fechada), `ask_owner`, `save_owner_answer`, `propose_target_price` e `select_alerts` (o envio não é ferramenta: o `AgenteService` devolve o texto verificado e o `MessageChannel` entrega), ação com confirmação do dono e preço-meta (#104), as ferramentas de leitura `get_daily_summary`, `get_top_products`, `get_product_margin` e `get_cost_changes` (#50, #51, #149, #156 e #167, fechadas; PRs 145, 160, 168 e 178). `list_alert_candidates` (#52), `get_period_summary` (#182) e `list_product_margins` (lista margens sem precisar do nome; PR 194, melhoria pedida pelo dono) também. Critério `receita` em `get_top_products` e receita por produto (#148, fechada; PR 169).
- Etapa 6 (canal): na `develop`, `MessageChannel`, chat web como plano B, escolha por `CANAL`, job do relatório diário com chave de idempotência e horário de silêncio (#64, #66, #106). WhatsApp simulado para o pitch (#179, PR 181) ligado ao backend e ao banco (#182, PR 190), ambos mesclados: `/whatsapp` servido pelo Nest, status e digitando do banco, botões e lista escolhidos em código, modelo `resumo_diario` fora da janela de 24 h, nota lida na conversa e `/painel`. Resposta em texto livre mantém o histórico da conversa e uma resposta barrada abre o menu (PR 192). Detalhe em `src/canal/README.md`. A Cloud API real (#61 a #63) e áudio (#107) não começaram.
- Etapa 7 (avaliação): o harness `npm run eval` existe (#68), com perguntas numéricas, casos do verificador, perguntas sem resposta, injeção de instrução e casos de medição (#69, #70, #72, #73 e #74, fechadas). A rodada com modelo real foi feita em 22/10 (23 de 55) e em 23/10 (33 de 55, números em "Números vigentes"); a leitura das falhas e as correções do avaliador estão em `docs/avaliacoes/analise-falhas-22-10.md` (PR 193). A avaliação da extração de notas tem runner próprio, `npm run eval:extracao` (#71), e custo e tempo por execução saem de `npm run eval:custo` (#74).
- Etapa 8 (demo): dataset fixo com reset em um comando (#76) e tela de bastidores (#77) na `develop`. Faltam roteiro, gravação e checklist de congelamento (#78, #79, #111).
- Próxima ação: em andamento, o período padrão terminando ontem nas ferramentas (Executor 4) e o prompt v4 com as expectativas do avaliador (Executor 5); depois, roteiro, gravação e checklist de congelamento (#78, #79, #111) e ensaio do pitch em `/whatsapp` com `npm run seed:demo` e `DEMO_DATA_REFERENCIA=2026-10-20`. Congelamento do código: 24/10 às 15h30. Fila atual: `gh issue list --label prioridade:P0 --state open`.

## Números vigentes

Gerados em 2026-10-23 sobre a `develop` em `6011fb5`, com Node 24, PostgreSQL 18 e Redis 8 locais. Saídas brutas em `evidencias/2026-10-23-*.txt` (fora do git). O relatório completo da rodada real de 23/10 não foi salvo no repositório: valem só os números abaixo. Vínculo não foi rodado de novo nesta sessão.

| O quê | Valor | Gerado por | Em |
| --- | --- | --- | --- |
| Testes unitários | 1296 passam em 90 suítes | `npm test` (Node 24) | 2026-10-23 |
| Testes e2e | 565 passam em 41 suítes (PostgreSQL e Redis reais, cliente de visão e modelo falsos) | `npm run test:e2e` (Node 24) | 2026-10-23 |
| Testes do front do WhatsApp | 25 passam | `npm run test:web` | 2026-10-23 |
| Lint | 0 erros | `npm run lint` | 2026-10-23 |
| Typecheck | 0 erros | `npm run typecheck` | 2026-10-23 |
| Build | passa | `npm run build` | 2026-10-23 |
| Eval (modelo real, prompt `sistema-v3`, `claude-sonnet-5-5`) | 33 de 55 casos passam (60%): numéricas 17/32, sem resposta 6/8, injeção 3/5, verificador 2/5, medição 5/5; custo cerca de US$ 1,22 e latência média 5,5 s. A rodada de 22/10 tinha dado 23 de 55 (41,8%); análise em `docs/avaliacoes/analise-falhas-22-10.md` | `npm run eval -- --modelo real` | 2026-10-23 |
| Eval (modelo falso, prompt `sistema-v2`) | 50 de 50 casos passam (numéricas, verificador, sem resposta e injeção); relatório em `docs/avaliacoes/2026-10-21-sistema-v2-falso.md` | `npm run seed:demo` e `npm run eval` | 2026-10-21 |
| Vínculo nota-produto sem perguntar | 97,9% (92 de 94 itens das 18 notas), 0 ligações erradas. O e2e `tests/vinculo-notas` (94 itens, 0 ligações erradas, pelo menos 90% sem perguntar) faz parte dos 555 e reconfirmou essas condições em 2026-10-22; só o 97,9% exato não foi medido de novo | `npm run test:e2e -- tests/vinculo` | 2026-10-20 |

## Em PR aberto

- Este PR: checkpoint do ESTADO. Nenhum outro PR aberto em 2026-10-23 (`gh pr list`).

## Pendências

- Custo e latência da decisão 0003 saem agora da rodada real de 23/10 (cerca de US$ 1,22 e 5,5 s de latência média por caso); o eval ainda não comparou com o Opus. As expectativas do avaliador q39, q40 e q44 (aceitar "não sei"; ignorar a citação do valor pedido numa recusa) ficam para decisão do dono: ver `docs/avaliacoes/analise-falhas-22-10.md`.
- Cobertura de período: `get_period_summary` devolve dado ausente quando algum dia do período não tem vendas importadas (caso q05 e parecidos), e o período padrão das ferramentas ainda termina hoje (em andamento, Executor 4).
- A chamada real ao modelo com visão nunca foi medida em escala: foi exercida uma vez em 2026-10-22, pelo `/whatsapp` (uma cópia de `fixtures/notas/nota-07.jpg` lida, com a soma dos itens fechando com o total); falta medir 3 fotos em `execucao_agente`.
- No pitch, foto de `fixtures/notas/` reenviada não é extraída de novo (já está no seed): ver `fixtures/README.md`, "Carga no banco".
- As ferramentas do agente usam a data de referência (hoje); com `DEMO_DATA_REFERENCIA=2026-10-20` não há vendas de hoje, então rankings de 7 dias (`get_top_products`) e avisos falam em dado ausente de hoje. Os botões do `/whatsapp` pedem "até ontem" e o "Sugerir preço" já recebe o produto escolhido em código (#182).
- A exclusão em cascata de um comerciante com a planilha da demo importada (cerca de 15 mil linhas) leva cerca de 6 s; considerar ao implementar a exclusão LGPD (#85).
- Ambiente: `npm test` e `npm run test:e2e` exigem Node 24 (a CI usa 24); no Node 22 as suítes que carregam o Nest não rodam. Banco que já aplicou a migração com a numeração antiga (`0004_ingestao`) precisa ser recriado (`npm run db:reset`).
- Identidade do comerciante nas rotas HTTP é o cabeçalho `X-Comerciante-Id` conferido no banco (`src/comerciante/sessao.ts`), provisório até o canal autenticar. O `/whatsapp` e o link do `/painel` levam o id na URL (`?comerciante=`), também provisório.
- Ordem de deploy das migrações: `0009` (sincronização da conta), `0010` (status `obsoleto`), `0011` (limites de alerta) e `0012` (mensagem do WhatsApp) saíram em PRs separados. Banco local que aplicou a migração `0009_mensagem_whatsapp` de uma versão anterior do PR 190 precisa ser recriado (`npm run seed:demo`).
- Nem `develop` nem `main` têm proteção de branch com a CI como status obrigatório (#7). A CI da `develop` falhou em `0739059` e `35cd3e5`; a formatação de `src/lib/verificador-numeros`, que o `prettier --check` acusava, foi corrigida em `5689b27`.
- Decisão 0003 (arquitetura do agente) está como proposta.

## Linha do tempo

- 2026-10-19: Etapa 0 e núcleo do agente.
- 2026-10-20: modelo de dados e seed (#120), Etapa 1 integrada (#119), AGENTS.md, especificação dos agentes e ecossistema de contexto.
- 2026-10-20: Etapa 2, PRs 122 a 124: armazenamento, upload com fila, Extrator, validações, perguntas ao dono, vínculo e planilha de vendas. Detalhe em `src/ingestao/README.md`.
- 2026-10-20: divisão técnica em 3 planos (PR 128). Ticket médio, gasto fora do padrão, estoque parado e espaço para subir preço (PR 127).
- 2026-10-21: Etapa 3 completa (PRs 126 e 146): métricas, correções do Codex e regressão contra o gabarito. Canal com chat web (PR 129), registro de execuções e retentativas (PR 131), `ask_owner` e `save_owner_answer` (PR 132), loop diário e modo conversa (PR 133), reset da demo e bastidores (PR 134), NF-e em XML (PR 136), vínculo por código de barras e sugestão do modelo (PR 137), harness de avaliação (PR 138), ação com confirmação do dono (PR 141). Também mesclados: ponto de encaixe do catálogo e módulos vazios (PR 130), documentação do fluxo do agente (PR 135), ajuste do e2e de revisão de notas (PR 140) e correção do verificador para ignorar ids (PR 150). No fim do dia: ferramentas de leitura do agente (PRs 145 e 160), guardas de CI com a renumeração da migração `0012` para `0007` (PR 152), sobras da revisão do PR 134 (PR 154) e os casos de avaliação numéricos, do verificador e sem resposta (commit `151a03b`).
- 2026-10-21 (noite): motor de regras de alertas com prioridade e supressão (PR 153), avaliação de injeção de instrução (PR 161) e da extração de notas (PR 162), `get_product_margin` com apelidos confirmados e produtos de mesmo nome (PR 168), e este checkpoint (PR 151, versão anterior). Issues novas: #166 (extrato por data de sincronização) e #167 (descrição de nota em `get_product_margin`).
- 2026-10-21 (madrugada de 22): cobertura de extrato por conta e origem e confiança do produto nas métricas (PR 170).
- 2026-10-22: alertas fechados de ponta a ponta (#155, #157, #147, #186), extrato por sincronização (#166), resolução de planilha parcial (#142), exceção da regra 7 (#172), WhatsApp simulado ligado ao banco (#182, PR 190) e a primeira rodada real do eval (23 de 55).
- 2026-10-23: histórico da conversa e menu quando o agente não consegue responder (PR 192), avaliador corrigido e análise das falhas (PR 193), `list_product_margins` (PR 194) e a rodada real do eval com 33 de 55; este checkpoint.
- 2026-10-24 15h30: congelamento do código.
