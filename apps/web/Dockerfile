FROM node:24-alpine AS build

WORKDIR /app
RUN corepack enable

ARG PUBLIC_WEB_URL=http://localhost:3000
ARG PUBLIC_API_BASE=http://localhost:4000/api/v1
ENV PUBLIC_WEB_URL=$PUBLIC_WEB_URL
ENV PUBLIC_API_BASE=$PUBLIC_API_BASE

# Frontend Sentry (DSN-driven): when SENTRY_DSN is passed the build injects the
# self-hosted SDK + config; empty by default -> no Sentry in the output.
ARG SENTRY_DSN=
ARG SENTRY_RELEASE=
ARG SENTRY_ENVIRONMENT=production
ARG SENTRY_TRACES_SAMPLE_RATE=0
ENV SENTRY_DSN=$SENTRY_DSN
ENV SENTRY_RELEASE=$SENTRY_RELEASE
ENV SENTRY_ENVIRONMENT=$SENTRY_ENVIRONMENT
ENV SENTRY_TRACES_SAMPLE_RATE=$SENTRY_TRACES_SAMPLE_RATE

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

COPY apps/web apps/web
RUN pnpm --filter @cofind/web build

FROM nginx:1.27-alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
