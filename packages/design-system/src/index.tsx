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
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`min-h-11 rounded-full bg-[#f5efe1] px-5 py-2 font-semibold text-[#171121] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      type={type}
      {...props}
    />
  );
}

export function Panel({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl ${className}`}
      {...props}
    />
  );
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
    <label className="grid gap-2" htmlFor={id}>
      <span className="text-sm font-medium text-[#e9e1ef]">{label}</span>
      <input
        {...props}
        aria-describedby={hint || error ? descriptionId : undefined}
        aria-invalid={Boolean(error)}
        className="min-h-12 rounded-2xl border border-white/15 bg-[#120e20] px-4 text-white placeholder:text-[#786e85]"
        id={id}
      />
      {(hint || error) && (
        <span
          className={error ? "text-sm text-[#ffb7bd]" : "text-sm text-[#a99db5]"}
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
    <div aria-live="polite" className="animate-pulse text-[#c9bfd4]" role="status">
      {label}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel className="text-center">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-2 text-[#b8adc8]">{children}</div>
    </Panel>
  );
}

export function Modal({
  title,
  children,
  ...props
}: DialogHTMLAttributes<HTMLDialogElement> & { title: string; children: ReactNode }) {
  return (
    <dialog
      aria-labelledby="modal-title"
      className="m-auto max-w-lg rounded-3xl bg-[#120e20] p-0 text-white backdrop:bg-black/70"
      {...props}
    >
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
