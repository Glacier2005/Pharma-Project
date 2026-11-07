#!/bin/sh
set -e

echo "Applying database schema..."
node scripts/migrate-deploy.cjs

echo "Starting PharmaDash API..."
exec node dist/index.js
