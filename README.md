# Omnia · Gestor automático para pequenos comércios

Agente de IA que avisa o dono de mercadinho ou conveniência pelo WhatsApp o que importa no negócio: margem, reajuste de fornecedor, giro e gastos fora do padrão. Projeto do hackathon AKCIT Camp.

O código calcula, o modelo comunica: nenhum número chega ao dono sem vir de uma função determinística, e um verificador confere cada número antes do envio.

## Como funciona

1. O dono envia fotos de notas de compra e a planilha de vendas, e pode conectar a conta PJ (Open Finance, via Pluggy).
2. Um modelo com visão extrai os itens das notas. O código valida somas, CNPJ e data, e grava tudo com origem e confiança.
3. Funções em TypeScript calculam margem, giro, variação de custo, ticket médio e anomalias.
4. O motor de alertas lista candidatos. O agente escolhe até 3 por dia e escreve uma mensagem curta usando só números das ferramentas.
5. O dono responde no WhatsApp e o agente consulta as métricas ou pergunta o que falta.

## Stack

TypeScript, NestJS, PostgreSQL (com `pg_trgm`), Redis + BullMQ, Docker Compose, Zod, WhatsApp Cloud API e Pluggy (sandbox).

## Roteiro

O trabalho está organizado em [milestones](https://github.com/outz1/omnia/milestones), um por etapa do [guia de desenvolvimento](docs/guia-desenvolvimento.md). Cada etapa tem um épico com as sub-issues, e só se avança quando o critério de pronto passa.

| Etapa | Pronto quando |
| --- | --- |
| 0. Base | `docker compose up` sobe tudo e um teste de saúde passa |
| 1. Dados de teste | Existe o gabarito que o sistema deve reproduzir |
| 2. Ingestão | Uma foto vira itens, fornecedor, data e total no banco, com confiança |
| 3. Métricas | Os números batem com o gabarito |
| 4. Alertas | Um reajuste plantado é detectado |
| 5. Agente | O agente responde e redige alertas só com números das ferramentas |
| 6. Canal | O relatório chega ao WhatsApp e a resposta do dono é entendida |
| 7. Avaliação | Metas da avaliação atingidas |
| 8. Piloto e demo | Um lojista responde "estou lucrando em cima do que mais vende?" em menos de um minuto |

Trilhas paralelas: **Segurança e LGPD**, **Validação e negócio** (entrevistas, custos, concorrentes) e **Pitch e equipe**.

Acompanhe o andamento no [quadro do projeto](https://github.com/users/outz1/projects) e veja como escolher e abrir issues no [CONTRIBUTING](CONTRIBUTING.md).

## Estrutura do repositório

```
.
├── .github/          # Templates de issue e PR, CODEOWNERS
├── docs/             # Guia de desenvolvimento, contexto do hackathon, decisões
├── src/              # Código-fonte (a partir da Etapa 0)
└── tests/            # Testes
```

## Como rodar

Disponível ao final da Etapa 0. Enquanto isso, veja as issues do milestone [Etapa 0 · Base](https://github.com/outz1/omnia/milestones).

## Documentação

- [Guia de desenvolvimento](docs/guia-desenvolvimento.md): arquitetura, etapas, modelo de dados, métricas, agente, avaliação, segurança
- [Contexto do hackathon](docs/contexto-hackathon.md): critérios da banca, persona, viabilidade, custos, riscos
- [CLAUDE.md](CLAUDE.md): regras invioláveis e convenções do projeto

## Equipe

- [@outz1](https://github.com/outz1)
- [@MxK-rafas](https://github.com/MxK-rafas)
- [@pedrofacundoo](https://github.com/pedrofacundoo)
- [@rleogabriel](https://github.com/rleogabriel)
