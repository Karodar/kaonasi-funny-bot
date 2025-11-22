# Builder + runtime using bun
FROM oven/bun:latest AS builder
WORKDIR /app

# Copy package manifest and install deps with bun
COPY package.json tsconfig.json ./
RUN bun install

# Copy source and build
COPY src ./src
RUN bun run build

FROM oven/bun:latest AS runtime
WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

RUN mkdir -p /app/data

EXPOSE 3000
CMD ["bun", "./dist/index.js"]