import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { X } from 'lucide-react';
import type { Person, TaskStatus } from '@volna/engine';
import { initials, STATUS_COLOR, STATUS_LABEL } from '../lib/format';
import { useToasts } from '../store/draft';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'wave';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-ink/90',
  secondary: 'bg-surface text-ink border border-line hover:border-ink-3',
  ghost: 'text-ink-2 hover:bg-line-soft hover:text-ink',
  danger: 'text-crimson hover:bg-crimson-soft',
  wave: 'bg-wave text-white hover:bg-wave/90',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap',
        size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-9 px-3.5 text-sm',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Avatar({ person, size = 22 }: { person: Person | undefined | null; size?: number }) {
  if (!person) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-ink-3 text-[10px] text-ink-3"
        style={{ width: size, height: size }}
        title="Ответственный не назначен"
      >
        ?
      </span>
    );
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: person.color, fontSize: size * 0.42 }}
      title={`${person.name} — ${person.role}`}
    >
      {initials(person.name)}
    </span>
  );
}

export function StatusDot({ status, size = 8 }: { status: TaskStatus; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: status === 'not_started' ? 'transparent' : STATUS_COLOR[status],
        border: status === 'not_started' ? `1.5px solid ${STATUS_COLOR[status]}` : undefined,
      }}
      title={STATUS_LABEL[status]}
    />
  );
}

type Tone = 'neutral' | 'crimson' | 'wave' | 'moss' | 'cobalt' | 'ochre';
const TONES: Record<Tone, string> = {
  neutral: 'bg-line-soft text-ink-2',
  crimson: 'bg-crimson-soft text-crimson',
  wave: 'bg-wave-soft text-wave',
  moss: 'bg-moss-soft text-moss',
  cobalt: 'bg-cobalt-soft text-cobalt',
  ochre: 'bg-ochre-soft text-ochre',
};

export function Chip({ tone = 'neutral', children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium leading-4 whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-ink-3">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-3 hover:border-ink-3 focus:border-cobalt';

export function Toasts() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cx(
            'wave-in pointer-events-auto flex max-w-lg items-center gap-3 rounded-xl px-4 py-2.5 text-sm shadow-lg',
            t.tone === 'error' ? 'bg-crimson text-white' : t.tone === 'success' ? 'bg-ink text-white' : 'bg-ink text-white',
          )}
        >
          <span>{t.text}</span>
          <button type="button" onClick={() => dismiss(t.id)} className="opacity-70 hover:opacity-100" aria-label="Закрыть">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Логотип: синусоида, которая «разгоняется» — изменение, расходящееся по проекту. */
export function WaveMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--color-ink)" />
      <path
        d="M4 18 C 7 18, 8 14, 11 14 S 15 22, 18.5 22 S 23 9, 28 9"
        fill="none"
        stroke="var(--color-wave)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="max-w-sm text-sm text-ink-2">{children}</div>}
    </div>
  );
}
