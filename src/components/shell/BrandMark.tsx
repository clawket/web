export interface BrandMarkProps {
  size?: number;
  className?: string;
  'aria-hidden'?: boolean;
}

export function BrandMark({
  size = 24,
  className,
  'aria-hidden': ariaHidden = true,
}: BrandMarkProps) {
  return (
    <svg
      data-testid="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={ariaHidden}
      className={className}
    >
      <rect x="6" y="12" width="18" height="10" rx="2" fill="#FACC15" />
      <circle cx="6" cy="17" r="2" fill="white" />
      <circle cx="15" cy="17" r="1.5" fill="#111827" />
      <path d="M20 6 C24 4, 28 8, 24 12" stroke="#EF4444" strokeWidth="3" strokeLinecap="round" />
      <path d="M20 6 C22 10, 18 12, 16 10" stroke="#EF4444" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
