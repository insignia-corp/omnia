# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./

# Desenvolvimento: todas as dependências, código montado por volume no compose.
FROM base AS dev
RUN npm ci
COPY . .
CMD ["sh", "-c", "npm run db:migrate && npm run dev"]

FROM base AS build
RUN npm ci
COPY . .
RUN npm run build

# Produção: só dependências de execução e o código compilado.
FROM base AS producao
ENV NODE_ENV=production
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
# Front do WhatsApp simulado, servido pelo Nest em /whatsapp (sem build; os testes ficam de fora).
COPY web/whatsapp/*.html web/whatsapp/*.css web/whatsapp/*.js ./web/whatsapp/
# Fotos e planilhas enviadas ficam num volume, fora do código.
RUN mkdir -p /dados/arquivos && chown -R node:node /dados
USER node
EXPOSE 3000
CMD ["sh", "-c", "node dist/infra/database/migrar.js && node dist/main.js"]
