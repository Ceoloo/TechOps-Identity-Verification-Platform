import { useEffect, useState } from 'react';
import { api } from '../api';
import { ErrorText, PageHeader, Spinner } from '../components/common';

export default function ConsentPage() {
  const [versions, setVersions] = useState(null);
  const [active, setActive] = useState(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  async function load() {
    const list = await api.get('/api/admin/consent');
    setVersions(list);
    const activeMeta = list.find((v) => v.is_active);
    if (activeMeta) {
      const doc = await api.get(`/api/admin/consent/${activeMeta.version}`);
      setActive(doc);
      setBody(doc.body);
    } else {
      setActive(null); setBody('');
    }
  }
  useEffect(() => { load().catch(setError); }, []);

  if (error && !versions) return <ErrorText error={error} />;
  if (!versions) return <Spinner />;

  async function save() {
    setError(null); setSaved(false);
    try {
      await api.post('/api/admin/consent', { body });
      setSaved(true);
      await load();
    } catch (err) { setError(err); }
  }

  return (
    <div>
      <PageHeader title="Consent language" subtitle="Editing and saving creates a new active version; history is preserved." />
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-8 card">
          <label className="label">Consent text {active && <span className="text-gray-400">(active v{active.version})</span>}</label>
          <textarea className="input h-64" value={body} onChange={(e) => setBody(e.target.value)} />
          <ErrorText error={error} />
          <div className="flex items-center gap-3 mt-3">
            <button className="btn-primary" onClick={save}>Save as new version</button>
            {saved && <span className="text-sm text-green-600">Saved new version.</span>}
          </div>
        </div>
        <div className="col-span-12 lg:col-span-4 card">
          <h3 className="font-medium mb-3">Version history</h3>
          <ul className="space-y-2 text-sm">
            {versions.map((v) => (
              <li key={v.version} className="flex items-center justify-between">
                <span>v{v.version}</span>
                {v.is_active && <span className="badge bg-green-100 text-green-800">active</span>}
                <span className="text-gray-400 text-xs">{new Date(v.created_at).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
