#!/bin/bash
# deploy-prod.sh — deploy eloso-bisque to production (https://eloso-bisque.vercel.app)
#
# ALWAYS use this script (or `vercel --prod`) to deploy.
# NEVER use `vercel` alone — that creates a preview URL, not production.

set -e

PROJ_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJ_DIR"

echo "Deploying eloso-bisque to production..."
echo "Project dir: $PROJ_DIR"
echo ""

vercel --prod --yes

echo ""
echo "Deployed to https://eloso-bisque.vercel.app"
