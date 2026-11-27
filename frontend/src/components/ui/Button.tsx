import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/utils/misc';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-indigo-600 text-white shadow-xs hover:bg-indigo-700 disabled:bg-indigo-300',
  success: 'bg-emerald-600 text-white shadow-xs hover:bg-emerald-700 disabled:bg-emerald-300',
  secondary: 'bg-white text-slate-700 border border-slate-200 shadow-xs hover:bg-slate-50 hover:text-slate-900 disabled:text-slate-400',
  danger: 'bg-white text-red-700 border border-red-200 shadow-xs hover:bg-red-50 disabled:text-red-300',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-400',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-5 text-base gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  testId?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, icon, className, children, disabled, testId, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-testid={testId}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium whitespace-nowrap transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function IconButton({
  label,
  className,
  children,
  testId,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; testId?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testId}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
