"use client";

import { useState, type InputHTMLAttributes } from "react";

/**
 * A password input with a show/hide toggle. The toggle's accessible name is
 * "Show" / "Hide" (with aria-pressed) so it never competes with the field's
 * own label for assistive technology or label-based lookups.
 */
export function PasswordField({
  label,
  error,
  hint,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
}) {
  const [visible, setVisible] = useState(false);
  const id = props.id ?? props.name;
  const descriptionId = `${id}-description`;
  return (
    <div className="sg-field sg-password-field">
      <label className="sg-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="sg-password-field__control">
        <input
          {...props}
          aria-describedby={hint || error ? descriptionId : undefined}
          aria-invalid={Boolean(error)}
          className={`sg-field__control ${props.className ?? ""}`}
          id={id}
          type={visible ? "text" : "password"}
        />
        <button
          aria-controls={id}
          aria-pressed={visible}
          className="sg-password-field__toggle"
          onClick={() => setVisible((current) => !current)}
          type="button"
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {(hint || error) && (
        <span
          aria-live={error ? "polite" : undefined}
          className={error ? "sg-field__message sg-field__message--error" : "sg-field__message"}
          id={descriptionId}
        >
          {error ?? hint}
        </span>
      )}
    </div>
  );
}
