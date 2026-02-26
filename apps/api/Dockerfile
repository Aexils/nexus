# ── Build stage ─────────────────────────────────────────────────────────────
FROM node:22 AS builder
WORKDIR /app

# Install deps first (better layer cache)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build the API
COPY . .
RUN npx nx build api --configuration=production

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

# Nx generates a package.json in dist (generatePackageJson: true) — install prod deps
COPY --from=builder /app/dist/apps/api ./
RUN npm ci --only=production

EXPOSE 3000
CMD ["node", "main.js"]
