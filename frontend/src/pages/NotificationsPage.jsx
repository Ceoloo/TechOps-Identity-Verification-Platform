import { useEffect, useState } from 'react';
import { api } from '../api';
import { ErrorText, PageHeader, Spinner } from '../components/common';

export default function NotificationsPage() {
  const [settings, setSettings] = useState(null);
  const [emails, setEmails] = useState('');
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  async function load() {
    const list = await api.get('/api/admin/notifications');
    setSettings(list);
    const mr = list.find((s) => s.event_type === 'manual_review');
    setEmails((mr?.emails || []).join(', '));
  }
  useEffect(() => { load().catch(setError); }, []);

  if (error && !settings) return <ErrorText error={error} />;
  if (!settings) return <Spinner />;

  async function save() {
    setError(null); setSaved(false);
    const list = emails.split(',').map((e) => e.trim()).filter(Boolean);
    try {
      await api.put('/api/admin/notifications/manual_review', { emails: list, is_active: true });
      setSaved(true);
      await load();
    } catch (err) { setError(err); }
  }

  return (
    <div>
      <PageHeader title="Notifications" subtitle="Who gets emailed when a verification is routed to manual review." />
      <div className="card max-w-xl space-y-4">
        <div>
          <label className="label">Manual-review recipients (comma-separated)</label>
          <input className="input" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="ops@acme.com, compliance@acme.com" />
        </div>
        <ErrorText error={error} />
        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={save}>Save</button>
          {saved && <span className="text-sm text-green-600">Saved.</span>}
        </div>
      </div>
    </div>
  );
}
