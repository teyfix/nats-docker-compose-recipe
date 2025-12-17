#!/bin/sh
set -e

echo "=== NATS Signing Keys ==="
echo
echo "Store these in your .env file:"
echo

export_keys() {
  kind="$1"
  name="$2"

  sub_desc="$(nsc describe "$kind" --name "$name" --json)"
  sub_key="$(echo "$sub_desc" | jq -r '.sub')"
  sub_secret="$(echo "$sub_desc" | jq -r '.nats.signing_keys[0]' | xargs -I% find /nsc/nkeys -name '%.nk' -exec cat {} \;)"

  : "${sub_key:?Unable to extract $kind key for $name}"
  : "${sub_secret:?Unable to extract $kind secret for $name}"

  kind_upper="$(echo $kind | tr 'a-z' 'A-Z')"

  echo "NATS_${kind_upper}_KEY=\"$sub_key\"" > /secrets/.env.$kind
  echo "NATS_${kind_upper}_SECRET=\"$sub_secret\"" >> /secrets/.env.$kind

  echo "Exported $kind keys to ./fs/nats-export/secrets/.env.$kind"
}

###################################################
# CAUTION                                         #
# Exporting operator keys is not recommended!     #
#                                                 #
###################################################
# export_keys "operator" "$NATS_OPERATOR"

export_keys "account" "$NATS_ACCOUNT"
