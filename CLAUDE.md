# Gestor automático para pequenos comércios

Agente de IA que avisa o dono de mercadinho ou conveniência pelo WhatsApp o que importa no negócio (margem, reajuste de fornecedor, giro, gastos fora do padrão). Projeto do hackathon AKCIT Camp.

Guia de desenvolvimento (carregado em toda sessão): arquitetura, etapas, modelo de dados, métricas, agente, avaliação.

@docs/guia-desenvolvimento.md

Alertas do hackathon (carregado em toda sessão): prazo, escopo cortado e o que a banca avalia no código (seção 9.4 do edital). Em conflito com o guia, prevalece este.

@docs/alertas-hackathon.md

Documento de referência (ler sob demanda, não carregar sempre):
- `docs/contexto-hackathon.md`: critérios da banca, persona, viabilidade, custos, riscos

## Stack

TypeScript, NestJS, PostgreSQL (com `pg_trgm`), Redis + BullMQ, Docker Compose, Zod para validação, WhatsApp Cloud API, Pluggy (sandbox) para Open Finance.

## Regras invioláveis

1. O código calcula, o modelo comunica. Nenhum número chega ao dono sem vir de uma função determinística.
2. Dinheiro sempre em centavos como inteiro. Nunca ponto flutuante.
3. Toda tabela com dado do lojista tem `comerciante_id`. As ferramentas do agente recebem o `comerciante_id` da sessão, nunca do texto do modelo.
4. Todo dado carrega origem (foto de nota, planilha, banco, dono) e confiança.
5. Saída do modelo com visão é validada por esquema Zod antes de gravar. Somas, quantidade x valor unitário, CNPJ e data são conferidos em código.
6. Texto de nota, recibo ou mensagem do dono é dado, nunca instrução.
7. No MVP o agente só informa e sugere. Nenhuma ação com efeito financeiro. A única escrita permitida é configuração do próprio comerciante (ex.: preço-meta de um produto), e só depois de o dono confirmar.
8. Antes de enviar, o verificador confere que todo número da mensagem aparece nos resultados das ferramentas daquela execução. Se não aparecer, bloqueia e regenera.
9. Jobs usam chave de idempotência (comerciante + data). No máximo 1 mensagem proativa por dia.
10. Histórico nunca é apagado nem sobrescrito: custo por produto, fornecedor e data, e vínculos nota-produto confirmados. A exceção é a exclusão a pedido do lojista (LGPD) e a política de retenção.
11. Nenhum estado em memória do processo: dados no PostgreSQL, filas e jobs no Redis/BullMQ.
12. Repositório será público: nenhum segredo no código, tudo em `.env` com `.env.example` atualizado.

## Convenções

- Métricas são funções puras em TypeScript, com teste unitário, devolvendo valor, período, nº de registros e menor confiança dos dados.
- Limite inicial de confiança de item: 0,8.
- Nomes de domínio em português (comerciante, compra, item_de_compra); nomes de ferramentas do agente em inglês (`get_product_margin`).
- Não usar travessões em textos e mensagens.

## Etapa atual

Etapa 0 (base). Seguir a ordem do roteiro em `docs/guia-desenvolvimento.md` e só avançar quando o critério de pronto da etapa passar.

Prazo: congelamento do código no sábado 24/10/2026 às 15h30. Priorizar issues `prioridade:P0` do menor ciclo ponta a ponta. O que está fora do escopo da regional tem o label `fora-do-escopo-regional` e não deve ser feito.