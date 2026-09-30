import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Check,
  Circle,
  CircleCheck,
  CircleDashed,
  CirclePlay,
  Info,
  OctagonPause,
  X,
} from 'lucide-react';
import type { Person, TaskStatus } from '@volna/engine';
import { initials, STATUS_COLOR, STATUS_LABEL, STATUS_SHORT } from '../lib/format';
import { useConfirmStore, useToasts, type Toast } from '../store/draft';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

const reduceMotion =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid' | 'wave';

// Одинаковые состояния у всех кнопок: hover — на ступень темнее, active — ещё темнее и чуть меньше.
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-cobalt text-white hover:bg-cobalt-deep active:bg-cobalt-deep',
  secondary:
    'bg-surface text-ink border border-line hover:border-line-strong hover:bg-sunken active:bg-pressed',
  ghost: 'text-ink-2 hover:bg-sunken hover:text-ink active:bg-pressed',
  danger: 'text-crimson hover:bg-crimson-soft active:bg-crimson-soft',
  'danger-solid': 'bg-crimson text-white hover:bg-crimson/90 active:bg-crimson/85',
  // Раньше — оранжевая кнопка; оранжевый теперь только у последствий, действие — акцентом.
  wave: 'bg-cobalt text-white hover:bg-cobalt-deep active:bg-cobalt-deep',
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
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45',
        size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3.5 text-sm',
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
  tooltipSide,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; tooltipSide?: TooltipSide }) {
  return (
    <Tooltip content={label} side={tooltipSide} describe={false}>
      <button
        type="button"
        aria-label={label}
        className={cx(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-3 transition-colors duration-150 hover:bg-sunken hover:text-ink active:bg-pressed disabled:pointer-events-none disabled:opacity-45',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
}

type TooltipSide = 'top' | 'bottom';

// Если подсказка только что была открыта, следующая показывается сразу: удобно «водить» по иконкам.
let lastTooltipHide = 0;
const TOOLTIP_DELAY = 400;
const TOOLTIP_SKIP = 300;

/**
 * Подсказка для иконок без подписи и неочевидных понятий.
 * Появляется при наведении (с задержкой) и при фокусе с клавиатуры, скрывается по Esc.
 * Обёртка `display: contents` не влияет на вёрстку.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  describe = true,
}: {
  content: ReactNode;
  children: ReactElement<{ 'aria-describedby'?: string }>;
  side?: TooltipSide;
  /** false — если подсказка повторяет aria-label элемента и не должна читаться дважды. */
  describe?: boolean;
}) {
  const id = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setAnchor((a) => {
      if (a) lastTooltipHide = Date.now();
      return null;
    });
  }, []);

  const show = (immediate: boolean) => {
    window.clearTimeout(timer.current);
    const open = () => {
      const el = wrapRef.current?.firstElementChild;
      if (el) setAnchor(el.getBoundingClientRect());
    };
    if (immediate || Date.now() - lastTooltipHide < TOOLTIP_SKIP) open();
    else timer.current = window.setTimeout(open, TOOLTIP_DELAY);
  };

  useEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
    };
  }, [anchor, hide]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Положение считаем после отрисовки, когда известна ширина подсказки: не вылезаем за края окна.
  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!anchor || !tip) return;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const below =
      side === 'bottom' ? anchor.bottom + h + 8 < window.innerHeight : anchor.top < h + 12;
    const left = Math.min(
      Math.max(8, anchor.left + anchor.width / 2 - w / 2),
      window.innerWidth - w - 8,
    );
    tip.style.left = `${left}px`;
    tip.style.top = `${below ? anchor.bottom + 6 : anchor.top - h - 6}px`;
    tip.style.visibility = 'visible';
  }, [anchor, side]);

  return (
    <span
      ref={wrapRef}
      className="contents"
      onPointerEnter={(e) => e.pointerType !== 'touch' && show(false)}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => {
        // С клавиатуры — сразу; фокус от клика мышью подсказку не открывает.
        if ((e.target as HTMLElement).matches(':focus-visible')) show(true);
      }}
      onBlur={hide}
    >
      {describe
        ? cloneElement(children, { 'aria-describedby': anchor ? id : undefined })
        : children}
      {anchor &&
        content &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            style={{ visibility: 'hidden' }}
            className="animate-fade-in pointer-events-none fixed z-[80] max-w-[280px] rounded-md bg-ink px-2.5 py-1.5 text-[12px] leading-4 text-white shadow-float"
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}

/**
 * Термин с пояснением: пунктирное подчёркивание подсказывает, что есть определение.
 * Фокусируется с клавиатуры, чтобы пояснение было доступно не только мышью.
 */
export function Term({
  hint,
  children,
  className,
  side,
}: {
  hint: ReactNode;
  children: ReactNode;
  className?: string;
  side?: TooltipSide;
}) {
  return (
    <Tooltip content={hint} side={side}>
      <span
        tabIndex={0}
        className={cx(
          'cursor-help rounded-sm underline decoration-current/35 decoration-dotted underline-offset-[3px]',
          className,
        )}
      >
        {children}
      </span>
    </Tooltip>
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
        className="inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-idle text-[10px] text-ink-3"
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

/** Статус задачи: иконка + цвет, чтобы различать статусы и без цветового зрения. */
export const STATUS_ICON: Record<TaskStatus, typeof Circle> = {
  not_started: CircleDashed,
  in_progress: CirclePlay,
  blocked: OctagonPause,
  done: CircleCheck,
};

const STATUS_BADGE: Record<TaskStatus, string> = {
  not_started: 'border-line-strong bg-surface text-ink-2',
  in_progress: 'border-cobalt/30 bg-cobalt-soft text-cobalt-deep',
  blocked: 'border-ochre-bar/40 bg-ochre-soft text-ochre',
  done: 'border-moss/25 bg-moss-soft text-moss',
};

// Компактный вариант (только иконка) — сплошной кружок: статус читается с первого взгляда в списке.
const STATUS_SOLID: Record<TaskStatus, string> = {
  not_started: 'border-dashed border-idle bg-surface text-ink-3',
  in_progress: 'border-cobalt bg-cobalt text-white',
  blocked: 'border-ochre-bar bg-ochre-bar text-white',
  done: 'border-moss bg-moss text-white',
};

const STATUS_ICON_COLOR: Record<TaskStatus, string> = {
  not_started: 'text-ink-3',
  in_progress: 'text-cobalt',
  blocked: 'text-ochre-bar',
  done: 'text-moss',
};

export function StatusIcon({
  status,
  size = 16,
  className,
}: {
  status: TaskStatus;
  size?: number;
  className?: string;
}) {
  const Icon = STATUS_ICON[status];
  return (
    <Icon
      size={size}
      strokeWidth={2.2}
      aria-label={STATUS_LABEL[status]}
      className={cx('shrink-0', className ?? STATUS_ICON_COLOR[status])}
    />
  );
}

/**
 * Пилюля статуса: иконка, короткая подпись, мягкий фон своего цвета.
 * Образец — Status из 21st.dev (diceui), переписан на наши токены и иконки lucide.
 */
export function StatusBadge({
  status,
  size = 'md',
  iconOnly,
  count,
  className,
}: {
  status: TaskStatus;
  size?: 'sm' | 'md';
  /** На узких экранах: только иконка в рамке. */
  iconOnly?: boolean;
  /** Число задач в статусе — внутри пилюли, после подписи. */
  count?: number;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center gap-1 rounded-full border font-medium whitespace-nowrap',
        size === 'sm' ? 'h-[22px] text-[12px]' : 'h-7 text-[13px]',
        iconOnly
          ? size === 'sm'
            ? 'w-[22px] justify-center'
            : 'w-7 justify-center'
          : size === 'sm'
            ? 'pr-2 pl-1'
            : 'pr-2.5 pl-1.5',
        iconOnly ? STATUS_SOLID[status] : STATUS_BADGE[status],
        className,
      )}
      title={iconOnly ? STATUS_LABEL[status] : undefined}
    >
      <StatusIcon status={status} size={size === 'sm' ? 14 : 16} className="text-current" />
      {!iconOnly && STATUS_SHORT[status]}
      {count !== undefined && <span className="ml-0.5 font-semibold tabular-nums">{count}</span>}
    </span>
  );
}

type Tone = 'neutral' | 'crimson' | 'wave' | 'moss' | 'cobalt' | 'ochre';
const TONES: Record<Tone, string> = {
  neutral: 'bg-sunken text-ink-2',
  crimson: 'bg-crimson-soft text-crimson',
  wave: 'bg-wave-soft text-wave-deep',
  moss: 'bg-moss-soft text-moss',
  cobalt: 'bg-cobalt-soft text-cobalt-deep',
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
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] leading-4 font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

type FieldA11y = { 'aria-invalid'?: true; 'aria-describedby'?: string };

/**
 * Подпись, поле и сообщение под ним. Ошибка показывается рядом с полем;
 * чтобы экранный диктор связал её с полем, передайте children функцией и разверните атрибуты.
 */
export function Field({
  label,
  children,
  hint,
  error,
}: {
  label: ReactNode;
  children: ReactNode | ((a11y: FieldA11y) => ReactNode);
  hint?: ReactNode;
  error?: string | null;
}) {
  const id = useId();
  const a11y: FieldA11y = error ? { 'aria-invalid': true, 'aria-describedby': id } : {};
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      {typeof children === 'function' ? children(a11y) : children}
      {error ? (
        <span
          id={id}
          role="alert"
          className="animate-fade-in mt-1 block text-[12px] leading-4 text-crimson"
        >
          {error}
        </span>
      ) : (
        hint && <span className="mt-1 block text-[12px] leading-4 text-ink-3">{hint}</span>
      )}
    </label>
  );
}

export const inputClass =
  'h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-3 hover:border-line-strong focus:border-cobalt focus:ring-3 focus:ring-cobalt/15 aria-invalid:border-crimson aria-invalid:ring-crimson/15 disabled:opacity-45';

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
      className={cx('grid gap-0.5 rounded-lg bg-sunken p-0.5', className)}
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
              'h-8 rounded-md text-[13px] font-medium transition-colors duration-150',
              active
                ? 'bg-surface text-ink shadow-raised'
                : 'text-ink-3 hover:bg-pressed/60 hover:text-ink active:bg-pressed',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Заголовок подраздела в боковой панели. */
export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <h3 className="text-sm font-semibold text-ink">{children}</h3>
      {aside}
    </div>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden className={cx('skeleton rounded-md', className)} style={style} />;
}

const TOAST_ICON = { success: Check, error: AlertTriangle, info: Info } as const;
const TOAST_MS = 3500;

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

/** Тост скрывается сам через 3,5 с; пока на нём курсор или фокус — ждёт. */
function ToastItem({ toast: t }: { toast: Toast }) {
  const dismiss = useToasts((s) => s.dismiss);
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const Icon = TOAST_ICON[t.tone];

  useEffect(() => {
    if (paused || leaving) return;
    const timer = window.setTimeout(() => setLeaving(true), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [paused, leaving]);

  return (
    <div
      role={t.tone === 'error' ? 'alert' : 'status'}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onAnimationEnd={() => leaving && dismiss(t.id)}
      className={cx(
        'pointer-events-auto flex w-full max-w-md items-center gap-2.5 rounded-lg bg-ink py-2 pr-2 pl-3 text-sm text-white shadow-float sm:w-auto',
        leaving ? 'animate-toast-out' : 'animate-toast-in',
      )}
    >
      <Icon
        size={15}
        strokeWidth={2.25}
        className={cx(
          'shrink-0',
          t.tone === 'error'
            ? 'text-crimson-light'
            : t.tone === 'success'
              ? 'text-moss-light'
              : 'text-white/70',
        )}
      />
      <span className="min-w-0 flex-1 leading-snug">{t.text}</span>
      {t.action && (
        <button
          type="button"
          onClick={() => {
            t.action!.onClick();
            setLeaving(true);
          }}
          className="shrink-0 rounded-md px-2 py-1 text-[13px] font-semibold text-white underline-offset-2 transition-colors hover:bg-white/10 active:bg-white/15"
        >
          {t.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => setLeaving(true)}
        className="shrink-0 rounded-md p-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        aria-label="Закрыть уведомление"
      >
        <X size={14} />
      </button>
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
    <div className="animate-view-in flex flex-col items-center justify-center gap-1.5 px-6 py-16 text-center">
      {icon && <span className="mb-2 text-ink-3">{icon}</span>}
      <p className="text-base font-semibold">{title}</p>
      {children && <div className="max-w-sm text-sm leading-relaxed text-ink-2">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

type Phase = 'closed' | 'open' | 'closing';

/** Выпадающая панель у кнопки: закрывается кликом снаружи и Escape, появляется и скрывается плавно. */
export function Popover({
  button,
  label,
  buttonClassName,
  align = 'start',
  panelClassName,
  iconOnly,
  children,
}: {
  button: ReactNode | ((open: boolean) => ReactNode);
  label?: string;
  /** У кнопки нет видимого текста — label показывается подсказкой. */
  iconOnly?: boolean;
  buttonClassName?: string;
  align?: 'start' | 'end';
  panelClassName?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [phase, setPhase] = useState<Phase>('closed');
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [above, setAbove] = useState(false);
  const open = phase === 'open';
  const close = useCallback(() => setPhase((p) => (p === 'open' ? 'closing' : p)), []);

  // Внизу экрана панель открывается вверх, чтобы не уходить за край.
  useLayoutEffect(() => {
    if (!open) return;
    const root = rootRef.current?.getBoundingClientRect();
    const h = panelRef.current?.offsetHeight ?? 0;
    if (root) setAbove(root.bottom + h + 12 > window.innerHeight && root.top > h + 12);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const trigger = (
    <button
      ref={buttonRef}
      type="button"
      aria-expanded={open}
      aria-label={label}
      className={buttonClassName}
      onClick={() => setPhase((p) => (p === 'open' ? 'closing' : 'open'))}
    >
      {typeof button === 'function' ? button(open) : button}
    </button>
  );

  return (
    <div ref={rootRef} className="relative">
      {/* Обёртка есть всегда: иначе кнопка пересоздаётся при открытии и теряет фокус. */}
      <Tooltip content={iconOnly && !open ? label : null} describe={false}>
        {trigger}
      </Tooltip>
      {phase !== 'closed' && (
        <div
          ref={panelRef}
          data-state={phase}
          onAnimationEnd={() => phase === 'closing' && setPhase('closed')}
          className={cx(
            'absolute z-50 rounded-xl border border-line bg-surface p-1 shadow-float',
            above ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
            phase === 'closing' ? 'animate-pop-out' : 'animate-pop-in',
            align === 'end' ? 'right-0' : 'left-0',
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
        'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors duration-150',
        danger
          ? 'text-crimson hover:bg-crimson-soft active:bg-crimson-soft'
          : 'text-ink hover:bg-sunken active:bg-pressed',
      )}
    >
      <span className={cx('mt-0.5 shrink-0', danger ? 'text-crimson' : 'text-ink-3')}>{icon}</span>
      <span className="min-w-0">
        <span className="block font-medium">{children}</span>
        {hint && <span className="block text-[12px] leading-4 text-ink-3">{hint}</span>}
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
        'animate-pop-in m-auto w-[calc(100%-2rem)] rounded-xl border-0 bg-surface p-0 text-ink shadow-float',
        width,
      )}
    >
      {children}
    </dialog>
  );
}

/**
 * Шторка для боковой панели на узком экране: снизу на телефоне, справа на планшете.
 * Поведение взято из образца Drawer (21st.dev, ddoemonn): фокус внутрь при открытии и обратно
 * при закрытии, Escape, закрытие по подложке. Без пружин и библиотек — CSS-анимация transform.
 * Остальная страница делается inert снаружи (у вызывающего), чтобы окна поверх шторки работали.
 */
export function Sheet({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (!open || !mounted) return;
    const panel = panelRef.current;
    const active = document.activeElement;
    // Содержимое могло уже забрать фокус (например, поле названия новой задачи) — не перебиваем.
    if (panel?.contains(active)) return;
    returnTo.current = active instanceof HTMLElement ? active : null;
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]');
    (first ?? panel)?.focus({ preventScroll: true });
  }, [open, mounted]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.stopPropagation();
      onClose();
    }
  };

  if (!mounted) return null;
  return (
    <div className="fixed inset-0 z-50" data-state={open ? 'open' : 'closed'}>
      <div
        aria-hidden
        onClick={onClose}
        className={cx(
          'absolute inset-0 bg-ink/30',
          open ? 'animate-fade-in' : 'animate-[fade-out_200ms_ease-in_forwards]',
        )}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        data-state={open ? 'open' : 'closed'}
        onKeyDown={onKeyDown}
        onAnimationEnd={(e) => {
          if (e.target !== e.currentTarget || open) return;
          setMounted(false);
          const target = returnTo.current;
          if (target?.isConnected) target.focus({ preventScroll: true });
        }}
        className="sheet absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col overflow-hidden rounded-t-xl bg-surface shadow-float outline-none md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[400px] md:rounded-t-none md:rounded-l-xl"
      >
        <div className="relative flex h-11 shrink-0 items-center justify-end border-b border-line-soft px-2">
          <span
            aria-hidden
            className="absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-line-strong md:hidden"
          />
          <span className="absolute left-4 text-[13px] font-medium text-ink-3">{label}</span>
          <IconButton label="Закрыть панель" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmHost() {
  const request = useConfirmStore((s) => s.request);
  if (!request) return null;
  return (
    <Dialog key={request.title} onClose={() => request.resolve(false)} labelledBy="confirm-title">
      <div className="p-6">
        <h2 id="confirm-title" className="text-base font-semibold">
          {request.title}
        </h2>
        {request.text && <p className="mt-2 text-sm leading-relaxed text-ink-2">{request.text}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => request.resolve(false)}>
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
