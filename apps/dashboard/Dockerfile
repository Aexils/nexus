# ── Build stage ─────────────────────────────────────────────────────────────
FROM node:22 AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npx nx build dashboard --configuration=production

# ── Runtime stage (nginx) ────────────────────────────────────────────────────
FROM nginx:alpine

COPY --from=builder /app/dist/apps/dashboard/browser /usr/share/nginx/html
COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
