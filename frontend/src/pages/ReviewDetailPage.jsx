import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { ErrorText, PageHeader, Spinner, StatusBadge } from '../components/common';

export default function ReviewDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [reason, setReason] = useState('');
  const [raw, setRaw] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get(`/api/review/verifications/${id}`).then(setData).catch(setError);
  useEffect(() => { load(); }, [id]);

  if (error && !data) return <ErrorText error={error} />;
  if (!data) return <Spinner />;

  const { verification, checks } = data;
  const decided = verification.status !== 'manual_review';

  async function decide(decision) {
    setError(null);
    if (!reason.trim()) { setError(new Error('A reason note is required.')); return; }
    setBusy(true);
    try {
      await api.post(`/api/review/verifications/${id}/decision`, { decision, reason });
      navigate('/app/review');
    } catch (err) { setError(err); setBusy(false); }
  }

  async function loadRaw() {
    setError(null);
    try { setRaw(await api.get(`/api/review/verifications/${id}/raw`)); }
    catch (err) { setError(err); }
  }

  return (
    <div>
      <PageHeader title="Review verification" subtitle={`Reference ${verification.id}`}>
        <StatusBadge status={verification.status} />
      </PageHeader>

      <div className="card mb-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <Info label="Subject type" value={verification.subject_type} />
          <Info label="Risk score" value={verification.risk_score ?? '—'} />
          <Info label="Submitted" value={new Date(verification.created_at).toLocaleString()} />
          <Info label="Reason" value={verification.decision_reason || '—'} />
        </div>
      </div>

      <div className="card mb-4">
        <h3 className="font-medium mb-3">Check outcomes</h3>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-gray-500 border-b"><th className="py-2">Check</th><th>Provider</th><th>Outcome</th><th>Score</th></tr></thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.id} className="border-b last:border-0">
                <td className="py-2">{c.check_type}</td>
                <td>{c.provider}</td>
                <td><StatusBadge status={c.outcome} /></td>
                <td>{c.score ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-gray-400 mt-3">Raw provider payloads are hidden. Access is admin-only and audited.</p>
        {user?.role === 'admin' && (
          <div className="mt-3">
            <button className="btn-secondary" onClick={loadRaw}>Reveal raw data (audited)</button>
            {raw && (
              <pre className="mt-3 bg-gray-900 text-gray-100 text-xs p-3 rounded-md overflow-x-auto max-h-72">
                {JSON.stringify(raw, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>

      {!decided && (
        <div className="card">
          <h3 className="font-medium mb-3">Decision</h3>
          <label className="label">Reason note (required)</label>
          <textarea className="input h-24 mb-3" value={reason} onChange={(e) => setReason(e.target.value)} />
          <ErrorText error={error} />
          <div className="flex gap-3">
            <button className="btn-primary" disabled={busy} onClick={() => decide('approved')}>Approve</button>
            <button className="btn-danger" disabled={busy} onClick={() => decide('rejected')}>Reject</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-gray-900">{value}</p>
    </div>
  );
}
