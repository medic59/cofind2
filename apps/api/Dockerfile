FROM node:24-alpine AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
RUN pnpm --filter @cofind/api prisma:generate
RUN pnpm --filter @cofind/api build

FROM node:24-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

COPY --from=build /app /app
WORKDIR /app/apps/api

EXPOSE 4000
CMD ["pnpm", "start"]
