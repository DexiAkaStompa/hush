type BrandMarkProps = {
  size?: number;
  className?: string;
  title?: string;
};

export function BrandMark({ size = 28, className, title }: BrandMarkProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <path
        d="M8 32c5.8-9.2 14.2-14 24-14s18.2 4.8 24 14c-5.8 9.2-14.2 14-24 14S13.8 41.2 8 32Z"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <path
        className="brand-mark-slash"
        d="m17 48 30-32"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <path
        d="M29.2 26.7a7 7 0 0 1 8.1 8.1"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
}
