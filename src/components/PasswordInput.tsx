"use client";

import { useState, type InputHTMLAttributes } from "react";

/** Password box with a Show / Hide button so people can check what they typed (useful on phones). */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={show ? "text" : "password"} className={`${props.className ?? "input"} pr-16`} />
      <button type="button" onClick={() => setShow((s) => !s)} aria-pressed={show} aria-label={show ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex min-w-14 items-center justify-center px-3 text-xs font-semibold text-brand-blue">
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}
