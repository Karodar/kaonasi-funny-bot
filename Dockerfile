# Use bun base images to run and build with bun
FROM oven/bun:latest AS builder
WORKDIR /app

# Install system dependencies required to build native modules (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
  python3 \
  make \
  g++ \
  build-essential \
  ca-certificates \
  libsqlite3-dev \
  && rm -rf /var/lib/apt/lists/*

# Copy package manifest and install dependencies with bun
COPY package.json ./
RUN bun install

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN bun run build

# Runtime image
FROM oven/bun:latest
WORKDIR /app
ENV NODE_ENV=production

# Copy runtime artifacts and node_modules from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# ensure data folder exists
RUN mkdir -p /app/data

EXPOSE 3000
CMD ["bun", "./dist/index.js"]