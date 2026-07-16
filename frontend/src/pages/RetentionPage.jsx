import { useEffect, useState } from 'react';
import { api } from '../api';
import { ErrorText, PageHeader, Spinner } from '../components/common';

const DATA_TYPES = ['verification_checks', 'consent_records'];

export default function RetentionPage() {
  const [policies, setPolicies] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const load = () => api.get('/api/admin/retention').then(setPolicies).catch(setError);
  useEffect(() => { load(); }, []);

  if (error && !policies) return <ErrorText error={error} />;
  if (!policies) return <Spinner />;

  const byType = Object.fromEntries(policies.map((p) => [p.data_type, p.retention_days]));

  async function save(dataType, days) {
    setError(null); setSaved(false);
    try {
      await api.put(`/api/admin/retention/${dataType}`, { retention_days: Number(days) });
      setSaved(true);
      await load();
    } catch (err) { setError(err); }
  }

  return (
    <div>
      <PageHeader title="Retention policies" subtitle="Data past its window is anonymised (checks) or deleted (consents) by the retention job." />
      <div className="card max-w-xl space-y-4">
        {DATA_TYPES.map((dt) => (
          <RetentionRow key={dt} dataType={dt} value={byType[dt]} onSave={save} />
        ))}
        <ErrorText error={error} />
        {saved && <span className="text-sm text-green-600">Saved.</span>}
      </div>
    </div>
  );
}

function RetentionRow({ dataType, value, onSave }) {
  const [days, setDays] = useState(value ?? 365);
  return (
    <div className="flex items-end gap-3">
      <div className="flex-1">
        <label className="label">{dataType}</label>
        <input className="input" type="number" min="0" value={days} onChange={(e) => setDays(e.target.value)} />
      </div>
      <span className="text-sm text-gray-500 pb-2">days</span>
      <button className="btn-secondary" onClick={() => onSave(dataType, days)}>Save</button>
    </div>
  );
}
