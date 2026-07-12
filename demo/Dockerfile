# Builds the walcast daemon from the workspace, with the official sinks
# installed — the image behind `docker compose up`.
FROM node:22-slim AS build
RUN corepack enable pnpm
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY proto ./proto
COPY examples ./examples
# Present only so the frozen lockfile's importer list matches the workspace.
COPY docs/package.json ./docs/package.json
COPY bench/package.json ./bench/package.json
RUN pnpm install --frozen-lockfile --filter '!@walcast/docs' \
  && pnpm --filter walcast --filter '@walcast/plugin-kit' --filter '@walcast/sink-webhook' \
          --filter '@walcast/sink-sse' --filter '@walcast/sink-kafka' --filter '@walcast/ui' build

FROM node:22-slim
WORKDIR /repo
COPY --from=build /repo /repo
WORKDIR /repo/packages/integration-tests
EXPOSE 7717
CMD ["node", "../walcast/dist/cli.js", "serve", "--config", "/demo/walcast.config.json"]
