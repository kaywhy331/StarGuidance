import type {
  ButtonHTMLAttributes,
  DialogHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";

export function Button({
  className = "",
  type = "button",
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet" | "danger";
}) {
  return (
    <button className={`sg-button sg-button--${variant} ${className}`} type={type} {...props} />
  );
}

export function Panel({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`sg-panel ${className}`} {...props} />;
}

export function Field({
  label,
  error,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
}) {
  const id = props.id ?? props.name;
  const descriptionId = `${id}-description`;
  return (
    <label className="sg-field" htmlFor={id}>
      <span className="sg-field__label">{label}</span>
      <input
        {...props}
        aria-describedby={hint || error ? descriptionId : undefined}
        aria-invalid={Boolean(error)}
        className={`sg-field__control ${props.className ?? ""}`}
        id={id}
      />
      {(hint || error) && (
        <span
          className={error ? "sg-field__message sg-field__message--error" : "sg-field__message"}
          id={descriptionId}
        >
          {error ?? hint}
        </span>
      )}
    </label>
  );
}

export function LoadingState({ label = "Preparing…" }: { label?: string }) {
  return (
    <div aria-live="polite" className="sg-loading" role="status">
      <span aria-hidden="true" className="sg-loading__star" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel className="sg-empty-state">
      <span aria-hidden="true" className="sg-empty-state__mark">
        ✦
      </span>
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-2 text-[var(--text-muted)]">{children}</div>
    </Panel>
  );
}

export function Modal({
  title,
  children,
  ...props
}: DialogHTMLAttributes<HTMLDialogElement> & { title: string; children: ReactNode }) {
  return (
    <dialog aria-labelledby="modal-title" className="sg-modal" {...props}>
      <Panel>
        <h2 className="text-2xl" id="modal-title">
          {title}
        </h2>
        <div className="mt-4">{children}</div>
      </Panel>
    </dialog>
  );
}

export function ScreenReaderOnly({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
