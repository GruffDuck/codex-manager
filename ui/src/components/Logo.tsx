interface LogoProps {
  size?: number;
  className?: string;
}

/** The mark: a terminal prompt whose cursor is a three-cell quota battery. */
export function Logo({ size = 28, className }: LogoProps) {
  return (
    <svg
      className={`logo${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="logo-body" width="32" height="32" rx="8" />
      <path className="logo-prompt" d="M5.8 11.2 11 16l-5.2 4.8" />
      <rect className="logo-cell" x="13.4" y="19.2" width="4.2" height="2.7" rx="1.1" />
      <rect className="logo-cell" x="18.4" y="19.2" width="4.2" height="2.7" rx="1.1" />
      <rect className="logo-accent" x="23.4" y="19.2" width="2.9" height="2.7" rx="1.1" />
    </svg>
  );
}
