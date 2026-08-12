#!/usr/bin/env sh

set -eu

# Runs after PostgreSQL's health check, so it also works with an existing
# Compose volume created before the Notification Service database was added.
if psql -h postgres -U trams -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname = 'trams_notifications'" | grep -q 1; then
  echo "Notification Service database already exists"
  exit 0
fi

psql -h postgres -U trams -d postgres -c "CREATE DATABASE trams_notifications"
echo "Created Notification Service database"
