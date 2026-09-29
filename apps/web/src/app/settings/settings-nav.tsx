"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["Account", "/settings/account"],
  ["Privacy", "/settings/privacy"],
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="settings-subnav">
      {LINKS.map(([label, href]) => (
        <Link aria-current={pathname === href ? "page" : undefined} href={href} key={href}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function SettingSwitch({
  label,
  description,
  checked,
  defaultChecked,
  name,
  onChange,
  disabled,
  note,
  children,
}: {
  label: string;
  description: string;
  checked?: boolean;
  defaultChecked?: boolean;
  name?: string;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <div className="settings-switch-row">
      <label className="settings-switch">
        <span className="settings-switch__copy">
          <strong>{label}</strong>
          <span>{description}</span>
          {note ? <em>{note}</em> : null}
        </span>
        <input
          {...(checked === undefined ? { defaultChecked } : { checked })}
          disabled={disabled}
          name={name}
          onChange={onChange ? (event) => onChange(event.target.checked) : undefined}
          role="switch"
          type="checkbox"
        />
        <span aria-hidden="true" className="settings-switch__track">
          <i />
        </span>
      </label>
      {children}
    </div>
  );
}
