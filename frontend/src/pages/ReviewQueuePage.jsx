import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { ErrorText, PageHeader, Spinner, StatusBadge } from '../components/common';

export default function ReviewQueuePage() {
  const [queue, setQueue] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { api.get('/api/review/queue').then(setQueue).catch(setError); }, []);

  if (error && !queue) return <ErrorText error={error} />;
  if (!queue) return <Spinner />;

  return (
    <div>
      <PageHeader title="Manual review queue" subtitle="Verifications awaiting a human decision." />
      {queue.length === 0 ? (
        <div className="card text-sm text-gray-500">The queue is empty. 🎉</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="py-2">Reference</th><th>Type</th><th>Tier</th><th>Risk</th><th>Checks</th><th>Submitted</th><th></th>
              </tr>
            </thead>
            <tbody>
              {queue.map((v) => (
                <tr key={v.id} className="border-b last:border-0">
                  <td className="py-2 font-mono text-xs">{v.id.slice(0, 8)}…</td>
                  <td>{v.subject_type}</td>
                  <td>{v.tier_name || '—'}</td>
                  <td>{v.risk_score ?? '—'}</td>
                  <td>{v.check_count}</td>
                  <td className="text-gray-500">{new Date(v.created_at).toLocaleString()}</td>
                  <td><Link className="text-brand-600 hover:underline" to={`/app/review/${v.id}`}>Review →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
