import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret",
  jwtExpiry: process.env.JWT_EXPIRY ?? "30d",
  databaseUrl: process.env.DATABASE_URL ?? "./data/fieldmesh.db",
  uploadsDir: process.env.UPLOADS_DIR ?? "./data/uploads",
  s3: {
    endpoint: process.env.S3_ENDPOINT ?? "",
    region: process.env.S3_REGION ?? "",
    bucket: process.env.S3_BUCKET ?? "",
    accessKey: process.env.S3_ACCESS_KEY ?? "",
    secretKey: process.env.S3_SECRET_KEY ?? "",
  },
};
