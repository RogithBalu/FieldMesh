import { execSync } from "node:child_process";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LightsailClient,
  CreateInstancesCommand,
  OpenInstancePublicPortsCommand,
  AllocateStaticIpCommand,
  AttachStaticIpCommand,
  GetInstanceCommand,
  GetStaticIpCommand,
} from "@aws-sdk/client-lightsail";
import {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, "..");

const REGION = process.env.AWS_REGION || "us-east-1";
const INSTANCE_NAME = process.env.LIGHTSAIL_INSTANCE_NAME || "fieldmesh-server";
const STATIC_IP_NAME = process.env.LIGHTSAIL_STATIC_IP || "fieldmesh-static-ip";
const BUNDLE_ID = process.env.LIGHTSAIL_BUNDLE_ID || "micro_3_0"; // 1GB RAM, 40GB SSD
const BLUEPRINT_ID = "ubuntu_22_04";
const S3_BUCKET_NAME = `fieldmesh-deploy-${Date.now()}`;

console.log("========================================================================");
console.log("  FieldMesh AWS Lightsail Deployment");
console.log("========================================================================");
console.log(`Region:        ${REGION}`);
console.log(`Instance Name: ${INSTANCE_NAME}`);
console.log(`Plan:          ${BUNDLE_ID}`);
console.log(`OS:            ${BLUEPRINT_ID}`);

async function main() {
  // 1. Package the project into a tarball
  console.log("\n[1/5] Packaging codebase bundle...");
  const tarPath = resolve(rootDir, "deploy-bundle.tar.gz");
  if (existsSync(tarPath)) unlinkSync(tarPath);

  execSync(
    `tar --exclude="node_modules" --exclude="dist" --exclude=".git" --exclude="data" --exclude="docs" --exclude="deploy-bundle.tar.gz" -czf deploy-bundle.tar.gz .`,
    { cwd: rootDir, stdio: "inherit" }
  );

  const bundleBuffer = readFileSync(tarPath);
  unlinkSync(tarPath);
  console.log(`Bundle created: ${(bundleBuffer.length / 1024).toFixed(1)} KB`);

  // 2. Upload bundle to S3 and get pre-signed download URL
  console.log("\n[2/5] Uploading deployment bundle to S3 staging bucket...");
  const s3 = new S3Client({ region: REGION });
  try {
    await s3.send(new CreateBucketCommand({ Bucket: S3_BUCKET_NAME }));
  } catch (err) {
    if (err.name !== "BucketAlreadyOwnedByYou" && err.name !== "BucketAlreadyExists") {
      throw err;
    }
  }

  const bundleKey = "fieldmesh-bundle.tar.gz";
  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: bundleKey,
      Body: bundleBuffer,
      ContentType: "application/gzip",
    })
  );

  const presignedUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: S3_BUCKET_NAME, Key: bundleKey }),
    { expiresIn: 7200 } // 2 hours validity
  );
  console.log("Staging upload complete. Presigned download URL generated.");

  // 3. Build cloud-init startup script (compact, ~1 KB)
  const userData = `#!/bin/bash
set -e
exec > /var/log/fieldmesh-deploy.log 2>&1
echo "=== Starting FieldMesh Setup at $(date) ==="

# Setup 2GB swap space for compilation headroom
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo "/swapfile swap swap defaults 0 0" >> /etc/fstab
fi

# Install Docker
apt-get update
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Setup project directory
mkdir -p /opt/fieldmesh/data/uploads
cd /opt/fieldmesh

# Download and unpack bundle
echo "Downloading deployment bundle from S3..."
curl -fsSL "${presignedUrl}" -o /opt/fieldmesh/bundle.tar.gz
tar -xzf /opt/fieldmesh/bundle.tar.gz -C /opt/fieldmesh
rm -f /opt/fieldmesh/bundle.tar.gz

# Build and start container
echo "Building and launching Docker containers..."
docker compose up -d --build

echo "=== FieldMesh Container Started Successfully at $(date) ==="
`;

  // 4. Initialize Lightsail Client
  const lightsail = new LightsailClient({ region: REGION });

  console.log("\n[3/5] Provisioning Lightsail instance...");
  let instanceExists = false;
  try {
    const res = await lightsail.send(new GetInstanceCommand({ instanceName: INSTANCE_NAME }));
    if (res.instance) {
      instanceExists = true;
      console.log(`Instance "${INSTANCE_NAME}" already exists (state: ${res.instance.state?.name}).`);
    }
  } catch (err) {
    if (err.name !== "NotFoundException") {
      throw err;
    }
  }

  if (!instanceExists) {
    console.log(`Creating Lightsail instance "${INSTANCE_NAME}" in ${REGION}a...`);
    await lightsail.send(
      new CreateInstancesCommand({
        instanceNames: [INSTANCE_NAME],
        availabilityZone: `${REGION}a`,
        blueprintId: BLUEPRINT_ID,
        bundleId: BUNDLE_ID,
        userData,
      })
    );
    console.log("Instance creation requested. Waiting for instance to become active...");

    // Poll until running
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 6000));
      const statusRes = await lightsail.send(new GetInstanceCommand({ instanceName: INSTANCE_NAME }));
      const state = statusRes.instance?.state?.name;
      console.log(`  - Instance state: ${state}...`);
      if (state === "running") break;
    }
  }

  // 5. Open Firewall Ports
  console.log("\n[4/5] Configuring firewall rules...");
  const portsToOpen = [
    { fromPort: 3000, toPort: 3000, protocol: "tcp" }, // Fastify REST + Tus
    { fromPort: 1234, toPort: 1234, protocol: "tcp" }, // Hocuspocus WebSocket sync
  ];

  for (const portInfo of portsToOpen) {
    try {
      await lightsail.send(
        new OpenInstancePublicPortsCommand({
          instanceName: INSTANCE_NAME,
          portInfo,
        })
      );
      console.log(`  - Opened TCP port ${portInfo.fromPort}`);
    } catch (e) {
      console.log(`  - Port ${portInfo.fromPort} status: ${e.message}`);
    }
  }

  // 6. Static IP allocation & attachment
  console.log("\n[5/5] Configuring static public IP...");
  let staticIp = "";
  try {
    const ipRes = await lightsail.send(new GetStaticIpCommand({ staticIpName: STATIC_IP_NAME }));
    staticIp = ipRes.staticIp?.ipAddress || "";
    console.log(`Static IP "${STATIC_IP_NAME}" found: ${staticIp}`);
  } catch (err) {
    if (err.name === "NotFoundException") {
      console.log(`Allocating new static IP "${STATIC_IP_NAME}"...`);
      await lightsail.send(new AllocateStaticIpCommand({ staticIpName: STATIC_IP_NAME }));
      const ipRes = await lightsail.send(new GetStaticIpCommand({ staticIpName: STATIC_IP_NAME }));
      staticIp = ipRes.staticIp?.ipAddress || "";
      console.log(`Allocated static IP: ${staticIp}`);
    } else {
      throw err;
    }
  }

  try {
    await lightsail.send(
      new AttachStaticIpCommand({
        staticIpName: STATIC_IP_NAME,
        instanceName: INSTANCE_NAME,
      })
    );
    console.log(`Attached static IP ${staticIp} to ${INSTANCE_NAME}.`);
  } catch (e) {
    console.log(`Static IP attachment note: ${e.message}`);
  }

  console.log("\n========================================================================");
  console.log("  FIELDMESH DEPLOYED TO AWS LIGHTSAIL SUCCESSFULLY!");
  console.log("========================================================================");
  console.log(`Static Public IP:  ${staticIp}`);
  console.log(`REST Health Check: http://${staticIp}:3000/health`);
  console.log(`REST API Base:     http://${staticIp}:3000`);
  console.log(`WebSocket Sync:    ws://${staticIp}:1234`);
  console.log("========================================================================");
  console.log("Docker installation and container build will complete in ~2-3 minutes.");
  console.log("You can monitor live startup via:");
  console.log(`  curl http://${staticIp}:3000/health`);
  console.log("========================================================================");
}

main().catch((err) => {
  console.error("\nDeployment failed:", err);
  process.exit(1);
});
