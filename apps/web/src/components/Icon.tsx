const paths = {
  pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  search: 'm21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  chevron: 'm9 5 7 7-7 7',
  down: 'm6 9 6 6 6-6',
  close: 'm6 6 12 12M6 18 18 6',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  bag: 'M5 7h14l1 14H4L5 7Zm3 0V5a4 4 0 0 1 8 0v2',
  heart:
    'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
  fork: 'M5 2v7m4-7v7M3 2v5a4 4 0 0 0 8 0V2M7 11v11M20 2c-4 3-5 8-1 10h1m0-10v20',
  sliders: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  check: 'm5 12 4 4L19 6',
} as const;
export function Icon({
  name,
  size = 22,
  className = '',
}: {
  name: keyof typeof paths;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
