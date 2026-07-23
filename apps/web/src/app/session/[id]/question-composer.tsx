"use client";

import { useEffect, useRef, type FormEvent, type KeyboardEvent } from "react";

export function QuestionComposer({
  value,
  onChange,
  onSubmit,
  label,
  placeholder,
  submitLabel,
  disabled = false,
  loading = false,
  hint,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  label: string;
  placeholder: string;
  submitLabel: string;
  disabled?: boolean;
  loading?: boolean;
  hint?: string;
  testId?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 152)}px`;
  }, [value]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!disabled && !loading && value.trim()) void onSubmit();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  };

  return (
    <form
      aria-busy={loading}
      className="question-composer"
      data-testid={testId}
      onSubmit={submit}
      ref={formRef}
    >
      <label className="question-composer-field">
        <span className="sr-only">{label}</span>
        <textarea
          aria-describedby={hint ? "question-composer-hint" : undefined}
          disabled={disabled || loading}
          maxLength={500}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          ref={textareaRef}
          required
          rows={1}
          value={value}
        />
      </label>
      <button
        aria-label={submitLabel}
        className="question-composer-send"
        disabled={disabled || loading || !value.trim()}
        type="submit"
      >
        <span aria-hidden="true">{loading ? "···" : "↑"}</span>
      </button>
      {hint && (
        <p className="question-composer-hint" id="question-composer-hint">
          {hint}
        </p>
      )}
    </form>
  );
}
