import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/utils/misc';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  testId?: string;
  /** `drawer` slides in from the right on desktop; `sheet` is a bottom sheet on mobile. */
  variant?: 'dialog' | 'drawer' | 'sheet';
}

/**
 * Built on the native <dialog> element: focus is trapped, Esc closes, the background is inert.
 */
export function Modal({ open, onClose, title, children, footer, size = 'md', testId, variant = 'dialog' }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    d.addEventListener('cancel', onCancel);
    return () => d.removeEventListener('cancel', onCancel);
  }, [onClose]);

  const width = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-3xl', xl: 'sm:max-w-6xl' }[size];
  const placement = {
    dialog: cn('m-auto w-[calc(100%-2rem)] rounded-xl', width),
    drawer: 'ml-auto mr-0 my-0 h-full max-h-full w-full max-w-xl rounded-none sm:rounded-l-xl',
    sheet: cn(
      'mb-0 mt-auto w-full max-w-full rounded-t-2xl sm:m-auto sm:w-[calc(100%-2rem)] sm:rounded-xl max-h-[92vh]',
      width,
    ),
  }[variant];

  return (
    <dialog
      ref={ref}
      className={cn('border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/40', variant === 'drawer' && 'ef-drawer', placement)}
      aria-labelledby={testId ? `${testId}-title` : undefined}
      data-testid={testId}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="flex max-h-[inherit] flex-col" style={{ maxHeight: variant === 'drawer' ? '100vh' : '90vh' }}>
          <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
            <h2 id={testId ? `${testId}-title` : undefined} className="text-base font-semibold tracking-tight">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              data-testid={testId ? `${testId}-close` : 'modal-close'}
              className="rounded-md p-1 text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
