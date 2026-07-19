export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand" aria-label="Document Arena">
      <span className="brand-mark" aria-hidden="true">
        <span />
        <span />
      </span>
      {!compact && <span className="brand-name">Document Arena</span>}
    </span>
  );
}
