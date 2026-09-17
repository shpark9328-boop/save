'use client';

import type { ReactNode } from 'react';

/** 작은 UI 프리미티브 모음 */

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1.5 text-xs text-[var(--text-muted)]">{hint}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}

export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  name,
}: {
  options: readonly { value: T; label: string }[];
  value: readonly T[];
  onChange: (next: T[]) => void;
  name: string;
}) {
  const toggle = (option: T): void => {
    onChange(value.includes(option) ? value.filter((v) => v !== option) : [...value, option]);
  };

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={name}>
      {options.map((option) => {
        const on = value.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            className="chip"
            data-on={on}
            aria-pressed={on}
            onClick={() => toggle(option.value)}
          >
            {on ? '☑' : '☐'} {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)]">
      <span
        aria-hidden
        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--brand)]"
      />
      {label ?? '불러오는 중…'}
    </span>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return <div className="notice">{children}</div>;
}
