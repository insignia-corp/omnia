# Protocolo: escolher plano e issues antes de desenvolver

Três pessoas, cada uma com um plano de Claude Code, trabalham ao mesmo tempo. Cada plano é uma **fatia vertical** (desenvolve, refina e testa a sua parte) com pastas próprias, contratos que já existem e dublês para o que ainda não chegou. Assim nenhum plano espera ou quebra outro. Este arquivo é o dono da divisão; o estado do trabalho mora em `ESTADO.md`.

## Antes de desenvolver, pergunte ao usuário

Antes de escrever qualquer código, pergunte (uma pergunta só):

1. Qual plano você está seguindo: **A** (dados e alertas), **B** (agente e avaliação) ou **C** (canal, demo e ingestão)?
2. Quais issues quer desenvolver nesta sessão? Sugira o próximo grupo da ordem do plano.

Só prossiga depois da resposta. Se o usuário já informou plano e issues, confirme em uma linha e siga. Trabalhe só nas pastas do plano escolhido; se a tarefa exigir outra pasta, avise antes.

## Só a parte técnica agora: labels no GitHub

Toda issue aberta tem um destes labels (`gh issue list --label plano:A --state open`):

- `plano:A`, `plano:B`, `plano:C`: técnica, entra neste esquema. Dentro de cada plano, `prioridade:P0` primeiro; P1 e P2 só depois do MVP.
- `depois`: não técnica (validação com lojistas, negócio e custos, pitch, slides, roteiro e gravação da demo, checklist, conta Meta) ou segurança e LGPD (#81 a #87, #108, #109). Fica para depois do MVP ou se sobrar tempo. Segurança é feita no fim, pelo método do dono do projeto. Nenhum plano mexe nelas e nenhum agente as sugere.

Continuam valendo as regras invioláveis de `AGENTS.md` em todo código novo (ex.: `comerciante_id` vem da sessão, nunca do modelo; nenhum segredo no código).

## Objetivo: MVP o quanto antes

Prazo duro: congelamento sábado 24/10/2026 às 15h30. MVP = menor ciclo ponta a ponta no chat web: nota entra, extração, métricas, alerta, agente escreve, verificador confere, mensagem sai. Issues `prioridade:P0` primeiro; P2 e `fora-do-escopo-regional` só se sobrar tempo. Ponto de partida (2026-10-20): ingestão (Etapa 2) na `develop`; `src/metricas`, `src/alertas`, `src/canal` e `src/avaliacao` ainda são casca. Números em `ESTADO.md`.

## Contratos que já existem (cada plano programa contra eles)

- `src/metricas/resultado-metrica.ts`: `ResultadoMetrica` e `DadoAusente` (#32).
- `src/agente/ferramentas/ferramenta.ts`: `Ferramenta`, `ContextoSessao`; `RegistroFerramentas` valida entrada e recusa `comerciante_id`.
- `src/canal/message-channel.ts`: `MessageChannel` (#106, interface).
- `src/agente/llm/modelo-linguagem.ts`: `ModeloLinguagem` (permite modelo falso).
- Schema Drizzle completo e seed (`npm run seed:demo`): nenhum plano deveria precisar de migração nova. Se precisar, faixas: A 0006 a 0008, B 0009 a 0011, C 0012 a 0014.

## Fase 0 (uma vez, plano B, cerca de 30 minutos): ponto de encaixe sem conflito

Hoje `AgenteModule` cria `new RegistroFerramentas([])` e `AppModule` é compartilhado. Para ninguém editar o mesmo arquivo, o plano B faz um PR mínimo e o mescla primeiro:

- `src/agente/ferramentas/catalogo.ts`, que junta `ferramentas-plano-a.ts`, `ferramentas-plano-b.ts` e `ferramentas-plano-c.ts` (cada um exporta uma lista, hoje vazia) e passa o resultado ao `RegistroFerramentas`.
- Módulos vazios `MetricasModule`, `AlertasModule`, `CanalModule`, `AvaliacaoModule` já importados no `AppModule`.

Depois disso, cada plano só edita arquivos seus. Os planos A e C não esperam: desenvolvem e testam na pasta deles e só encaixam no catálogo no passo final de cada issue.

## Planos

Cada plano tem 3 fases: **Desenvolver** (P0 ponta a ponta com dublês), **Refinar** (qualidade, casos de borda, P1) e **Testar** (suíte própria contra gabarito ou e2e). O plano só passa à fase seguinte com a atual verde.

### Plano A: dados e alertas

Pastas: `src/metricas`, `src/alertas`, `src/agente/ferramentas/ferramentas-plano-a.ts`, `tests/metricas`, `tests/alertas`.

| Fase | Issues | Pronto quando |
| --- | --- | --- |
| Desenvolver | #33 margem, #34 giro, #35 variação de custo, #40 resumo diário (funções puras); depois #43 motor de regras, #45 job de reajuste (envia pela interface `MessageChannel`, com canal em memória) | métricas devolvem `ResultadoMetrica` e passam no gabarito |
| Refinar | #44 priorização e deduplicação; P1: #36, #38, #39; P2 só se sobrar: #37 | alertas ordenados, 1 por dia |
| Testar | #41 regressão contra `fixtures/gabarito`, #46 reajuste sem falso alarme | `npm test -- src/metricas src/alertas` e `npm run test:e2e -- tests/metricas tests/alertas` verdes |
| Encaixe | #50, #51, #52 (ferramentas de leitura) em `ferramentas-plano-a.ts` | agente chama as ferramentas com `comerciante_id` da sessão |

### Plano B: agente e avaliação

Pastas: `src/agente` (menos `ferramentas-plano-a.ts` e `ferramentas-plano-c.ts`), `src/avaliacao`, `docs/agent-flow.md`, `tests/agente`.

| Fase | Issues | Pronto quando |
| --- | --- | --- |
| Desenvolver | Fase 0; #48 cliente LLM com custo, #57 registro de execução, #53 ask_owner, save_owner_answer e send_message, #55 loop diário e modo conversa, #105 erros | agente roda ponta a ponta com ferramentas e canal falsos, verificador bloqueia número inventado |
| Refinar | #104 ação com confirmação do dono, ajuste do prompt, #110 `docs/agent-flow.md`; troca do modelo padrão se o eval permitir | regra 7 e regra 8 provadas por teste |
| Testar | #68 harness `npm run eval`, depois #69, #70, #71, #72, #73, #74 | relatório do eval em `evidencias/`; números vão para o PR |
| Primeiro uso com chave real | enviar 3 fotos de `fixtures/notas/` e conferir `execucao_agente` (pendência do `ESTADO.md`) | extração real validada |

### Plano C: canal, demo e ingestão restante

Pastas: `src/canal`, `src/ingestao` (só o que falta), `src/agente/ferramentas/ferramentas-plano-c.ts`, `tests/canal`, `tests/demo`, `scripts/` da demo.

| Fase | Issues | Pronto quando |
| --- | --- | --- |
| Desenvolver | #106 implementação `MessageChannel` em memória e web, #66 chat web (plano B da demo) chamando o `AgenteService` existente, #64 job diário idempotente com limite de 1 mensagem por dia e horário de silêncio, #63 envio de foto de nota pelo chat web | dono conversa e envia nota no chat web; job não duplica |
| Refinar | #27 sugestão de vínculo pelo modelo, #76 reset da demo em um comando, #77 tela de bastidores (extração, confiança, chamadas de ferramenta); P1 WhatsApp só depois do MVP: #61, #62 (#59 bloqueada) | demo roda do zero em um comando |
| Testar | e2e ponta a ponta no chat web com modelo falso (nota entra, mensagem sai), teste da regra de idempotência do #64 (`regra-inviolável`) | `npm run test:e2e -- tests/canal tests/demo` verde |

## Marcos de integração

1. **Fase 0 mesclada** (hoje): ponto de encaixe pronto.
2. **MVP ponta a ponta** (meta: 22/10): A tem métricas e ferramentas de leitura encaixadas, B tem o loop, C tem o chat web. Rodar a demo inteira com `npm run seed:demo`.
3. **Refino e testes** (23/10): eval completo, bastidores, demo ensaiada.
4. **Issues `depois` e segurança, método do dono** (24/10 de manhã, antes do congelamento de 15h30).

## Regras para nenhum plano quebrar outro

1. Cada plano edita só as suas pastas. Arquivo de outro plano: peça a ele, ou abra PR pequeno só para isso.
2. Branch a partir da `develop` atualizada, PR pequeno por grupo de issues (ex.: `feature/33-34-35-metricas`), mesclar cedo e `git pull origin develop` antes de cada commit.
3. Dependência ainda não mesclada: use o dublê (canal em memória, modelo falso, ferramentas falsas) e programe contra o contrato acima.
4. Só o plano A roda o `/checkpoint` no `docs/ESTADO.md`; B e C deixam os números no corpo do PR.
5. Antes de abrir PR: `npm run lint && npm run typecheck && npm test && npm run test:e2e` (Node 24). Issues `regra-inviolável` exigem teste que prove a regra.
6. Se `develop` ficar vermelha por culpa de um PR, o autor corrige primeiro; ninguém mescla por cima.

## Fora dos planos de código

- Label `depois` (31 issues): #30, #59, #60, #78 a #96, #98 a #103, #111 e a segurança (#81 a #87, #108, #109).
- Possivelmente já prontas, conferir e fechar: épicos #1 e #11, #7 (existe `ci.yml`), #16 (Etapa 1 feita).
- Dentro dos planos, cortar se o tempo apertar: #29, #107, #37 e o WhatsApp real (#61 a #63); o chat web cobre a demo.

## Economia de tokens

- Uma sessão por grupo de issues, `/clear` entre grupos.
- Prompt curto: leia `docs/ESTADO.md` e só a seção do guia da issue, implemente as issues escolhidas, mexa só nas pastas do plano.
- Leia seções (`grep -n '^## '`), mande saída longa para `evidencias/`.
- Modelo menor para implementação e testes; o maior para o loop do agente (#55) e a revisão final.
- Rode `/auditoria` só ao fechar cada PR.
