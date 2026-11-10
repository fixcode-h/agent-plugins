/** UE 页在图标栏里的图标：通用的手柄（不用 Epic 的标志，设计文档 4.1） */
export function GamepadIcon({ className, strokeWidth = 1.75 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6.5 7h11a4.5 4.5 0 0 1 4.4 5.4l-.9 4.4a2.6 2.6 0 0 1-4.6 1.1L14.6 16H9.4l-1.8 1.9a2.6 2.6 0 0 1-4.6-1.1l-.9-4.4A4.5 4.5 0 0 1 6.5 7Z" />
      <path d="M7.5 10.5v3M6 12h3" />
      <circle cx="15.5" cy="11" r=".6" fill="currentColor" />
      <circle cx="17.5" cy="13" r=".6" fill="currentColor" />
    </svg>
  )
}
