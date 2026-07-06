/**
 * Decode a base64 zip (from the `memory.export` tRPC procedure) into a Blob and
 * trigger a browser download (WP3 T8). Kept as a standalone helper so the
 * navigator's mutation handler stays small and this DOM plumbing is unit-testable.
 */
export function downloadBase64Zip(zipBase64: string, fileName: string): void {
  const binary = atob(zipBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
