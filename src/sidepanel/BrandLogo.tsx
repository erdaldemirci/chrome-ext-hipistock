type Props = {
  className?: string;
};

/** LoadingBag “O” mark — circle with right-side wedge. */
export function BrandLogo({ className }: Props) {
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M50 50 L100 50 A50 50 0 1 1 82.14 10.98 Z"
      />
    </svg>
  );
}
