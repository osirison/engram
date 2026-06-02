FROM node:22-bookworm-slim

WORKDIR /workspace

COPY . .

RUN npm exec --yes pnpm@11.4.0 -- install --frozen-lockfile
RUN npm exec --yes pnpm@11.4.0 -- db:generate
RUN npm exec --yes pnpm@11.4.0 -- build

EXPOSE 3000

CMD ["sh", "-c", "npm exec --yes pnpm@11.4.0 -- db:migrate:deploy && node apps/mcp-server/dist/main.js"]
