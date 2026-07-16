import { useEffect, useState } from 'react';
import { api } from '../api';
import { ErrorText, PageHeader, Spinner, StatusBadge } from '../components/common';

const CHECK_TYPES = [
  { check_type: 'id_document', provider: 'stripe_identity' },
  { check_type: 'liveness', provider: 'stripe_identity' },
  { check_type: 'sanctions_screening', provider: 'ofac' },
  { check_type: 'business_registry', provider: 'opencorporates' },
  { check_type: 'phone', provider: 'twilio_lookup' },
  { check_type: 'email_otp', provider: 'email_otp' },
];

export default function TiersPage() {
  const [tiers, setTiers] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = () => api.get('/api/admin/tiers').then(setTiers).catch(setError);
  useEffect(() => { load(); }, []);

  if (error && !tiers) return <ErrorText error={error} />;
  if (!tiers) return <Spinner />;

  return (
    <div>
      <PageHeader title="Verification tiers" subtitle="Configure which checks are required and the risk thresholds.">
        <button className="btn-primary" onClick={() => setEditing({ tier_name: '', required_checks: [], risk_thresholds: { auto_approve: { all_required_pass: true, max_risk_score: 30 }, auto_reject: { any_sanctions_hit: true, min_risk_score: 80 }, default: 'manual_review' }, is_active: true })}>New tier</button>
      </PageHeader>

      <div className="space-y-3">
        {tiers.map((t) => (
          <div key={t.id} className="card flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{t.tier_name}</span>
                {t.is_active ? <StatusBadge status="pass" /> : <span className="badge bg-gray-100 text-gray-600">inactive</span>}
              </div>
              <p className="text-sm text-gray-500 mt-1">{(t.required_checks || []).map((c) => c.check_type || c).join(', ') || 'no checks'}</p>
            </div>
            <button className="btn-secondary" onClick={() => setEditing(t)}>Edit</button>
          </div>
        ))}
        {tiers.length === 0 && <p className="text-sm text-gray-500">No tiers yet.</p>}
      </div>

      {editing && (
        <TierEditor
          tier={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function TierEditor({ tier, onClose, onSaved }) {
  const [draft, setDraft] = useState(() => ({
    ...tier,
    required_checks: Array.isArray(tier.required_checks) ? tier.required_checks : [],
  }));
  const [error, setError] = useState(null);
  const isNew = !tier.id;

  const selected = new Set(draft.required_checks.map((c) => c.check_type || c));
  function toggle(ct) {
    const spec = CHECK_TYPES.find((c) => c.check_type === ct);
    setDraft((d) => {
      const has = d.required_checks.some((c) => (c.check_type || c) === ct);
      return {
        ...d,
        required_checks: has
          ? d.required_checks.filter((c) => (c.check_type || c) !== ct)
          : [...d.required_checks, { ...spec, required: true }],
      };
    });
  }

  async function save() {
    setError(null);
    try {
      if (isNew) {
        await api.post('/api/admin/tiers', draft);
      } else {
        await api.patch(`/api/admin/tiers/${tier.id}`, {
          tier_name: draft.tier_name,
          required_checks: draft.required_checks,
          risk_thresholds: draft.risk_thresholds,
          is_active: draft.is_active,
        });
      }
      onSaved();
    } catch (err) { setError(err); }
  }

  return (
    <Modal onClose={onClose} title={isNew ? 'New tier' : `Edit ${tier.tier_name}`}>
      <div className="space-y-4">
        <div>
          <label className="label">Tier name</label>
          <input className="input" value={draft.tier_name} onChange={(e) => setDraft((d) => ({ ...d, tier_name: e.target.value }))} />
        </div>
        <div>
          <label className="label">Required checks</label>
          <div className="grid grid-cols-2 gap-2">
            {CHECK_TYPES.map((c) => (
              <label key={c.check_type} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={selected.has(c.check_type)} onChange={() => toggle(c.check_type)} />
                {c.check_type} <span className="text-gray-400">({c.provider})</span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="label">Risk thresholds (JSON)</label>
          <textarea
            className="input font-mono text-xs h-40"
            value={JSON.stringify(draft.risk_thresholds, null, 2)}
            onChange={(e) => {
              try { setDraft((d) => ({ ...d, risk_thresholds: JSON.parse(e.target.value) })); setError(null); }
              catch { setError(new Error('Invalid JSON')); }
            }}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft((d) => ({ ...d, is_active: e.target.checked }))} />
          Active
        </label>
        <ErrorText error={error} />
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-10" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">{title}</h2>
        {children}
      </div>
    </div>
  );
}
