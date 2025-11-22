# Builder stage with build deps for native modules
FROM node:18-slim AS builder
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

# Copy package manifests
COPY package.json package-lock.json* ./

# Ensure we don't rely on a stale lockfile inside the image; install according to package.json
RUN rm -f package-lock.json || true
RUN npm install --unsafe-perm --no-audit --no-package-lock --progress=false

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime image
FROM node:18-slim
WORKDIR /app
ENV NODE_ENV=production

# Copy runtime artifacts and node_modules from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# ensure data folder exists
RUN mkdir -p /app/data

EXPOSE 3000
CMD ["node", "dist/index.js"]