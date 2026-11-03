/**
 * Reusable Modal Components
 *
 * Consistent, accessible modal/dialog components.
 * Mission Control aesthetic with cyber styling.
 */

import { type ReactNode, useEffect, useRef, useId } from 'react';
import { CloseIcon, WarningIcon } from '../icons';
import { Button } from './Button';
import { Portal } from './Portal';

// ==================== Types ====================

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';
type DialogVariant = 'default' | 'danger';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  size?: ModalSize;
  closeOnBackdrop?: boolean;
  className?: string;
  /** ID of the element that labels this modal (for aria-labelledby) */
  labelledBy?: string;
}

export interface ModalHeaderProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  showCloseButton?: boolean;
  /** ID for the title element (for aria-labelledby connection) */
  titleId?: string;
}

export interface ModalBodyProps {
  children: ReactNode;
  className?: string;
}

export interface ModalFooterProps {
  children: ReactNode;
  className?: string;
}

export interface DialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: DialogVariant;
  loading?: boolean;
}

// ==================== Style Mappings ====================

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

// ==================== Components ====================

export function Modal({
  isOpen,
  onClose,
  children,
  size = 'md',
  closeOnBackdrop = true,
  className = '',
  labelledBy,
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // Store the previously focused element and focus the modal when opened
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      // Focus the modal container for keyboard navigation
      modalRef.current?.focus();
    } else if (previousActiveElement.current) {
      // Return focus when closed
      previousActiveElement.current.focus();
      previousActiveElement.current = null;
    }
  }, [isOpen]);

  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleBackdropClick = () => {
    if (closeOnBackdrop) {
      onClose();
    }
  };

  const modalClasses = [
    'relative bg-surface-container-low border border-outline-variant',
    'rounded-xl shadow-2xl shadow-shadow/70',
    SIZE_CLASSES[size],
    'w-full mx-4',
    'animate-fade-slide-in',
    className,
  ].filter(Boolean).join(' ');

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {/* Scrim */}
        <div
          className="absolute inset-0 bg-scrim/40"
          onClick={handleBackdropClick}
        />

        {/* Modal */}
        <div ref={modalRef} tabIndex={-1} className={modalClasses}>
          {children}
        </div>
      </div>
    </Portal>
  );
}

export function ModalHeader({
  title,
  subtitle,
  onClose,
  showCloseButton = true,
  titleId,
}: ModalHeaderProps) {
  return (
    <div className="flex items-start justify-between p-6 border-b border-outline-variant">
      <div>
        <h2 id={titleId} className="text-xl font-semibold text-on-surface">{title}</h2>
        {subtitle && <p className="text-sm text-on-surface-variant mt-1 font-mono">{subtitle}</p>}
      </div>
      {showCloseButton && (
        <button
          onClick={onClose}
          className="p-1.5 text-on-surface-variant hover:text-primary transition-colors rounded-lg hover:bg-surface-container border border-transparent hover:border-outline-variant"
          aria-label="Close dialog"
        >
          <CloseIcon size="md" />
        </button>
      )}
    </div>
  );
}

export function ModalBody({ children, className = '' }: ModalBodyProps) {
  return (
    <div className={`p-6 ${className}`}>
      {children}
    </div>
  );
}

export function ModalFooter({ children, className = '' }: ModalFooterProps) {
  return (
    <div className={`flex items-center justify-end gap-3 p-6 border-t border-outline-variant ${className}`}>
      {children}
    </div>
  );
}

/**
 * Dialog - A pre-built confirmation dialog using Modal components.
 * Replaces the old ConfirmDialog component.
 */
export function Dialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  variant = 'default',
  loading = false,
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // Store the previously focused element and focus the dialog when opened
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      dialogRef.current?.focus();
    } else if (previousActiveElement.current) {
      previousActiveElement.current.focus();
      previousActiveElement.current = null;
    }
  }, [isOpen]);

  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const isDanger = variant === 'danger';

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-scrim/40 backdrop-blur-sm"
          onClick={onCancel}
        />

        {/* Dialog */}
        <div ref={dialogRef} tabIndex={-1} className="relative bg-surface-container-low border border-outline-variant rounded-xl shadow-2xl shadow-shadow/70 max-w-md w-full mx-4 p-6 animate-fade-slide-in">

          <div className="flex items-start gap-4 mb-6">
            <div
              className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 ${
                isDanger
                  ? 'bg-error/10 text-error border border-error/30'
                  : 'bg-warning/10 text-warning border border-warning/30'
              }`}
              aria-hidden="true"
            >
              <WarningIcon size="md" />
            </div>
            <div>
              <h3 id={titleId} className="text-lg font-semibold text-on-surface">{title}</h3>
              <p className="text-sm text-on-surface-variant mt-1.5 leading-relaxed">{message}</p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            <Button
              variant="secondary"
              onClick={onCancel}
              disabled={loading}
            >
              {cancelLabel}
            </Button>
            <Button
              variant={isDanger ? 'danger' : 'primary'}
              onClick={onConfirm}
              loading={loading}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </Portal>
  );
}





