/**
 * Reusable Button Components
 *
 * Consistent, accessible button components with variants and sizes.
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react';

// ==================== Types ====================

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success' | 'accent' | 'link';
type ButtonSize = 'sm' | 'md' | 'lg';
type ColorScheme = 'primary' | 'secondary' | 'tertiary' | 'success' | 'error';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
  /** Override primary/danger variant colors with a specific color scheme */
  colorScheme?: ColorScheme;
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Override variant colors with a specific color scheme */
  colorScheme?: ColorScheme;
}

// ==================== Style Mappings ====================

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-primary state-layer text-on-primary border-transparent shadow-md3-1',
  secondary: 'bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface border-outline-variant',
  danger: 'bg-error/10 hover:bg-error/20 text-error border-error/30 hover:border-error/50',
  ghost: 'bg-transparent hover:bg-surface-container text-on-surface-variant hover:text-on-surface border-transparent hover:border-outline-variant',
  success: 'bg-success/10 hover:bg-success/20 text-success border-success/30 hover:border-success/50',
  accent: 'bg-primary/10 hover:bg-primary/20 text-primary border-primary/30 hover:border-primary/50',
  link: 'bg-transparent hover:bg-transparent text-primary brightness-100 hover:brightness-125 underline underline-offset-2 border-transparent',
};

/** Filled role colour schemes that override the primary variant */
const COLOR_SCHEME_CLASSES: Record<ColorScheme, string> = {
  primary: 'bg-primary state-layer text-on-primary border-transparent shadow-md3-1',
  secondary: 'bg-secondary state-layer text-on-secondary border-transparent shadow-md3-1',
  tertiary: 'bg-tertiary state-layer text-on-tertiary border-transparent shadow-md3-1',
  success: 'bg-success state-layer text-on-success border-transparent shadow-md3-1',
  error: 'bg-error state-layer text-on-error border-transparent shadow-md3-1',
};

/** Ghost colour schemes for icon buttons with a role-tinted hover */
const GHOST_COLOR_SCHEME_CLASSES: Record<ColorScheme, string> = {
  primary: 'bg-transparent hover:bg-primary/10 text-on-surface-variant hover:text-primary border-transparent',
  secondary: 'bg-transparent hover:bg-secondary/10 text-on-surface-variant hover:text-secondary border-transparent',
  tertiary: 'bg-transparent hover:bg-tertiary/10 text-on-surface-variant hover:text-tertiary border-transparent',
  success: 'bg-transparent hover:bg-success/10 text-on-surface-variant hover:text-success border-transparent',
  error: 'bg-transparent hover:bg-error/10 text-on-surface-variant hover:text-error border-transparent',
};

function getVariantClasses(variant: ButtonVariant, colorScheme?: ColorScheme): string {
  if (colorScheme) {
    if (variant === 'primary') {
      return COLOR_SCHEME_CLASSES[colorScheme];
    }
    if (variant === 'ghost') {
      return GHOST_COLOR_SCHEME_CLASSES[colorScheme];
    }
    if (variant === 'danger' && colorScheme === 'error') {
      return COLOR_SCHEME_CLASSES.error;
    }
  }
  return VARIANT_CLASSES[variant];
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-6 py-3 text-base',
};

const ICON_BUTTON_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'p-1.5',
  md: 'p-2.5',
  lg: 'p-3',
};

// ==================== Components ====================

function LoadingSpinner() {
  return (
    <div className="relative w-4 h-4">
      <div className="absolute inset-0 border-2 border-current opacity-25 rounded-full" />
      <div className="absolute inset-0 border-2 border-transparent border-t-current rounded-full animate-spin" />
    </div>
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  fullWidth = false,
  colorScheme,
  disabled,
  className = '',
  children,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  const classes = [
    // Base styles
    'inline-flex items-center justify-center gap-2',
    'font-medium rounded-lg border',
    'transition-colors',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    // Variant (with optional colorScheme override)
    getVariantClasses(variant, colorScheme),
    // Size
    SIZE_CLASSES[size],
    // Full width
    fullWidth ? 'w-full' : '',
    // Custom classes
    className,
  ].filter(Boolean).join(' ');

  return (
    <button
      className={classes}
      disabled={isDisabled}
      {...props}
    >
      {loading ? <LoadingSpinner /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  loading = false,
  colorScheme,
  disabled,
  className = '',
  ...props
}: IconButtonProps) {
  const isDisabled = disabled || loading;

  const classes = [
    // Base styles
    'inline-flex items-center justify-center',
    'rounded-lg border',
    'transition-colors',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    // Variant (with optional colorScheme override)
    getVariantClasses(variant, colorScheme),
    // Size
    ICON_BUTTON_SIZE_CLASSES[size],
    // Custom classes
    className,
  ].filter(Boolean).join(' ');

  return (
    <button
      className={classes}
      disabled={isDisabled}
      title={label}
      aria-label={label}
      {...props}
    >
      {loading ? <LoadingSpinner /> : icon}
    </button>
  );
}





