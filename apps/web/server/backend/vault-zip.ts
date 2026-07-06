import JSZip from 'jszip';

/**
 * Pack an exported vault (`relativePath → content`) into a base64 zip (WP3 T8).
 * Runs server-side in the tRPC `memory.export` procedure; the client decodes the
 * base64 and triggers a browser download. Base64 keeps the payload JSON-safe
 * (tRPC has no binary channel) at the cost of ~33% wire overhead — acceptable for
 * dashboard-scale vaults; the CLI covers very large exports.
 */
export async function buildVaultZipBase64(files: Record<string, string>): Promise<string> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: 'base64' });
}
