import { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileX,
  Maximize2,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { ApiError } from '@/api/client';
import { receiptPath } from '@/api/claims';
import { IconButton } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Display';
import { useAuthedBlob } from '@/hooks';
import { cn } from '@/utils/misc';

export interface ReceiptRef {
  lineId: number;
  receiptId: number | null;
  label: string;
}

interface ReceiptViewerProps {
  receipts: ReceiptRef[];
  index: number;
  onIndexChange?: (i: number) => void;
  className?: string;
  /** Height of the viewing area. */
  heightClass?: string;
  testId?: string;
}

/**
 * Authenticated receipt viewer (image or PDF) with zoom, rotate, prev/next and download.
 * The file is fetched with the bearer token and rendered from an object URL.
 */
export function ReceiptViewer({
  receipts,
  index,
  onIndexChange,
  className,
  heightClass = 'h-[60vh]',
  testId = 'receipt-viewer',
}: ReceiptViewerProps) {
  const current = receipts[index];
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const blob = useAuthedBlob(current?.receiptId ? receiptPath(current.receiptId) : null);

  useEffect(() => {
    setZoom(1);
    setRotation(0);
  }, [current?.receiptId]);

  const isPdf = blob.contentType === 'application/pdf' || blob.fileName?.toLowerCase().endsWith('.pdf');
  const total = receipts.length;
  const fileName = blob.fileName ?? `receipt-${current?.receiptId ?? ''}`;

  const body = (fs: boolean) => {
    if (!current) {
      return <Placeholder text="This claim has no lines." />;
    }
    if (!current.receiptId) {
      return <Placeholder text={`No receipt attached to ${current.label}.`} testId={`${testId}-missing`} />;
    }
    if (blob.loading) return <Skeleton className="h-full w-full" />;
    if (blob.error) {
      const notFound = blob.error instanceof ApiError && blob.error.isNotFound;
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-slate-700" data-testid={`${testId}-error`}>
          <FileX className="h-10 w-10 text-slate-500" aria-hidden />
          <p>{notFound ? 'Receipt not found.' : 'The receipt could not be loaded.'}</p>
          {!notFound && (
            <button type="button" onClick={blob.reload} className="font-medium text-indigo-700 underline">
              Retry
            </button>
          )}
        </div>
      );
    }
    if (!blob.url) return null;
    if (isPdf) {
      return (
        <object data={blob.url} type="application/pdf" className="h-full w-full" aria-label={`Receipt for ${current.label}`}>
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-sm text-slate-700">
            <p>PDF preview is not available in this browser.</p>
            <a href={blob.url} download={fileName} className="font-medium text-indigo-700 underline">
              Download the PDF
            </a>
          </div>
        </object>
      );
    }
    return (
      <div className="flex h-full w-full items-center justify-center overflow-auto">
        <img
          src={blob.url}
          alt={`Receipt for ${current.label}`}
          onClick={() => !fs && setFullscreen(true)}
          className={cn('max-h-full max-w-full origin-center object-contain transition-transform', !fs && 'cursor-zoom-in')}
          style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
          data-testid={`${testId}-image`}
        />
      </div>
    );
  };

  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-1 border-b border-slate-200 bg-white px-2 py-1">
      <div className="flex items-center gap-1">
        <IconButton
          label="Previous receipt"
          disabled={index <= 0}
          onClick={() => onIndexChange?.(index - 1)}
          testId={`${testId}-prev`}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </IconButton>
        <span className="min-w-[3.5rem] text-center text-xs font-medium tabular-nums text-slate-700" aria-live="polite">
          {total === 0 ? '0/0' : `${index + 1}/${total}`}
        </span>
        <IconButton
          label="Next receipt"
          disabled={index >= total - 1}
          onClick={() => onIndexChange?.(index + 1)}
          testId={`${testId}-next`}
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </IconButton>
      </div>
      <span className="hidden min-w-0 flex-1 truncate px-2 text-xs text-slate-600 sm:block">{current?.label}</span>
      <div className="flex items-center gap-1">
        <IconButton label="Zoom out" disabled={isPdf || zoom <= 0.5} onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} testId={`${testId}-zoom-out`}>
          <ZoomOut className="h-4 w-4" aria-hidden />
        </IconButton>
        <IconButton label="Zoom in" disabled={isPdf || zoom >= 3} onClick={() => setZoom((z) => Math.min(3, z + 0.25))} testId={`${testId}-zoom-in`}>
          <ZoomIn className="h-4 w-4" aria-hidden />
        </IconButton>
        <IconButton label="Rotate 90°" disabled={isPdf} onClick={() => setRotation((r) => (r + 90) % 360)} testId={`${testId}-rotate`}>
          <RotateCw className="h-4 w-4" aria-hidden />
        </IconButton>
        <IconButton label="Full screen" disabled={!blob.url} onClick={() => setFullscreen(true)} testId={`${testId}-fullscreen`}>
          <Maximize2 className="h-4 w-4" aria-hidden />
        </IconButton>
        {blob.url && (
          <a
            href={blob.url}
            download={fileName}
            aria-label="Download receipt"
            title="Download receipt"
            data-testid={`${testId}-download`}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
          >
            <Download className="h-4 w-4" aria-hidden />
          </a>
        )}
      </div>
    </div>
  );

  return (
    <div className={cn('flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-100', className)} data-testid={testId}>
      {toolbar}
      <div className={cn('relative', heightClass)}>{body(false)}</div>
      <Modal open={fullscreen} onClose={() => setFullscreen(false)} title={current?.label ?? 'Receipt'} size="xl" testId={`${testId}-modal`}>
        <div className="h-[75vh] bg-slate-100">{body(true)}</div>
      </Modal>
    </div>
  );
}

function Placeholder({ text, testId }: { text: string; testId?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-slate-600" data-testid={testId}>
      <FileX className="h-10 w-10 text-slate-400" aria-hidden />
      <p>{text}</p>
    </div>
  );
}

/** Small preview of a locally chosen file (before upload). */
export function LocalFilePreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  if (!url) return null;
  if (file.type === 'application/pdf') {
    return (
      <div className="flex h-24 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-700">
        PDF · {file.name}
      </div>
    );
  }
  return <img src={url} alt={`Preview of ${file.name}`} className="h-24 w-auto rounded-lg border border-slate-200 object-cover" />;
}
