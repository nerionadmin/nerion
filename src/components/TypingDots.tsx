export default function TypingDots() {
  return (
    <div className="flex items-center px-4 py-2" role="status" aria-live="polite">
      <div className="text-[var(--text)] text-5xl sm:text-6xl font-bold select-none pulse-scale">
        •
      </div>
    </div>
  );
}
