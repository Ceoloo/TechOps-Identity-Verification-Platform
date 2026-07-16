import { useEffect, useState } from 'react';
import { api } from '../api';
import { ErrorText, PageHeader, Spinner } from '../components/common';

// Known secret fields per provider (for the key-entry form).
const SECRET_FIELDS = {
  stripe_identity: ['secret_key'],
  persona: ['api_key', 'template_id'],
  ofac: ['api_key'],
  opencorporates: ['api_token'],
  twilio_lookup: ['account_sid', 'auth_token'],
  email_otp: [],
};

export default function IntegrationsPage() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = () => api.get('/api/admin/integrations').then(setItems).catch(setError);
  useEffect(() => { load(); }, []);

  if (error && !items) return <ErrorText error={error} />;
  if (!items) return <Spinner />;

  return (
    <div>
      <PageHeader title="Provider integrations" subtitle="Enter or rotate API keys per provider. Secrets are encrypted and never displayed." />
      <div className="space-y-3">
        {items.map((it) => (
          <div key={it.provider} className="card flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{it.provider}</span>
                {it.is_active
                  ? <span className="badge bg-green-100 text-green-800">active</span>
                  : <span className="badge bg-gray-100 text-gray-600">inactive</span>}
                <span className="badge bg-gray-100 text-gray-600">{it.mode}</span>
                {it.has_secret && <span className="badge bg-brand-50 text-brand-700">key set</span>}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {(it.config_meta?.fields_set || []).length ? `fields: ${it.config_meta.fields_set.join(', ')}` : 'no secret fields'}
              </p>
            </div>
            <button className="btn-secondary" onClick={() => setEditing(it)}>Configure</button>
          </div>
        ))}
      </div>

      {editing && (
        <IntegrationEditor item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

function IntegrationEditor({ item, onClose, onSaved }) {
  const fields = SECRET_FIELDS[item.provider] || [];
  const [secret, setSecret] = useState({});
  const [isActive, setIsActive] = useState(item.is_active);
  const [mode, setMode] = useState(item.mode || 'sandbox');
  const [error, setError] = useState(null);

  async function save() {
    setError(null);
    const config = {};
    for (const f of fields) if (secret[f]) config[f] = secret[f];
    try {
      await api.put(`/api/admin/integrations/${item.provider}`, {
        is_active: isActive,
        mode,
        config: Object.keys(config).length ? config : undefined,
      });
      onSaved();
    } catch (err) { setError(err); }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-10" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">Configure {item.provider}</h2>
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active
            </label>
            <select className="input w-auto" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="sandbox">sandbox</option>
              <option value="live">live</option>
            </select>
          </div>
          {fields.length === 0 && <p className="text-sm text-gray-500">This provider requires no API key.</p>}
          {fields.map((f) => (
            <div key={f}>
              <label className="label">{f}</label>
              <input className="input" type="password" placeholder={item.has_secret ? '•••• (leave blank to keep)' : ''}
                value={secret[f] || ''} onChange={(e) => setSecret((s) => ({ ...s, [f]: e.target.value }))} />
            </div>
          ))}
          <ErrorText error={error} />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={save}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
