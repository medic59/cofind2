FROM node:24-alpine AS build

WORKDIR /app
RUN corepack enable

ARG PUBLIC_WEB_URL=http://localhost:3000
ARG PUBLIC_API_BASE=http://localhost:4000/api/v1
ENV PUBLIC_WEB_URL=$PUBLIC_WEB_URL
ENV PUBLIC_API_BASE=$PUBLIC_API_BASE

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

COPY apps/web apps/web
RUN pnpm --filter @cofind/web build

FROM nginx:1.27-alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
