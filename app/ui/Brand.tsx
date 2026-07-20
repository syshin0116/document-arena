export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand" data-compact={compact || undefined} aria-label="Document Arena">
      <span className="brand-wordmark" aria-hidden="true">
        Document Arena
      </span>
    </span>
  );
}
