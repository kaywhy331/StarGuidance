"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { requestJson } from "@/lib/client-request";

export interface SavedPerson {
  id: string;
  name: string;
  /** The `@handle` a question uses to bring this person into a reading. */
  mention: string;
}

/** Loads the reader's saved people (GET /api/people lists only active ones).
 * Returns an empty list when disabled, signed out, or on any failure. */
export function useSavedPeople(enabled: boolean): readonly SavedPerson[] {
  const [people, setPeople] = useState<readonly SavedPerson[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void requestJson<{ profiles?: SavedPerson[] }>("/api/people", { cache: "no-store" }).then(
      (result) => {
        if (!active || !result.ok) return;
        setPeople(
          (result.data.profiles ?? []).filter(
            (person) =>
              typeof person.mention === "string" &&
              person.mention.length > 1 &&
              typeof person.name === "string",
          ),
        );
      },
    );
    return () => {
      active = false;
    };
  }, [enabled]);
  return enabled ? people : [];
}

/** The partial `@handle` immediately before the caret, if any. */
export function mentionQueryAt(
  text: string,
  caret: number,
): { start: number; query: string } | undefined {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([\p{L}\p{N}-]*)$/u.exec(before);
  if (!match) return undefined;
  const query = match[2] ?? "";
  return { start: caret - query.length - 1, query };
}

export function matchingPeople(
  people: readonly SavedPerson[],
  query: string,
): readonly SavedPerson[] {
  const needle = query.toLocaleLowerCase("en-US");
  return people
    .filter(
      (person) =>
        person.mention.slice(1).startsWith(needle) ||
        person.name.toLocaleLowerCase("en-US").includes(needle),
    )
    .slice(0, 6);
}

/**
 * `@handle` autocomplete for a question textarea. The caller renders
 * `popover` and `helper` near the field, spreads `textareaProps` onto the
 * textarea, and calls `handleKeyDown` first in its own key handler (it
 * returns true when it consumed the key).
 */
export function useMentionAutocomplete({
  people,
  textareaRef,
  value,
  onChange,
}: {
  people: readonly SavedPerson[];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
}): {
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  helper: ReactNode;
  popover: ReactNode;
  textareaProps: Record<string, string | boolean | undefined | (() => void)>;
} {
  const listId = useId();
  const [caret, setCaret] = useState<number>();
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number>();

  const query = caret === undefined ? undefined : mentionQueryAt(value, caret);
  const options = useMemo(
    () => (query && people.length > 0 ? matchingPeople(people, query.query) : []),
    [people, query],
  );
  const open = options.length > 0 && dismissedAt !== query?.start;
  const active = Math.min(activeIndex, Math.max(0, options.length - 1));

  const syncCaret = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) setCaret(textarea.selectionStart ?? undefined);
  }, [textareaRef]);

  const insert = (person: SavedPerson) => {
    if (!query) return;
    const end = query.start + query.query.length + 1;
    const next = `${value.slice(0, query.start)}${person.mention} ${value.slice(end)}`.slice(
      0,
      500,
    );
    const nextCaret = Math.min(next.length, query.start + person.mention.length + 1);
    onChange(next);
    setActiveIndex(0);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(nextCaret, nextCaret);
      setCaret(nextCaret);
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((active + offset + options.length) % options.length);
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      const person = options[active];
      if (!person) return false;
      event.preventDefault();
      insert(person);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDismissedAt(query?.start);
      return true;
    }
    return false;
  };

  const optionId = (index: number) => `${listId}-option-${index}`;

  return {
    handleKeyDown,
    helper:
      people.length > 0 ? (
        <p className="people-mention-helper">
          Ask about someone you’ve saved? Type <kbd>@</kbd> ·{" "}
          <Link href="/people">Manage people</Link>
        </p>
      ) : null,
    popover: open ? (
      <ul aria-label="Saved people" className="people-mention-popover" id={listId} role="listbox">
        {options.map((person, index) => (
          <li
            aria-selected={index === active}
            className={index === active ? "is-active" : undefined}
            id={optionId(index)}
            key={person.id}
            onMouseDown={(event) => {
              // Keep focus in the textarea while choosing.
              event.preventDefault();
              insert(person);
            }}
            role="option"
          >
            <strong>{person.mention}</strong>
            <span>{person.name}</span>
          </li>
        ))}
      </ul>
    ) : null,
    textareaProps:
      people.length > 0
        ? {
            "aria-autocomplete": "list",
            "aria-controls": open ? listId : undefined,
            "aria-activedescendant": open ? optionId(active) : undefined,
            onKeyUp: syncCaret,
            onClick: syncCaret,
            onSelect: syncCaret,
            onBlur: () => setCaret(undefined),
          }
        : {},
  };
}
