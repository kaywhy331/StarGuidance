import type { ButtonHTMLAttributes } from "react";

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
