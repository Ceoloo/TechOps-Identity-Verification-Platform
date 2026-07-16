// Small shared presentational helpers.

export function StatusBadge({ status }) {
  const map = {
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
    manual_review: 'bg-amber-100 text-amber-800',
    pending: 'bg-gray-100 text-gray-700',
    pass: 'bg-green-100 text-green-800',
    fail: 'bg-red-100 text-red-800',
    error: 'bg-red-100 text-red-800',
  };
  return (
    <span className={`badge ${map[status] || 'bg-gray-100 text-gray-700'}`}>
      {String(status || '').replace(/_/g, ' ')}
    </span>
  );
}

export function ErrorText({ error }) {
  if (!error) return null;
  return <p className="text-sm text-red-600 mt-2">{error.message || String(error)}</p>;
}

export function Spinner({ label = 'Loading…' }) {
  return <p className="text-sm text-gray-500">{label}</p>;
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
