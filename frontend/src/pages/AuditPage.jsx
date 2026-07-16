import { useEffect, useState } from 'react';
import { api } from '../api';
import { ErrorText, PageHeader, Spinner } from '../components/common';

export default function AuditPage() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ action: '', actor: '', from: '', to: '' });

  async function load(f = filters) {
    setError(null);
    const params = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v) params.set(k, v); });
    try { setRows(await api.get(`/api/audit/log?${params.toString()}`)); }
    catch (err) { setError(err); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div>
      <PageHeader title="Audit log" subtitle="Every security-relevant action, tenant-scoped." />
      <div className="card mb-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
          <div><label className="label">Action</label><input className="input" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} placeholder="pii.read" /></div>
          <div><label className="label">Actor</label><input className="input" value={filters.actor} onChange={(e) => setFilters({ ...filters, actor: e.target.value })} /></div>
          <div><label className="label">From</label><input className="input" type="datetime-local" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></div>
          <div><label className="label">To</label><input className="input" type="datetime-local" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></div>
          <button className="btn-primary" onClick={() => load()}>Filter</button>
        </div>
      </div>

      <ErrorText error={error} />
      {!rows ? <Spinner /> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b"><th className="py-2">Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Metadata</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 align-top">
                  <td className="py-2 text-gray-500 whitespace-nowrap">{new Date(r.timestamp).toLocaleString()}</td>
                  <td>{r.actor}</td>
                  <td><span className="badge bg-gray-100 text-gray-700">{r.action}</span></td>
                  <td className="text-xs">{r.target_type}{r.target_id ? `:${String(r.target_id).slice(0, 8)}…` : ''}</td>
                  <td className="text-xs font-mono text-gray-500 max-w-xs truncate">{JSON.stringify(r.metadata)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan="5" className="py-4 text-gray-500 text-center">No entries.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
