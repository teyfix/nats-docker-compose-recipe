#!/bin/sh
set -e

MISSING_ENV="Missing environment variable"

: "${NATS_OPERATOR:?$MISSING_ENV}" # e.g., MY_OPERATOR
: "${NATS_ACCOUNT:?$MISSING_ENV}"  # e.g., MY_API_ACCOUNT

OPERATOR_DIR="/nsc/nats/nsc/stores/$NATS_OPERATOR"

if [ -d "$OPERATOR_DIR" ]; then
  echo "NATS operator already initialized for $NATS_OPERATOR"
  exit 0
else
  nsc add operator --generate-signing-key --sys --name $NATS_OPERATOR
  nsc edit operator --require-signing-keys --account-jwt-server-url "nats://nats.lokal:4222"
  nsc add account $NATS_ACCOUNT
  nsc edit account $NATS_ACCOUNT --sk generate

  nsc generate config --nats-resolver --sys-account SYS > /config/resolver.conf
fi
