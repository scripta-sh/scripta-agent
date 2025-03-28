#!/bin/bash

# Colors for prettier output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

echo "==========================================="
echo "  Scripta Agent API Test Script           "
echo "==========================================="

# Check if API server is running
echo -e "\nChecking if API server is running..."
if ! curl -s http://localhost:3000/ > /dev/null; then
  echo "API server is not running!"
  echo "Please start it with: NODE_ENV=development tsx ./src/entrypoints/api.ts"
  exit 1
else
  echo "API server is running!"
fi

# Run the API test
echo -e "\nRunning API tests..."
NODE_ENV=development tsx ./src/tests/api-test.ts

echo "==========================================="
echo "  Test Script Complete                    "
echo "===========================================
