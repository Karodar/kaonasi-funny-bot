# Build stage
FROM node:18-slim AS builder
WORKDIR /app

# Install build dependencies
COPY package.json package-lock.json* ./
RUN npm ci --silent --no-audit || npm install --no-audit

COPY tsconfig.json ./
COPY src ./src
COPY .env.example ./

RUN npm run build

# Runtime stage
FROM node:18-slim
WORKDIR /app

ENV NODE_ENV=production

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
COPY .env.example ./

# Ensure data directory exists
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "dist/index.js"]
