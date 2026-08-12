FROM node:22-bookworm-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api-gateway/package.json apps/api-gateway/package.json
COPY apps/notification-service/package.json apps/notification-service/package.json
COPY apps/user-service/package.json apps/user-service/package.json
COPY libs/contracts/package.json libs/contracts/package.json
COPY libs/messaging/package.json libs/messaging/package.json
RUN npm ci

FROM dependencies AS build

COPY . .
# Prisma needs a URL while generating the client, but does not contact the
# database during generation. The runtime URL is supplied by Compose instead.
RUN DATABASE_URL=postgresql://trams:trams@postgres:5432/trams?schema=public \
    NOTIFICATION_DATABASE_URL=postgresql://trams:trams@postgres:5432/trams_notifications?schema=public \
    npm run prisma:generate && npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps ./apps
COPY --from=build /app/libs ./libs
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts

USER node
