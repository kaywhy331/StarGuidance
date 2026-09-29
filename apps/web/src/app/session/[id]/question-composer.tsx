"use client";

import { useEffect, useId, useRef, type FormEvent, type KeyboardEvent } from "react";

import { useMentionAutocomplete, useSavedPeople } from "./people-mentions";

export const QUESTION_MAX_LENGTH = 500;
/** The character counter appears once a question gets this close to the limit. */
export const QUESTION_COUNTER_THRESHOLD = 400;

export function QuestionComposer({
  value,
  onChange,
  onSubmit,
  label,
  placeholder,
  submitLabel,
  disabled = false,
  disabledReason,
  loading = false,
  hint,
  testId,
  autoFocus = false,
  mentions = false,
  showSubmitLabel = false,
  variant = "inline",
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  label: string;
  placeholder: string;
  submitLabel: string;
  disabled?: boolean;
  /** Shown in place of the hint whenever the field is disabled, so a closed
   * field always says why. */
  disabledReason?: string;
  loading?: boolean;
  hint?: string;
  testId?: string;
  autoFocus?: boolean;
  /** Offer `@handle` autocomplete for the signed-in reader's saved people. */
  mentions?: boolean;
  /** Show `submitLabel` as visible text instead of only an arrow glyph. */
  showSubmitLabel?: boolean;
  /** `primary` is the large opening-question field. */
  variant?: "inline" | "primary";
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  const counterId = useId();
  const people = useSavedPeople(mentions);
  const mention = useMentionAutocomplete({ people, textareaRef, value, onChange });

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || variant === "primary") return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 152)}px`;
  }, [value, variant]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!disabled && !loading && value.trim()) void onSubmit();
  };
  // Enter sends, Shift+Enter adds a line — the same in every question field.
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention.handleKeyDown(event)) return;
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  };
  const visibleHint = disabled && disabledReason ? disabledReason : hint;
  const counterVisible = value.length >= QUESTION_COUNTER_THRESHOLD;
  const describedBy =
    [visibleHint ? hintId : "", counterVisible ? counterId : ""].filter(Boolean).join(" ") ||
    undefined;

  return (
    <form
      aria-busy={loading}
      className={`question-composer ${variant === "primary" ? "question-composer--primary" : ""}`}
      data-testid={testId}
      onSubmit={submit}
      ref={formRef}
    >
      <label className="question-composer-field">
        <span className="sr-only">{label}</span>
        <textarea
          aria-describedby={describedBy}
          autoFocus={autoFocus}
          disabled={disabled || loading}
          maxLength={QUESTION_MAX_LENGTH}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          ref={textareaRef}
          required
          rows={variant === "primary" ? 4 : 1}
          value={value}
          {...mention.textareaProps}
        />
      </label>
      {mention.popover}
      <button
        aria-label={showSubmitLabel ? undefined : submitLabel}
        className={`question-composer-send ${showSubmitLabel ? "has-label" : ""}`}
        disabled={disabled || loading || !value.trim()}
        type="submit"
      >
        {showSubmitLabel ? (
          <span>{loading ? "One moment…" : submitLabel}</span>
        ) : (
          <span aria-hidden="true">{loading ? "···" : "↑"}</span>
        )}
      </button>
      {(visibleHint || counterVisible) && (
        <div className="question-composer-meta">
          {visibleHint && (
            <p className="question-composer-hint" id={hintId}>
              {visibleHint}
            </p>
          )}
          {counterVisible && (
            <p
              aria-live="polite"
              className={`question-composer-counter ${value.length >= QUESTION_MAX_LENGTH ? "is-full" : ""}`}
              id={counterId}
            >
              {value.length} / {QUESTION_MAX_LENGTH}
            </p>
          )}
        </div>
      )}
      {!disabled && mention.helper}
    </form>
  );
}
