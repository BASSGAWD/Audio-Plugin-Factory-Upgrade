import crypto from "node:crypto";

type SignedReport = Record<string, unknown> & {
  attestation?: {
    algorithm: "Ed25519";
    publicKeySha256: string;
    signature: string;
  };
};

function payloadBytes(report: SignedReport): Buffer {
  const { attestation: _attestation, ...payload } = report;
  return Buffer.from(JSON.stringify(payload));
}

function publicKeyFingerprint(key: crypto.KeyObject): string {
  const der = key.export({ type: "spki", format: "der" });
  return crypto.createHash("sha256").update(der).digest("hex");
}

export function signLatencyReport(report: SignedReport, privateKeyPem: string): SignedReport {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Latency signing key must be Ed25519");
  const publicKey = crypto.createPublicKey(privateKey);
  return {
    ...report,
    attestation: {
      algorithm: "Ed25519",
      publicKeySha256: publicKeyFingerprint(publicKey),
      signature: crypto.sign(null, payloadBytes(report), privateKey).toString("base64"),
    },
  };
}

export function verifyLatencyReport(report: SignedReport, publicKeyPem: string): boolean {
  if (report.attestation?.algorithm !== "Ed25519" || !report.attestation.signature) return false;
  const publicKey = crypto.createPublicKey(publicKeyPem);
  if (publicKey.asymmetricKeyType !== "ed25519"
      || report.attestation.publicKeySha256 !== publicKeyFingerprint(publicKey)) return false;
  return crypto.verify(
    null,
    payloadBytes(report),
    publicKey,
    Buffer.from(report.attestation.signature, "base64"),
  );
}