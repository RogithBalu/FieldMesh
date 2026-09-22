#!/usr/bin/env bash
# Redeploys the CURRENT backend code to the existing Lightsail instance over SSH
# (the deploy-lightsail.mjs script only provisions; it does not push new code to
# an instance that already exists). Keeps data/uploads, moves the old-schema DB
# aside (data/backup-<ts>/), rebuilds the Docker image and restarts the container.
#
#   cd Backend && set -a && source .env && set +a && ./scripts/redeploy-lightsail.sh
#
# Requires: aws CLI with the account's credentials in the environment, ssh, scp.
set -euo pipefail
cd "$(dirname "$0")/.."
INSTANCE="${LIGHTSAIL_INSTANCE_NAME:-fieldmesh-server}"
REGION="${AWS_REGION:-us-east-1}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

echo "[1/4] fetching SSH access for $INSTANCE ($REGION)"
aws lightsail get-instance-access-details --instance-name "$INSTANCE" --protocol ssh --region "$REGION" --output json > "$WORK/access.json"
python3 - "$WORK" <<'PY'
import json, sys, os
d = sys.argv[1]; j = json.load(open(f"{d}/access.json"))["accessDetails"]
open(f"{d}/key", "w").write(j["privateKey"]); os.chmod(f"{d}/key", 0o600)
open(f"{d}/key-cert.pub", "w").write(j["certKey"])
open(f"{d}/target", "w").write(f'{j["username"]}@{j["ipAddress"]}')
PY
TARGET="$(cat "$WORK/target")"
SSH=(ssh -i "$WORK/key" -o CertificateFile="$WORK/key-cert.pub" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20)

echo "[2/4] bundling code (no node_modules, dist, data, .env)"
tar --exclude='node_modules' --exclude='dist' --exclude='.git' --exclude='data' --exclude='docs' --exclude='.env' --exclude='*/.env' --exclude='*.log' \
  -czf "$WORK/bundle.tgz" shared server patches package.json pnpm-lock.yaml pnpm-workspace.yaml Dockerfile docker-compose.yml .dockerignore .nvmrc README.md scripts
JWT_SECRET_VALUE="$(openssl rand -hex 32)"

echo "[3/4] uploading to $TARGET"
scp -i "$WORK/key" -o CertificateFile="$WORK/key-cert.pub" -o StrictHostKeyChecking=accept-new "$WORK/bundle.tgz" "$TARGET:/tmp/fieldmesh-bundle.tgz"

echo "[4/4] rebuilding container (this takes a few minutes on a 1 GB instance)"
"${SSH[@]}" "$TARGET" "sudo bash -s" <<EOS
set -euo pipefail
TS=\$(date +%Y%m%d-%H%M%S)
cd /opt/fieldmesh
mkdir -p /opt/fieldmesh-backups
tar --exclude=data --exclude=node_modules -czf /opt/fieldmesh-backups/code-\$TS.tgz . || true
docker compose down || true
rm -rf server/src shared/src scripts patches
tar -xzf /tmp/fieldmesh-bundle.tgz -C /opt/fieldmesh && rm -f /tmp/fieldmesh-bundle.tgz
mkdir -p data/uploads data/backup-\$TS
mv data/fieldmesh.db data/fieldmesh.db-wal data/fieldmesh.db-shm data/backup-\$TS/ 2>/dev/null || true
[ -f /opt/fieldmesh/.env ] || { printf 'JWT_SECRET=%s\n' '${JWT_SECRET_VALUE}' > /opt/fieldmesh/.env; chmod 600 /opt/fieldmesh/.env; }
docker compose up -d --build
for i in \$(seq 1 90); do curl -sf http://localhost:3000/health >/dev/null && { echo "healthy after \$i checks"; break; }; sleep 2; done
curl -s http://localhost:3000/health; echo
docker image prune -f >/dev/null 2>&1 || true
EOS
IP="${TARGET#*@}"
echo "done. verify from here:  curl http://$IP:3000/health"
echo "full contract check:     cd server && BASE=http://$IP:3000 WS=ws://$IP:1234 pnpm test:endpoints"
