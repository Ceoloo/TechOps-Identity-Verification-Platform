import { useState } from 'react';
import { api } from '../api';
import { ErrorText, PageHeader } from '../components/common';

export default function DataSubjectsPage() {
  const [email, setEmail] = useState('');
  const [subjects, setSubjects] = useState(null);
  const [records, setRecords] = useState(null);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);

  async function search(e) {
    e.preventDefault();
    setError(null); setMsg(null); setRecords(null);
    try { setSubjects(await api.get(`/api/audit/subjects?email=${encodeURIComponent(email)}`)); }
    catch (err) { setError(err); }
  }

  async function view(id) {
    setError(null);
    try { setRecords(await api.get(`/api/audit/subjects/${id}/records`)); }
    catch (err) { setError(err); }
  }

  async function erase(id) {
    setError(null); setMsg(null);
    if (!window.confirm('Permanently delete ALL data for this subject? This cannot be undone.')) return;
    try {
      const res = await api.del(`/api/audit/subjects/${id}`);
      setMsg(`Erased: ${res.verifications_deleted} verification(s), ${res.consents_deleted} consent(s), ${res.subjects_deleted} subject record.`);
      setRecords(null);
      setSubjects((s) => (s || []).filter((x) => x.id !== id));
    } catch (err) { setError(err); }
  }

  return (
    <div>
      <PageHeader title="Data subject requests" subtitle="Find, export, and erase a subject's data (GDPR/CCPA)." />
      <form onSubmit={search} className="card mb-4 flex items-end gap-3 max-w-xl">
        <div className="flex-1">
          <label className="label">Subject email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <button className="btn-primary">Search</button>
      </form>

      <ErrorText error={error} />
      {msg && <div className="card mb-4 text-sm text-green-700 bg-green-50">{msg}</div>}

      {subjects && (
        <div className="card mb-4">
          <h3 className="font-medium mb-3">Matches ({subjects.length})</h3>
          {subjects.length === 0 ? <p className="text-sm text-gray-500">No subjects found.</p> : (
            <ul className="space-y-2">
              {subjects.map((s) => (
                <li key={s.id} className="flex items-center justify-between text-sm border-b last:border-0 py-2">
                  <span className="font-mono text-xs">{s.id}</span>
                  <span className="flex gap-2">
                    <button className="btn-secondary" onClick={() => view(s.id)}>View records</button>
                    <button className="btn-danger" onClick={() => erase(s.id)}>Erase all</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {records && (
        <div className="card">
          <h3 className="font-medium mb-3">Subject records (DSAR access)</h3>
          <p className="text-sm text-gray-500 mb-2">
            {records.consent_records.length} consent record(s), {records.verifications.length} verification(s),
            {' '}{records.verification_checks.length} check(s).
          </p>
          <pre className="bg-gray-900 text-gray-100 text-xs p-3 rounded-md overflow-x-auto max-h-96">
            {JSON.stringify(records, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
