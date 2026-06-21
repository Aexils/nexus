#!/usr/bin/env bash
set -e

echo "▶ Build API..."
npx nx build api --configuration=production

echo "▶ Build Dashboard..."
npx nx build dashboard --configuration=production

echo "▶ Docker compose up..."
docker compose -f docker-compose.yml -f docker-compose.prebuilt.yml up -d --build

echo "✓ Déployé."
