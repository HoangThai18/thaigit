# Cách thay thế systemd: chạy API trong container. Build từ GỐC repo:
#   docker build -f server/Dockerfile -t thaigit-api .
FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY packages/contracts/package.json packages/contracts/
COPY server/package.json server/
RUN pnpm install --frozen-lockfile --filter @thaigit/server... --prod

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 ADMIN_HOST=0.0.0.0 ADMIN_PORT=8788 DATA_DIR=/data
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=deps /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY packages/contracts ./packages/contracts
COPY server/src ./server/src
COPY server/package.json ./server/
RUN mkdir -p /data && chown node:node /data
USER node
WORKDIR /app/server
EXPOSE 8787
STOPSIGNAL SIGTERM
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.ts"]
