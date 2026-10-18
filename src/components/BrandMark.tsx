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
      viewBox="0 0 48 48"
      fill="none"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <path fill="currentColor" fillRule="evenodd" d="M13 7h22a7 7 0 0 1 7 7v17a7 7 0 0 1-7 7H20L7 44V14a7 7 0 0 1 6-7Zm2.7 6.2h4.4v7.15h8.8V13.2h4.4v14.3l-4.4 4.4v-7.15h-8.8v6.05h-4.4Z" />
    </svg>
  );
}
