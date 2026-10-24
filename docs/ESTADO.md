# ESTADO: você está aqui

Fonte única do estado atual. Atualizado por `/checkpoint`. Só números datados e com o comando que os gerou; método e decisões moram nos docs-dono (ver [README](README.md)).

Atualizado em: 2026-10-24 · commit base: `399ac4a` (`develop` após o PR 203) · branch `docs/estado-final-e-modulos`

## Etapa

- Etapa 0 (base): feita. A CI também confere variáveis de ambiente contra `.env.example`, deriva das migrações e `comerciante_id` em toda tabela (guardas no `.github/workflows/ci.yml`, PR 152). Id de correlação entre requisição e jobs nos logs (#10). Resta ligar a CI como status obrigatório na proteção das branches (#7).
- Etapa 1 (dados de teste e gabarito): feita. Falta só a revisão do gabarito de métricas por uma segunda pessoa (#16). Detalhe em `fixtures/README.md`.
- Etapa 2 (ingestão): na `develop`, armazenamento, upload e fila BullMQ, Extrator com Zod, validações em código, revisão de item e pergunta ao dono, vínculo por catálogo, similaridade, código de barras e sugestão do modelo confirmada pelo dono (#27), planilha de vendas CSV e XLSX (#28) e NF-e em XML (#29). A integração Pluggy (#30) está fora do escopo: o extrato bancário, a Pluggy e o Open Finance são implementação futura (decisão do dono em 24/10/2026). A resolução de importação parcial de planilha entrou no PR 187 (#142, fechada). Detalhe em `src/ingestao/README.md`.
- Etapa 3 (métricas): feita, com o épico #31 fechado. Resumo da semana e do mês e o preço que leva a margem à meta entram com o #182. O extrato de uma conta vale até a data da última sincronização, e a conta ativa sem sincronização fica sem total de gastos em vez de zero (#166, PR 183). Margem, variação de custo, giro, resumo diário, ticket médio, gasto fora do padrão (função mantida; a regra saiu do motor, #220), estoque parado e espaço para subir preço batem com o gabarito, e o conjunto de alertas esperados também (#41, sem o gasto no motor). O extrato por sincronização (#166) fica como implementação futura. Os débitos #143 (extrato por conta), #144 (origem e confiança do produto) e #148 (critério de receita) estão fechados. Detalhe em `src/metricas/README.md`.
- Etapa 4 (motor de alertas): na `develop`, o motor de regras com prioridade e supressão (#43 e #44; PR 153), job de reajuste e teste de detecção (#45, #46), `list_alert_candidates` (#52), status final `enviado` e `descartado` (#155; PR 177), status `obsoleto` para o candidato que a correção do dono desfez (#157; PR 185) e, para o reajuste de custo, a variação da própria compra refeita em ordem estável das compras (#186; PR 191), limites de alerta por comerciante em tabela append-only (#147; PR 188) e a exceção da regra 7 para estado derivado das métricas (#172; PR 189). Menor confiança dos candidatos conferida (PR 184). Detalhe em `src/alertas/README.md`.
- Etapa 5 (agente): na `develop`, núcleo, verificador, registro de execuções, loop diário e modo conversa (#55, fechada), `ask_owner`, `save_owner_answer`, `propose_target_price` e `select_alerts` (o envio não é ferramenta: o `AgenteService` devolve o texto verificado e o `MessageChannel` entrega), ação com confirmação do dono e preço-meta (#104), as ferramentas de leitura `get_daily_summary`, `get_top_products`, `get_product_margin` e `get_cost_changes` (#50, #51, #149, #156 e #167, fechadas; PRs 145, 160, 168 e 178). `list_alert_candidates` (#52), `get_period_summary` (#182) e `list_product_margins` (lista margens sem precisar do nome; PR 194, melhoria pedida pelo dono) também. Critério `receita` em `get_top_products` e receita por produto (#148, fechada; PR 169). O período padrão de `get_period_summary` e `get_top_products` termina ontem, o último dia completo (PR 197). `get_daily_briefing`, o resumo diário do pitch (PR 225). Prompt do sistema na versão `sistema-v6`, no formato do vídeo e com o relatório diário por `get_daily_briefing` (#222, PR 227; o v5 veio dos PRs 199 e 201); o resumo do dia e os avisos olham ontem (PR 215, mesclado).
- Etapa 6 (canal): na `develop`, `MessageChannel`, chat web como plano B, escolha por `CANAL`, job do relatório diário com chave de idempotência e horário de silêncio (#64, #66, #106). WhatsApp simulado para o pitch (#179, PR 181) ligado ao backend e ao banco (#182, PR 190), ambos mesclados: `/whatsapp` servido pelo Nest, status e digitando do banco, botões e lista escolhidos em código, modelo `resumo_diario` fora da janela de 24 h, nota lida na conversa e `/painel`. Resposta em texto livre mantém o histórico da conversa e uma resposta barrada abre o menu (PR 192). Painel do dono e bastidores com o visual novo para o pitch (PRs 208 e 210). Detalhe em `src/canal/README.md`. A Cloud API real (#61 a #63) e áudio (#107) não começaram.
- Etapa 7 (avaliação): o harness `npm run eval` existe (#68), com perguntas numéricas, casos do verificador, perguntas sem resposta, injeção de instrução e casos de medição (#69, #70, #72, #73 e #74, fechadas). Rodadas com modelo real em 22/10 (prompt v3), 23/10 (v3 e v4) e 24/10 (v5): a final está em `docs/avaliacoes/2026-10-24-sistema-v5-claude-sonnet-5-5-rodada-final.md` e os números vigentes em "Números vigentes". O avaliador foi corrigido e afrouxado onde a resposta estava certa (PRs 193, 196 e 200). A avaliação da extração de notas tem runner próprio, `npm run eval:extracao` (#71), e custo e tempo por execução saem de `npm run eval:custo` (#74).
- Etapa 8 (demo): dataset fixo com reset em um comando (#76), tela de bastidores (#77) na `develop`. Faltam roteiro, gravação e checklist de congelamento (#78, #79, #111).
- Próxima ação: mesclar os PRs 228, 229 e 230; depois, ensaio e gravação do pitch em `/whatsapp` com `npm run seed:pitch` e `DEMO_DATA_REFERENCIA=2026-10-24` (roteiro e números-alvo em `fixtures/pitch/README.md`). Congelamento do código: hoje, 24/10 às 15h30. Fila atual: `gh issue list --label prioridade:P0 --state open`.

## Números vigentes

Gerados em 2026-10-24 sobre a `develop` em `399ac4a` (limpa), com Node 24, PostgreSQL 18 e Redis 8 locais. Saídas brutas em `evidencias/2026-10-24-*.txt` (fora do git). O 97,9% do vínculo não foi medido de novo nesta sessão.

| O quê | Valor | Gerado por | Em |
| --- | --- | --- | --- |
| Testes unitários | 1407 passam em 97 suítes | `npm test` (Node 24) | 2026-10-24 |
| Testes e2e | 574 passam em 42 suítes (PostgreSQL e Redis reais, cliente de visão e modelo falsos) | `npm run test:e2e` (Node 24) | 2026-10-24 |
| Testes do front do WhatsApp | 25 passam | `npm run test:web` | 2026-10-24 |
| Formatação | passa | `npx prettier --check .` | 2026-10-24 |
| Lint | 0 erros | `npm run lint` | 2026-10-24 |
| Typecheck | 0 erros | `npm run typecheck` | 2026-10-24 |
| Build | passa | `npm run build` | 2026-10-24 |
| Eval (modelo real, prompt `sistema-v5`, `claude-sonnet-5-5`) | 45 de 55 casos passam (81,8%): numéricas 26/32, sem resposta 7/8, injeção 4/5, verificador 3/5, medição 5/5; custo cerca de US$ 1,60 e latência média de 4,0 s. Antes: 38 de 55 com o v4 (23/10) e 23 de 55 com o v3 (22/10). Relatório: `docs/avaliacoes/2026-10-24-sistema-v5-claude-sonnet-5-5-rodada-final.md` | `npm run eval -- --modelo real` | 2026-10-24 |
| Eval (modelo falso, prompt `sistema-v2`, histórico: não rodado de novo desde 21/10) | 50 de 50 casos passam (numéricas, verificador, sem resposta e injeção); relatório em `docs/avaliacoes/2026-10-21-sistema-v2-falso.md` | `npm run seed:demo` e `npm run eval` | 2026-10-21 |
| Vínculo nota-produto sem perguntar | 97,9% (92 de 94 itens das 18 notas), 0 ligações erradas. O e2e `tests/vinculo-notas` (94 itens, 0 ligações erradas, pelo menos 90% sem perguntar) roda dentro de `npm run test:e2e`; só o 97,9% exato não foi medido de novo | `npm run test:e2e -- tests/vinculo` | 2026-10-20 |

## Em PR aberto

- PR 228: leva para a `develop` a parte de alertas e docs da #220 (o PR 224 foi mesclado na branch do PR 215 depois que ele já tinha entrado na `develop`).
- PR 229: aviso de custo na resposta à foto da nota (etapa 1 do vídeo).
- PR 230: comentários do efeito `nenhum` citam o status `obsoleto` (#220).
- Já na `develop` em 2026-10-24: PR 215 (dia dos avisos), PR 223 (canal sem gastos, #220), PR 225 (`get_daily_briefing`), PR 226 (seed do pitch) e PR 227 (prompt `sistema-v6`, #222).

## Pendências

- Remoção completa do extrato bancário, da Pluggy e do Open Finance (tabelas `consentimento`, `conta` e `transacao`, métrica de gasto fora do padrão, gabarito e testes): #221, label `depois`. O nível 1 (#220) só tirou isso do que o dono vê e da documentação; nada foi apagado.
- Custo e latência da decisão 0003 saem da rodada real de 24/10 (ver "Números vigentes"); o eval ainda não comparou com o Opus. Casos do eval ainda reprovados na rodada final: q30 e q31 (dias sem venda: o agente diz 42 e o gabarito 41; a convenção de contagem fica para o dono), q32 (o agente não deu o número, esperado 25), q04, q10, q12 (falta número na resposta), q39 (a expectativa do avaliador, aceitar "não sei", é decisão do dono), q41, v02 e v05.
- Cobertura de período: `get_period_summary` devolve dado ausente quando algum dia do período não tem vendas importadas (caso q05 e parecidos).
- A chamada real ao modelo com visão nunca foi medida em escala: foi exercida uma vez em 2026-10-22, pelo `/whatsapp` (uma cópia de `fixtures/notas/nota-07.jpg` lida, com a soma dos itens fechando com o total); falta medir 3 fotos em `execucao_agente`.
- No pitch, foto de `fixtures/notas/` reenviada não é extraída de novo (já está no seed): ver `fixtures/README.md`, "Carga no banco".
- Com `DEMO_DATA_REFERENCIA=2026-10-20` não há vendas de hoje: o período padrão das ferramentas de período já termina ontem (PR 197), o resumo do dia e os avisos passam a olhar ontem no PR 215 (aberto), e os botões do `/whatsapp` pedem "até ontem". O "Sugerir preço" já recebe o produto escolhido em código (#182).
- A exclusão em cascata de um comerciante com a planilha da demo importada (cerca de 15 mil linhas) leva cerca de 6 s; considerar ao implementar a exclusão LGPD (#85).
- Ambiente: `npm test` e `npm run test:e2e` exigem Node 24 (a CI usa 24); no Node 22 as suítes que carregam o Nest não rodam. Banco que já aplicou a migração com a numeração antiga (`0004_ingestao`, hoje `0004_vinculos_execucao_e_id_externo`) precisa ser recriado (`npm run db:reset`).
- Identidade do comerciante nas rotas HTTP é o cabeçalho `X-Comerciante-Id` conferido no banco (`src/comerciante/sessao.ts`), provisório até o canal autenticar. O `/whatsapp` e o link do `/painel` levam o id na URL (`?comerciante=`), também provisório.
- Ordem de deploy das migrações: `0009` (sincronização da conta), `0010` (status `obsoleto`), `0011` (limites de alerta) e `0012` (mensagem do WhatsApp) saíram em PRs separados. Banco local que aplicou a migração `0009_mensagem_whatsapp` de uma versão anterior do PR 190 (hoje `0012_mensagem_whatsapp`) precisa ser recriado (`npm run seed:demo`).
- Nem `develop` nem `main` têm proteção de branch com a CI como status obrigatório (#7). A CI da `develop` falhou em `0739059` e `35cd3e5`; a formatação de `src/lib/verificador-numeros`, que o `prettier --check` acusava, foi corrigida em `5689b27`.
- Decisão 0003 (arquitetura do agente) está como proposta.
- A revisão do gabarito de métricas por uma segunda pessoa segue aberta (#16).

## Linha do tempo

- 2026-10-19: Etapa 0 e núcleo do agente.
- 2026-10-20: modelo de dados e seed (#120), Etapa 1 integrada (#119), AGENTS.md, especificação dos agentes e ecossistema de contexto.
- 2026-10-20: Etapa 2, PRs 122 a 124: armazenamento, upload com fila, Extrator, validações, perguntas ao dono, vínculo e planilha de vendas. Detalhe em `src/ingestao/README.md`.
- 2026-10-20: divisão técnica em 3 planos (PR 128). Ticket médio, gasto fora do padrão, estoque parado e espaço para subir preço (PR 127).
- 2026-10-21: Etapa 3 completa (PRs 126 e 146): métricas, correções do Codex e regressão contra o gabarito. Canal com chat web (PR 129), registro de execuções e retentativas (PR 131), `ask_owner` e `save_owner_answer` (PR 132), loop diário e modo conversa (PR 133), reset da demo e bastidores (PR 134), NF-e em XML (PR 136), vínculo por código de barras e sugestão do modelo (PR 137), harness de avaliação (PR 138), ação com confirmação do dono (PR 141). Também mesclados: ponto de encaixe do catálogo e módulos vazios (PR 130), documentação do fluxo do agente (PR 135), ajuste do e2e de revisão de notas (PR 140) e correção do verificador para ignorar ids (PR 150). No fim do dia: ferramentas de leitura do agente (PRs 145 e 160), guardas de CI com a renumeração da migração `0012` para `0007` (PR 152), sobras da revisão do PR 134 (PR 154) e os casos de avaliação numéricos, do verificador e sem resposta (commit `151a03b`).
- 2026-10-21 (noite): motor de regras de alertas com prioridade e supressão (PR 153), avaliação de injeção de instrução (PR 161) e da extração de notas (PR 162), `get_product_margin` com apelidos confirmados e produtos de mesmo nome (PR 168), e este checkpoint (PR 151, versão anterior). Issues novas: #166 (extrato por data de sincronização) e #167 (descrição de nota em `get_product_margin`).
- 2026-10-21 (madrugada de 22): cobertura de extrato por conta e origem e confiança do produto nas métricas (PR 170).
- 2026-10-22: alertas fechados de ponta a ponta (#155, #157, #147, #186), extrato por sincronização (#166), resolução de planilha parcial (#142), exceção da regra 7 (#172), WhatsApp simulado ligado ao banco (#182, PR 190) e a primeira rodada real do eval.
- 2026-10-23: histórico da conversa e menu quando o agente não consegue responder (PR 192), avaliador corrigido e análise das falhas (PR 193), `list_product_margins` (PR 194) e a rodada real do eval; este checkpoint.
- 2026-10-24: prompt `sistema-v5` e rodada final do eval real (45 de 55), período padrão ontem nas ferramentas, painel e bastidores com o visual do pitch, este checkpoint final e a revisão dos README de módulo e das docs-base. Mesclados no dia: PRs 196 a 203 (avaliador, prompts v4 e v5, relatórios do eval), 208 e 210 (visuais) e 216 a 218 (docs).
- 2026-10-24 15h30: congelamento do código.
