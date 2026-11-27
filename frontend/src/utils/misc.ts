/** Tiny className joiner. */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** Triggers a browser download for a Blob. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
export const ALLOWED_RECEIPT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

/** Client-side receipt check (the server re-checks magic bytes). Returns an error message or null. */
export function validateReceiptFile(file: File): string | null {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  const typeOk = (ALLOWED_RECEIPT_TYPES as readonly string[]).includes(file.type) || ['pdf', 'jpg', 'jpeg', 'png'].includes(ext);
  if (!typeOk) return 'Only PDF, JPG or PNG files are allowed.';
  if (file.size > MAX_RECEIPT_BYTES) return `File is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 5 MB.`;
  if (file.size === 0) return 'File is empty.';
  return null;
}

export function formatBytes(n: number | null | undefined): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}
