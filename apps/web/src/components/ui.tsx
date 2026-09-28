import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { AlertTriangle, Check, Info, X } from 'lucide-react';
import type { Person, TaskStatus } from '@volna/engine';
import { initials, STATUS_COLOR, STATUS_LABEL } from '../lib/format';
import { useConfirmStore, useToasts } from '../store/draft';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

const reduceMotion =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid' | 'wave';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ink text-white shadow-sm hover:bg-ink/88',
  secondary: 'bg-surface text-ink border border-line hover:border-ink-3',
  ghost: 'text-ink-2 hover:bg-ink/5 hover:text-ink',
  danger: 'text-crimson hover:bg-crimson-soft',
  'danger-solid': 'bg-crimson text-white shadow-sm hover:bg-crimson/90',
  wave: 'bg-wave text-white shadow-sm hover:bg-wave-deep',
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
        'inline-flex items-center justify-center gap-1.5 rounded-xl font-medium whitespace-nowrap transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'h-7 rounded-lg px-2.5 text-[13px]' : 'h-9 px-3.5 text-sm',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Квадратная кнопка-иконка; подпись обязательна — она же всплывающая подсказка. */
export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-ink/5 hover:text-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Avatar({
  person,
  size = 22,
}: {
  person: Person | undefined | null;
  size?: number;
}) {
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
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-surface"
      style={{ width: size, height: size, background: person.color, fontSize: size * 0.4 }}
      title={`${person.name}, ${person.role}`}
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
  neutral: 'bg-ink/[0.06] text-ink-2',
  crimson: 'bg-crimson-soft text-crimson',
  wave: 'bg-wave-soft text-wave-deep',
  moss: 'bg-moss-soft text-moss',
  cobalt: 'bg-cobalt-soft text-cobalt',
  ochre: 'bg-ochre-soft text-ochre',
};

export function Chip({
  tone = 'neutral',
  children,
  className,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] leading-4 font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-ink-3">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'h-9 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-3 hover:border-ink-3 focus:border-cobalt focus:ring-3 focus:ring-cobalt/15';

/** Сегментный переключатель: выбор одного из нескольких вариантов (или вкладок окна). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  kind = 'radio',
  className,
}: {
  value: T;
  options: readonly { id: T; label: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
  kind?: 'radio' | 'tab';
  className?: string;
}) {
  return (
    <div
      role={kind === 'tab' ? 'tablist' : 'radiogroup'}
      aria-label={label}
      className={cx('grid gap-1 rounded-xl bg-ink/[0.05] p-1', className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role={kind}
            aria-checked={kind === 'radio' ? active : undefined}
            aria-selected={kind === 'tab' ? active : undefined}
            onClick={() => onChange(o.id)}
            className={cx(
              'h-8 rounded-lg text-[13px] font-medium transition-colors',
              active ? 'bg-surface text-ink shadow-raised' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Заголовок блока в боковой панели. */
export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <h3 className="text-[13px] font-semibold text-ink-2">{children}</h3>
      {aside}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton rounded-lg', className)} />;
}

const TOAST_ICON = { success: Check, error: AlertTriangle, info: Info } as const;

export function Toasts() {
  const { toasts, dismiss } = useToasts();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2"
    >
      {toasts.map((t) => {
        const Icon = TOAST_ICON[t.tone];
        return (
          <div
            key={t.id}
            role="status"
            className="glass-ink animate-toast-in pointer-events-auto flex max-w-lg items-center gap-3 rounded-2xl py-2.5 pr-3 pl-3.5 text-sm text-white shadow-float"
          >
            <span
              className={cx(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                t.tone === 'error'
                  ? 'bg-crimson'
                  : t.tone === 'success'
                    ? 'bg-moss'
                    : 'bg-white/15',
              )}
            >
              <Icon size={13} strokeWidth={2.5} />
            </span>
            <span className="leading-snug">{t.text}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="rounded-md p-1 opacity-60 transition-opacity hover:opacity-100"
              aria-label="Закрыть"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// Логотип: волна, которая «разгоняется» к правому краю, — изменение, расходящееся по проекту.
// Кадры считаются один раз; анимация — SMIL, чтобы не будить React.
function markPath(phase: number): string {
  const pts: string[] = [];
  for (let i = 0; i <= 28; i++) {
    const t = i / 28;
    const x = 5 + 22 * t;
    const amp = 1.4 + 5.2 * t * t;
    const y = 18.5 - 4 * t - amp * Math.sin(t * Math.PI * 2.4 + phase);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return `M${pts.join(' L')}`;
}
const MARK_STATIC = markPath(0.6);
const MARK_FRAMES = Array.from({ length: 13 }, (_, i) =>
  markPath(0.6 - (i / 12) * Math.PI * 2),
).join(';');

export function WaveMark({ size = 28, animated = true }: { size?: number; animated?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect width="32" height="32" rx="9" fill="var(--color-ink)" />
      <path
        d={MARK_STATIC}
        fill="none"
        stroke="var(--color-wave)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {animated && !reduceMotion && (
          <animate attributeName="d" dur="4.2s" repeatCount="indefinite" values={MARK_FRAMES} />
        )}
      </path>
    </svg>
  );
}

// «Волнение моря»: периодический узор шириной в два периода; сдвиг обёртки на −50% замыкает цикл.
const SEA_PERIOD = 1200;
function seaPath(harmonics: [amp: number, freq: number, phase: number][]): string {
  const pts: string[] = [];
  for (let x = 0; x <= SEA_PERIOD * 2; x += 10) {
    const y = harmonics.reduce(
      (s, [a, f, p]) => s + a * Math.sin((2 * Math.PI * f * x) / SEA_PERIOD + p),
      0,
    );
    pts.push(`${x},${y.toFixed(3)}`);
  }
  return `M${pts.join(' L')}`;
}
const SEA_FRONT = seaPath([
  [0.62, 3, 0],
  [0.28, 7, 1.1],
  [0.1, 13, 2.3],
]);
const SEA_BACK = seaPath([
  [0.55, 2, 1.7],
  [0.35, 5, 0.4],
  [0.1, 11, 2.9],
]);

function SeaLayer({
  d,
  amplitude,
  color,
  opacity,
  duration,
}: {
  d: string;
  amplitude: number;
  color: string;
  opacity: number;
  duration: number;
}) {
  return (
    <div
      className="absolute inset-y-0 left-0 w-[200%] will-change-transform"
      style={{ animation: `sea ${duration}s linear infinite` }}
    >
      <svg className="block h-full w-full" viewBox="0 -1.15 2400 2.3" preserveAspectRatio="none">
        <g
          style={{
            transform: `scaleY(${amplitude})`,
            transformOrigin: '0 0',
            transition: 'transform 900ms var(--ease-out-soft)',
          }}
        >
          <path
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={1.4}
            strokeOpacity={opacity}
            vectorEffect="non-scaling-stroke"
            style={{ transition: 'stroke 600ms ease' }}
          />
        </g>
      </svg>
    </div>
  );
}

/**
 * Линия волнения: амплитуда и скорость кодируют состояние проекта —
 * штиль, когда всё в порядке, и рябь, когда нужно вмешательство.
 * Позиционирование (relative/absolute) задаёт вызывающий через className.
 */
export function SeaLine({
  amplitude,
  color,
  duration = 18,
  className,
}: {
  amplitude: number;
  color: string;
  duration?: number;
  className?: string;
}) {
  return (
    <div aria-hidden className={cx('pointer-events-none overflow-hidden', className)}>
      <SeaLayer
        d={SEA_BACK}
        amplitude={amplitude * 0.75}
        color={color}
        opacity={0.28}
        duration={duration * 1.7}
      />
      <SeaLayer
        d={SEA_FRONT}
        amplitude={amplitude}
        color={color}
        opacity={0.7}
        duration={duration}
      />
    </div>
  );
}

export function Empty({
  title,
  children,
  icon,
  action,
}: {
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="animate-view-in flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      {icon && (
        <span className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-ink/5 text-ink-2">
          {icon}
        </span>
      )}
      <p className="font-display text-[17px] font-semibold">{title}</p>
      {children && <div className="max-w-sm text-sm leading-relaxed text-ink-2">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Выпадающая панель у кнопки: закрывается кликом снаружи и Escape. */
export function Popover({
  button,
  label,
  buttonClassName,
  align = 'start',
  panelClassName,
  children,
}: {
  button: ReactNode | ((open: boolean) => ReactNode);
  label?: string;
  buttonClassName?: string;
  align?: 'start' | 'end';
  panelClassName?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className={buttonClassName}
        onClick={() => setOpen((o) => !o)}
      >
        {typeof button === 'function' ? button(open) : button}
      </button>
      {open && (
        <div
          className={cx(
            'glass-strong animate-pop-in absolute top-full z-50 mt-2 rounded-2xl border border-line/70 p-1.5 shadow-float',
            align === 'end' ? 'right-0 origin-top-right' : 'left-0 origin-top-left',
            panelClassName,
          )}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  hint,
  danger,
  onClick,
}: {
  icon: ReactNode;
  children: ReactNode;
  hint?: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors',
        danger ? 'text-crimson hover:bg-crimson-soft' : 'text-ink hover:bg-ink/5',
      )}
    >
      <span className={cx('mt-0.5 shrink-0', danger ? 'text-crimson' : 'text-ink-3')}>{icon}</span>
      <span className="min-w-0">
        <span className="block font-medium">{children}</span>
        {hint && <span className="block text-[12px] leading-snug text-ink-3">{hint}</span>}
      </span>
    </button>
  );
}

/** Модальное окно на нативном <dialog>: фокус, Escape и подложка — средствами браузера. */
export function Dialog({
  onClose,
  labelledBy,
  width = 'max-w-md',
  children,
}: {
  onClose: () => void;
  labelledBy?: string;
  /** Класс максимальной ширины окна. */
  width?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d || d.open) return;
    d.showModal();
    // showModal фокусирует первый элемент; явная цель — поле ввода или безопасное основное действие.
    d.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className={cx(
        'animate-pop-in m-auto w-[calc(100%-2rem)] rounded-3xl border-0 bg-surface p-0 text-ink shadow-float',
        width,
      )}
    >
      {children}
    </dialog>
  );
}

export function ConfirmHost() {
  const request = useConfirmStore((s) => s.request);
  if (!request) return null;
  return (
    <Dialog key={request.title} onClose={() => request.resolve(false)} labelledBy="confirm-title">
      <div className="p-6">
        <h2 id="confirm-title" className="font-display text-lg font-semibold">
          {request.title}
        </h2>
        {request.text && <p className="mt-2 text-sm leading-relaxed text-ink-2">{request.text}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => request.resolve(false)}>
            Отмена
          </Button>
          <Button
            variant={request.danger ? 'danger-solid' : 'primary'}
            data-autofocus={request.danger ? undefined : true}
            onClick={() => request.resolve(true)}
          >
            {request.confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
