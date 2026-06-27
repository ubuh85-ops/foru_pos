FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile
COPY apps/web ./apps/web
RUN pnpm --filter web build

FROM nginx:1.27-alpine AS runner
COPY deploy/nginx-web.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
