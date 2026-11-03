/**
 * Reusable Input Components
 *
 * Consistent, accessible form input components with labels, errors, and sizes.
 */

import type { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';
import { ErrorCircleIcon, FolderIcon } from '../icons';
import { Icon } from "@aphrody/m3-primitives";

// ==================== Types ====================

type InputSize = 'sm' | 'md';

interface BaseInputProps {
  label?: string;
  helperText?: string;
  error?: string;
  size?: InputSize;
  showErrorIcon?: boolean;
  errorTestId?: string;
  reserveErrorSpace?: boolean;
  customFocus?: boolean;
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>, BaseInputProps {
  leftAddon?: ReactNode;
  rightAddon?: ReactNode;
}

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'>, BaseInputProps {
  rows?: number;
}

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'>, BaseInputProps {
  options: SelectOption[];
  placeholder?: string;
}

// ==================== Style Mappings ====================

const SIZE_CLASSES: Record<InputSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-3 py-2 text-sm',
};

const BASE_INPUT_CLASSES = [
  'w-full bg-surface-container text-on-surface',
  'placeholder-on-surface-variant',
  'focus:outline-hidden',
  'disabled:opacity-50 disabled:cursor-not-allowed',
  'transition-colors',
].join(' ');

const LABEL_CLASSES = 'block text-sm font-medium text-on-surface-variant mb-1';

const HELPER_CLASSES = 'mt-1 text-xs text-on-surface-variant';

const ERROR_CLASSES = 'mt-1 text-xs text-error';

// ==================== Helper Components ====================

function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className={LABEL_CLASSES}>
      {children}
    </label>
  );
}

function HelperText({ children, id }: { children: ReactNode; id?: string }) {
  return <p id={id} className={HELPER_CLASSES}>{children}</p>;
}

function ErrorText({ children, showIcon, testId, id }: { children: ReactNode; showIcon?: boolean; testId?: string; id?: string }) {
  if (showIcon) {
    return (
      <p id={id} data-testid={testId} role="alert" className="mt-2 text-xs text-error flex items-center gap-1.5">
        <ErrorCircleIcon size="sm" className="flex-shrink-0" />
        {children}
      </p>
    );
  }
  return <p id={id} data-testid={testId} role="alert" className={ERROR_CLASSES}>{children}</p>;
}

// ==================== Components ====================

export function Input({
  label,
  helperText,
  error,
  size = 'md',
  showErrorIcon,
  errorTestId,
  reserveErrorSpace,
  customFocus,
  leftAddon,
  rightAddon,
  className = '',
  id,
  ...props
}: InputProps) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const errorId = `${inputId}-error`;
  const helperId = `${inputId}-helper`;

  // Build aria-describedby based on what's shown
  const describedBy = error ? errorId : helperText ? helperId : undefined;

  const inputClasses = [
    BASE_INPUT_CLASSES,
    SIZE_CLASSES[size],
    'border rounded-lg',
    error
      ? 'border-error focus:border-error'
      : customFocus
        ? 'border-outline-variant'
        : 'border-outline-variant focus:border-primary',
    leftAddon ? 'rounded-l-none' : '',
    rightAddon ? 'rounded-r-none' : '',
    className,
  ].filter(Boolean).join(' ');

  const hasAddons = leftAddon || rightAddon;
  const inputProps = {
    id: inputId,
    className: inputClasses,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
    ...props,
  };

  return (
    <div>
      {label && <Label htmlFor={inputId}>{label}</Label>}
      {hasAddons ? (
        <div className="flex">
          {leftAddon && (
            <span className="inline-flex items-center px-3 text-sm text-on-surface-variant bg-surface-container-high border border-r-0 border-outline-variant rounded-l-lg">
              {leftAddon}
            </span>
          )}
          <input {...inputProps} />
          {rightAddon && (
            <span className="inline-flex items-center px-3 text-sm text-on-surface-variant bg-surface-container-high border border-l-0 border-outline-variant rounded-r-lg">
              {rightAddon}
            </span>
          )}
        </div>
      ) : (
        <input {...inputProps} />
      )}
      {reserveErrorSpace ? (
        <div className="min-h-[2rem] mt-2">
          {error ? <ErrorText id={errorId} showIcon={showErrorIcon} testId={errorTestId}>{error}</ErrorText> : helperText && <HelperText id={helperId}>{helperText}</HelperText>}
        </div>
      ) : (
        error ? <ErrorText id={errorId} showIcon={showErrorIcon} testId={errorTestId}>{error}</ErrorText> : helperText && <HelperText id={helperId}>{helperText}</HelperText>
      )}
    </div>
  );
}

export function TextArea({
  label,
  helperText,
  error,
  size = 'md',
  rows = 3,
  className = '',
  id,
  ...props
}: TextAreaProps) {
  const generatedId = useId();
  const textareaId = id || generatedId;
  const errorId = `${textareaId}-error`;
  const helperId = `${textareaId}-helper`;

  const describedBy = error ? errorId : helperText ? helperId : undefined;

  const textareaClasses = [
    BASE_INPUT_CLASSES,
    SIZE_CLASSES[size],
    'border rounded-lg resize-none',
    error ? 'border-error focus:border-error' : 'border-outline-variant focus:border-primary',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div>
      {label && <Label htmlFor={textareaId}>{label}</Label>}
      <textarea
        id={textareaId}
        className={textareaClasses}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      />
      {error ? <ErrorText id={errorId}>{error}</ErrorText> : helperText && <HelperText id={helperId}>{helperText}</HelperText>}
    </div>
  );
}

// ==================== Checkbox ====================

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label: string;
  description?: string;
}

export function Checkbox({
  label,
  description,
  className = '',
  id,
  ...props
}: CheckboxProps) {
  const generatedId = useId();
  const checkboxId = id || generatedId;

  return (
    <label htmlFor={checkboxId} className="flex items-start gap-3 cursor-pointer group">
      <input
        type="checkbox"
        id={checkboxId}
        className={[
          'mt-0.5 w-4 h-4 rounded',
          'border-outline-variant bg-surface-container',
          'text-primary',
          'focus:ring-primary focus:ring-offset-0',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          className,
        ].filter(Boolean).join(' ')}
        {...props}
      />
      <div>
        <span className="text-sm text-on-surface group-hover:text-on-surface">
          {label}
        </span>
        {description && (
          <p className="text-xs text-on-surface-variant">
            {description}
          </p>
        )}
      </div>
    </label>
  );
}

// ==================== RadioButton ====================

export interface RadioButtonProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label: ReactNode;
  description?: string;
  /** Additional classes for the wrapper label element */
  wrapperClassName?: string;
  /** Additional classes for the label text span */
  labelClassName?: string;
  /** Use inline layout (items-center) instead of stacked (items-start) */
  inline?: boolean;
}

export function RadioButton({
  label,
  description,
  className = '',
  wrapperClassName = '',
  labelClassName = '',
  inline = false,
  id,
  ...props
}: RadioButtonProps) {
  const generatedId = useId();
  const radioId = id || generatedId;

  const baseWrapperClasses = inline
    ? 'flex items-center gap-2 cursor-pointer group'
    : 'flex items-start gap-3 cursor-pointer group';

  return (
    <label htmlFor={radioId} className={`${baseWrapperClasses} ${wrapperClassName}`.trim()}>
      <input
        type="radio"
        id={radioId}
        className={[
          inline ? 'w-4 h-4' : 'mt-0.5 w-4 h-4',
          'bg-surface-container border-outline-variant',
          'text-primary',
          'focus:ring-primary focus:ring-offset-0',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          className,
        ].filter(Boolean).join(' ')}
        {...props}
      />
      <div>
        <span className={`text-sm ${labelClassName || 'text-on-surface group-hover:text-on-surface'}`}>
          {label}
        </span>
        {description && (
          <p className="text-xs text-on-surface-variant">
            {description}
          </p>
        )}
      </div>
    </label>
  );
}

// ==================== PathInput ====================

export interface PathInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  labelSuffix?: string;
  helperText?: string;
  error?: string;
  showErrorIcon?: boolean;
  errorTestId?: string;
  reserveErrorSpace?: boolean;
  onBrowse: () => void;
  browseDisabled?: boolean;
}

export function PathInput({
  label,
  labelSuffix,
  helperText,
  error,
  showErrorIcon,
  errorTestId,
  reserveErrorSpace,
  onBrowse,
  browseDisabled,
  disabled,
  className = '',
  id,
  ...props
}: PathInputProps) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const errorId = `${inputId}-error`;
  const helperId = `${inputId}-helper`;

  const describedBy = error ? errorId : helperText ? helperId : undefined;

  return (
    <div>
      {label && (
        <label htmlFor={inputId} className={LABEL_CLASSES}>
          {label}
          {labelSuffix && <span className="text-on-surface-variant font-normal"> {labelSuffix}</span>}
        </label>
      )}
      <div className="flex gap-2">
        <input
          id={inputId}
          type="text"
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={[
            'flex-1',
            BASE_INPUT_CLASSES,
            SIZE_CLASSES.md,
            'border rounded-lg',
            error
              ? 'border-error focus:border-error'
              : 'border-outline-variant focus:border-primary',
            className,
          ].filter(Boolean).join(' ')}
          {...props}
        />
        <button
          type="button"
          onClick={onBrowse}
          disabled={disabled || browseDisabled}
          aria-label="Browse for file"
          className="px-3 py-2 bg-surface-container hover:bg-surface-container-high border border-outline-variant text-on-surface-variant rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Browse"
          data-testid="browse-button"
        >
          <FolderIcon size="sm" />
        </button>
      </div>
      {reserveErrorSpace ? (
        <div className="min-h-[2rem] mt-2">
          {error ? <ErrorText id={errorId} showIcon={showErrorIcon} testId={errorTestId}>{error}</ErrorText> : helperText && <HelperText id={helperId}>{helperText}</HelperText>}
        </div>
      ) : (
        error ? <ErrorText id={errorId} showIcon={showErrorIcon} testId={errorTestId}>{error}</ErrorText> : helperText && <HelperText id={helperId}>{helperText}</HelperText>
      )}
    </div>
  );
}

export function Select({
  label,
  helperText,
  error,
  size = 'md',
  options,
  placeholder,
  className = '',
  id,
  ...props
}: SelectProps) {
  const generatedId = useId();
  const selectId = id || generatedId;
  const errorId = `${selectId}-error`;
  const helperId = `${selectId}-helper`;

  const describedBy = error ? errorId : helperText ? helperId : undefined;

  const selectClasses = [
    BASE_INPUT_CLASSES,
    SIZE_CLASSES[size],
    'border rounded-lg',
    'appearance-none cursor-pointer',
    'pr-10',
    error ? 'border-error focus:border-error' : 'border-outline-variant focus:border-primary',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div>
      {label && <Label htmlFor={selectId}>{label}</Label>}
      <div className="relative">
      <select
        id={selectId}
        className={selectClasses}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon
        name="keyboard_arrow_down"
        size={20}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
      />
      </div>
      {error ? <ErrorText id={errorId}>{error}</ErrorText> : helperText && <HelperText id={helperId}>{helperText}</HelperText>}
    </div>
  );
}





