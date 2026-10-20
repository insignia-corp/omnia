# ESTADO: você está aqui

Fonte única do estado atual. Atualizado por `/checkpoint`. Só números datados e com o comando que os gerou; método e decisões moram nos docs-dono (ver [README](README.md)).

Atualizado em: 2026-10-20 · commit base: `bad8f67` (develop) · branch `feature/28-planilha-vendas` (sobre `feature/26-revisao-e-vinculo`, que fica sobre `feature/20-ingestao-foto`)

## Etapa

- Etapa 0 (base): feita. Núcleo do agente, verificador de números, CNPJ, dinheiro, esquema de extração, registro de ferramentas e interface `MessageChannel` existem em `src/`.
- Etapa 1 (dados de teste e gabarito): feita (#119). Detalhe em `fixtures/README.md`.
- Modelo de dados completo (schema Drizzle, histórico append-only) e seed dos fixtures (#120): feito. Detalhe em `docs/modelo-de-dados.md`; `npm run seed:demo` existe.
- Etapa 2 (ingestão), em andamento. Feitos na branch `feature/20-ingestao-foto`: armazenamento (#22), upload e fila BullMQ (#23), Extrator com Zod (#24), validações em código (#25). Na branch `feature/26-revisao-e-vinculo`: revisão de item e pergunta ao dono (#26), vínculo item-produto por catálogo e similaridade (#27, sem a sugestão do modelo). Na branch `feature/28-planilha-vendas`: importação de planilha de vendas CSV e XLSX (#28). Falta: sugestão de vínculo pelo modelo (#27) e NF-e (#29, P2). Os P0 da Etapa 2 estão feitos; o critério de pronto do épico (foto vira itens, fornecedor, data e total no banco, com confiança) passa nos testes e2e com cliente de visão falso, e depende da primeira chamada real ao modelo. Detalhe em `src/ingestao/README.md`.
- Próxima: abrir as 3 PRs em ordem (#20 base, depois #26 e #27, depois #28), exercitar o Extrator com chave real e começar a Etapa 3 (métricas, #31 a #41). Fila atual: `gh issue list --label prioridade:P0 --state open`.
- `src/metricas`, `src/alertas`, `src/canal` e `src/avaliacao` ainda são casca (só tipos ou README).

## Números vigentes

| O quê | Valor | Gerado por | Em |
| --- | --- | --- | --- |
| Testes unitários | 219 passam em 20 suítes | `npm test` | 2026-10-20 |
| Testes e2e | 50 passam em 7 suítes (PostgreSQL e Redis reais, cliente de visão falso) | `npm run test:e2e` | 2026-10-20 |
| Lint | 0 erros | `npm run lint` | 2026-10-20 |
| Typecheck | 0 erros | `npm run typecheck` | 2026-10-20 |
| Vínculo nota-produto sem perguntar | 97,9% (92 de 94 itens das 18 notas), 0 ligações erradas | `npm run test:e2e -- tests/vinculo` | 2026-10-20 |
| Eval | ainda não existe (`npm run eval`, #68 a #74) | n/a | n/a |

## Pendências

- A chamada real ao modelo com visão (imagem e saída estruturada em `cliente-visao-anthropic.ts`) não foi exercida: sem `ANTHROPIC_API_KEY` no ambiente. Os testes usam cliente falso. Primeiro uso com chave: enviar 3 fotos de `fixtures/notas/` e conferir `execucao_agente`.
- A exclusão em cascata de um comerciante com a planilha da demo importada (cerca de 15 mil linhas) leva cerca de 6 s; considerar ao implementar a exclusão LGPD (#85).
- Aviso ao dono quando a extração falha depende do canal (#106, #66); hoje o estado fica em `documento.status` e `documento.erro`.
- Identidade do comerciante nas rotas HTTP é o cabeçalho `X-Comerciante-Id` conferido no banco (`src/comerciante/sessao.ts`), provisório até o canal autenticar.
- Decisão 0003 (arquitetura do agente) está como proposta; custo e latência são estimativas até o `npm run eval` medir (#74).
- Modelo padrão em `src/config/env.ts` ainda é `claude-opus-5-5` (decisão 0002), troca para Sonnet depende do eval.

## Linha do tempo

- 2026-10-19: Etapa 0 e núcleo do agente.
- 2026-10-20: modelo de dados e seed (#120). Etapa 1 integrada (#119), AGENTS.md (#117), especificação dos agentes, ecossistema de contexto (AGENTS.md como dono das regras e do roteamento, CLAUDE.md importa AGENTS.md, ESTADO, protocolos em docs/protocolos).
- 2026-10-20: Etapa 2, PR 1: armazenamento, upload com fila BullMQ, Extrator, validações em código e migração 0004 (`historico_custo` aceita correção do dono como linha nova).
- 2026-10-20: Etapa 2, PR 2: perguntas ao dono por item duvidoso e por vínculo, resposta que entra como linha nova no histórico, recálculo do documento e vínculo por similaridade.
- 2026-10-20: Etapa 2, PR 3: importação de planilha de vendas CSV e XLSX com mapeamento confirmado uma vez, idempotente por cupom, conferida contra o gabarito.
- 2026-10-24 15h30: congelamento do código.
