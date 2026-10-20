// tokenmaxx fork: sidebar icon for Conversations (two speech bubbles).
export function IconConversations({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 5h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8l-4 3V6a1 1 0 0 1 1-1z" />
      <path d="M16 9h3a1 1 0 0 1 1 1v9l-3-2.5h-6a1 1 0 0 1-1-1V13" />
    </svg>
  );
}
