import { createHash } from "node:crypto";
import { Server as TusServer } from "@tus/server";
import { FileStore } from "@tus/file-store";
import { db } from "../db/index.js";
import { config } from "../config.js";
import { log } from "../utils/logger.js";

/**
 * Resumable photo upload endpoint.
 *
 * Contract with the client: send these as tus upload metadata (`Upload-Metadata`
 * header, tus-encoded — each value base64 of the plain string) when creating the
 * upload:
 *   - hash          hex-encoded SHA-256 of the file, computed on-device before upload
 *   - inspectionId  the inspection this photo belongs to
 *   - uploadedBy    user id of the uploader
 *
 * The server re-hashes the completed file and rejects the upload if it doesn't
 * match what the client claimed (tamper/corruption evidence, and it's what makes
 * the hash trustworthy as a dedupe key elsewhere, e.g. HEAD /photos/:hash).
 */

const datastore = new FileStore({ directory: config.uploadsDir });

export const tusServer = new TusServer({
  path: "/uploads",
  datastore,
  async onUploadFinish(_req, res, upload) {
    const claimedHash = upload.metadata?.hash;
    const inspectionId = upload.metadata?.inspectionId;
    const uploadedBy = upload.metadata?.uploadedBy;

    if (!claimedHash || !inspectionId || !uploadedBy) {
      throw {
        status_code: 400,
        body: "Missing required upload metadata: hash, inspectionId, uploadedBy",
      };
    }

    // Dedupe: if this hash is already stored, don't re-verify/re-insert.
    const existing = db
      .prepare("SELECT 1 FROM photos WHERE hash = ?")
      .get(claimedHash);
    if (existing) {
      log.info(`Photo ${claimedHash} already exists, skipping re-verify`);
      return { res };
    }

    // Re-hash the file the datastore actually wrote to disk. Never trust the
    // client's claimed hash without checking it against the bytes that landed.
    const actualHash = await hashUpload(upload.id);

    if (actualHash !== claimedHash) {
      log.err(
        `Hash mismatch for upload ${upload.id}: claimed ${claimedHash}, actual ${actualHash}`
      );
      throw {
        status_code: 460, // non-standard; tus clients still get body+status
        body: "Checksum mismatch: uploaded bytes do not match the claimed hash",
      };
    }

    db.prepare(
      `INSERT INTO photos (hash, inspection_id, storage_key, size, uploaded_by, verified_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      actualHash,
      inspectionId,
      upload.id,
      upload.size ?? 0,
      uploadedBy,
      Date.now()
    );

    log.info(`Photo verified and stored: ${actualHash} (inspection ${inspectionId})`);
    return { res };
  },
});

function hashUpload(uploadId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = datastore.read(uploadId);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}
