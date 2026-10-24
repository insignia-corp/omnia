# Omnia · Gestor automático para pequenos comércios

Agente de IA que avisa o dono de mercadinho ou conveniência pelo WhatsApp o que importa no negócio: margem, reajuste de fornecedor, giro, ticket médio e produtos que pararam de vender.

O código calcula, o modelo comunica: nenhum número chega ao dono sem vir de uma função determinística, e um verificador confere cada número da mensagem contra os resultados das ferramentas antes do envio. No MVP o agente só informa e sugere; não executa nenhuma ação financeira.

## Como funciona

1. O dono envia a foto de uma nota de compra (ou o XML da NF-e) e a planilha de vendas, pelo chat ou pelo WhatsApp.
2. Um modelo com visão extrai fornecedor, data, itens e total da foto. O código valida somas, quantidade x valor unitário, CNPJ e data, liga cada item a um produto e grava tudo com origem e confiança. Item duvidoso vira pergunta ao dono.
3. Funções puras em TypeScript calculam margem, variação de custo, giro, ticket médio, estoque parado e resumos por dia, semana e mês.
4. Ao receber a nota, o dono vê na hora se algum custo mudou contra a compra anterior do produto.
5. Todo dia, o motor de alertas lista candidatos (reajuste de custo, margem abaixo da meta, dias sem venda). O agente escolhe até 3, escreve uma mensagem curta e o verificador a confere. No máximo 1 mensagem proativa por dia.
6. O dono conversa: o agente escolhe as ferramentas certas, responde só com números delas, diz que não sabe quando nenhuma serve e pede confirmação antes de gravar algo, como um preço-meta.

## Arquitetura

API NestJS em TypeScript estrito, com PostgreSQL 18 (Drizzle e `pg_trgm`) para dados e histórico, Redis 8 com BullMQ para filas e jobs e Zod para validar toda entrada, inclusive a saída dos modelos. Nenhum estado fica na memória do processo. Detalhe e diagrama em [docs/arquitetura.md](docs/arquitetura.md).

| Módulo (`src/`) | Papel |
| --- | --- |
| `ingestao/` | Upload, fila de extração, Extrator com visão, validações em código, vínculo nota-produto, planilha de vendas, NF-e em XML |
| `metricas/` | Funções puras com teste unitário: margem, variação de custo, giro, ticket médio, resumos, briefing diário |
| `alertas/` | Motor de regras com prioridade e supressão, candidatos e seus status |
| `agente/` | Loop do agente, ferramentas, prompts versionados, verificador de números, registro de execuções |
| `canal/` | Interface `MessageChannel` (chat web, WhatsApp simulado), jobs do relatório diário, painel e bastidores |
| `avaliacao/` | `npm run eval`: perguntas numéricas, verificador, injeção de instrução, extração e custo |
| `lib/` | Componentes isolados: dinheiro em centavos, CNPJ, datas, verificador de números |

Dois modelos por papel: o Extrator lê a foto e o Analista conversa e usa ferramentas. Ambos usam `claude-sonnet-5-5` por padrão (variáveis `EXTRATOR_MODELO` e `LLM_MODELO`).

## Requisitos

- Node 24 e npm (para rodar fora do contêiner e para os testes; a CI usa 24).
- Docker com Compose (PostgreSQL 18 e Redis 8).
- Uma chave da Anthropic em `ANTHROPIC_API_KEY` para o agente e a leitura de fotos. Sem ela, a API sobe e as métricas funcionam, mas o agente e a extração real não.
- Portas livres 3000 (API), 5432 (PostgreSQL) e 6379 (Redis); mude `API_PORTA`, `POSTGRES_PORTA` ou `REDIS_PORTA` no `.env` se precisar.

## Como rodar

Tudo no Docker:

```bash
cp .env.example .env          # preencha ANTHROPIC_API_KEY
docker compose up -d --build  # PostgreSQL, Redis e API, com migrações
curl localhost:3000/health    # {"status":"ok","postgres":"ok","pgTrgm":"ok","redis":"ok"}
```

Desenvolvimento local, com banco e Redis no Docker e a API com recarga automática:

```bash
cp .env.example .env
npm ci
docker compose up -d postgres redis
npm run db:migrate
npm run dev
```

Para ter dados, carregue o mercadinho de teste (2 comerciantes, 50 produtos, 18 notas e 30 dias de vendas). O comando zera o banco:

```bash
npm run seed:demo
```

Os dados terminam em 2026-10-19 e a API usa a data real do sistema. Para a conversa olhar o período dos dados, descomente `DEMO_DATA_REFERENCIA=2026-10-20` no `.env` e reinicie.

## Acessar no navegador

Com a API em `http://localhost:3000`:

| URL | O que é |
| --- | --- |
| `/whatsapp` | Conversa que imita o WhatsApp Web: texto, botões, lista, envio de foto de nota. É a tela principal para usar o produto |
| `/chat` | Chat web simples, o plano B sem JavaScript de módulo |
| `/painel` | Painel do dono: resumo de ontem, da semana e do mês, produtos abaixo da meta e avisos do dia |
| `/bastidores` | Execuções do agente em ordem: ferramentas chamadas, verificador, candidatos a alerta, confiança da última nota |
| `/health` | Saúde da API, do PostgreSQL, do `pg_trgm` e do Redis |

A identidade do comerciante é provisória: `/whatsapp` abre o comerciante da demo; use `?comerciante=<id>` para outro (`GET /whatsapp/sessao` mostra o id em uso). As rotas `/chat/*`, `/documentos/*` e `/perguntas/*` pedem o cabeçalho `X-Comerciante-Id`.

## O que dá para fazer

No `/whatsapp`, toque em "oi" ou "menu" para a lista de opções, ou escreva livremente:

- **Resumo do dia, da semana ou do mês**: faturamento, vendas e ticket médio, com comparação (ontem contra as últimas sextas, por exemplo).
- **Produtos que mais e menos vendem**, por unidades, receita ou margem.
- **Margem de um produto** ou de todos, e quais estão abaixo da meta.
- **Reajustes de fornecedor**: quanto o custo subiu e quando.
- **Enviar uma nota**: arraste uma foto (ou XML de NF-e) para a conversa. O Omnia lê, confere, avisa se algum custo mudou contra a compra anterior e pergunta o que ficou em dúvida.
- **Sugerir preço**: o agente propõe o preço que leva a margem à meta e só grava o preço-meta depois do "sim" do dono.
- **Resumo diário proativo**: o botão do menu de três pontos dispara o mesmo serviço do job das 8h (`RELATORIO_DIARIO_CRON`, fuso `FUSO_HORARIO`, silêncio entre `SILENCIO_INICIO` e `SILENCIO_FIM`).

Pela API, sem a tela:

```bash
ID=$(curl -s localhost:3000/whatsapp/sessao | sed -E 's/.*"comerciante_id":"([^"]+)".*/\1/')
curl -s -X POST localhost:3000/chat/mensagens -H "X-Comerciante-Id: $ID" \
  -H 'content-type: application/json' -d '{"id_externo":"'$(uuidgen)'","texto":"Qual foi o ticket médio de ontem?"}'
curl -s -X POST localhost:3000/chat/notas -H "X-Comerciante-Id: $ID" -F "arquivo=@fixtures/notas/nota-02.jpg;type=image/jpeg"
```

Ferramentas do agente (nomes em inglês): `get_daily_summary`, `get_daily_briefing`, `get_period_summary`, `get_top_products`, `get_product_margin`, `list_product_margins`, `get_cost_changes`, `list_alert_candidates`, `select_alerts`, `ask_owner`, `save_owner_answer` e `propose_target_price`. Detalhe em [docs/especificacao-agentes.md](docs/especificacao-agentes.md).

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` / `npm run build` / `npm start` | API com recarga / compila / roda o compilado |
| `npm test` | Testes unitários |
| `npm run test:e2e` | Testes com PostgreSQL e Redis reais (suba o compose antes) |
| `npm run test:web` | Testes do front do WhatsApp |
| `npm run lint` / `npm run typecheck` | ESLint e TypeScript |
| `npm run db:generate` | Gera migração a partir de `src/infra/database/schema.ts` |
| `npm run db:migrate` / `npm run db:reset` | Aplica migrações / zera o banco e reaplica |
| `npm run seed:demo` / `npm run demo:reset` | Zera o banco e carrega a demo / refaz só a demo, sem apagar outros comerciantes |
| `npm run seed:pitch` | Carrega o Mercadinho Bom Preço do vídeo (apaga o banco; ver `fixtures/pitch/README.md`) |
| `npm run eval` | Avaliação do agente, com relatório em `docs/avaliacoes/` (`-- --modelo real` usa a API paga) |
| `npm run eval:extracao` / `npm run eval:custo` | Avaliação da extração de notas / custo e latência |
| `npm run fixtures:gerar` | Regera os arquivos de `fixtures/` (ver `fixtures/README.md`) |

Antes de abrir PR rode `npm run lint && npm run typecheck && npm test && npm run test:e2e`. Fluxo de branches, labels e PRs em [CONTRIBUTING](CONTRIBUTING.md).

## Estrutura do repositório

```
.
├── .github/          # Templates de issue e PR, CODEOWNERS, CI
├── docs/             # Guia, arquitetura, modelo de dados, decisões, relatórios de avaliação
├── drizzle/          # Migrações SQL
├── fixtures/         # Dados de teste, gabarito e notas (ver fixtures/README.md)
├── scripts/          # Reset da demo, seed do vídeo, geração de fixtures
├── src/              # API NestJS (módulos na tabela acima, mais config, infra e comerciante)
├── tests/            # Testes e2e
└── web/whatsapp/     # Front do WhatsApp simulado, servido em /whatsapp (sem build)
```

## Como rodar

Requisitos: Docker com Compose e, para desenvolver fora do contêiner, Node 24.

```bash
cp .env.example .env          # preencha ANTHROPIC_API_KEY
docker compose up -d --build  # PostgreSQL, Redis e API, com migrações
curl localhost:3000/health    # {"status":"ok","postgres":"ok","pgTrgm":"ok","redis":"ok"}
```

O `/health` verifica as dependências em paralelo, com prazo de 1 segundo por checagem. Retorna HTTP 503 se uma delas falhar ou exceder o prazo. Redis desconectado retorna falha sem enfileirar novos pings na conexão de filas.

Se alguma porta já estiver em uso, mude `API_PORTA`, `POSTGRES_PORTA` ou `REDIS_PORTA` no `.env`.

Desenvolvimento local, com banco e Redis no Docker:

```bash
npm ci
docker compose up -d postgres redis
npm run db:migrate
npm run dev
```

| Comando | O que faz |
| --- | --- |
| `npm test` | Testes unitários |
| `npm run test:e2e` | Testes com PostgreSQL e Redis reais (suba o compose antes) |
| `npm run lint` / `npm run typecheck` | ESLint e TypeScript |
| `npm run db:generate` | Gera migração a partir de `src/infra/database/schema.ts` |
| `npm run db:migrate` / `npm run db:reset` | Aplica migrações / zera o banco e reaplica |
| `npm run db:seed` / `npm run seed:demo` | Carrega o mercadinho de teste (2 comerciantes) / zera o banco e carrega |
| `npm run fixtures:gerar` | Regera os arquivos de `fixtures/` (ver `fixtures/README.md`) |

## Documentação

- [Guia de desenvolvimento](docs/guia-desenvolvimento.md): arquitetura, etapas, modelo de dados, métricas, agente, avaliação, segurança
- [Modelo de dados](docs/modelo-de-dados.md): tabelas, diagrama, histórico append-only e seed
- [Arquitetura](docs/arquitetura.md): módulos, dados, serviços externos e modelos por papel
- [Fluxo do agente](docs/agent-flow.md): inputs, lógica e outputs do agente
- [Especificação dos agentes](docs/especificacao-agentes.md): Extrator, Analista, orquestrador, ferramentas, falhas e avaliação
- [Decisões](docs/decisoes/): ORM, modelo de linguagem, arquitetura do agente
- [AGENTS.md](AGENTS.md): regras invioláveis, roteamento e convenções do projeto (o `CLAUDE.md` o importa e acrescenta só os comandos do Claude Code)

## Equipe

- [@outz1](https://github.com/outz1)
- [@MxK-rafas](https://github.com/MxK-rafas)
- [@pedrofacundoo](https://github.com/pedrofacundoo)
- [@rleogabriel](https://github.com/rleogabriel)
