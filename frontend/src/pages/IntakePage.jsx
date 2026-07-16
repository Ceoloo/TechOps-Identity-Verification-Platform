import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { ErrorText, Spinner } from '../components/common';

export default function IntakePage() {
  const { businessId } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(null);
  const [values, setValues] = useState({});
  const [subjectType, setSubjectType] = useState('individual');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get(`/api/public/intake/${businessId}/form`, { auth: false })
      .then(setForm)
      .catch(setError);
  }, [businessId]);

  if (error && !form) {
    return <CenteredCard><ErrorText error={error} /></CenteredCard>;
  }
  if (!form) return <CenteredCard><Spinner /></CenteredCard>;

  const branding = form.business.branding || {};
  const primary = branding.colors?.primary || '#1f6feb';

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!consent) { setError(new Error('You must accept the consent statement.')); return; }
    setSubmitting(true);
    try {
      const res = await api.post(`/api/public/intake/${businessId}`, {
        subjectType,
        subject: values,
        consentAccepted: true,
        consentVersion: form.consent.version,
      }, { auth: false });
      navigate(`/verify/${businessId}/status/${res.verificationId}`);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <CenteredCard>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold" style={{ color: primary }}>
          {form.business.name}
        </h1>
        <p className="text-sm text-gray-500 mt-1">Identity verification</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">I am verifying as</label>
          <select className="input" value={subjectType} onChange={(e) => setSubjectType(e.target.value)}>
            {(form.subject_types || ['individual', 'business']).map((s) => (
              <option key={s} value={s}>{s === 'individual' ? 'An individual' : 'A business'}</option>
            ))}
          </select>
        </div>

        {form.fields.map((f) => (
          <div key={f.name}>
            <label className="label">
              {f.label}{f.required && <span className="text-red-500"> *</span>}
            </label>
            <input
              className="input"
              type={f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text'}
              required={f.required}
              value={values[f.name] || ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            />
          </div>
        ))}

        <div className="rounded-md bg-gray-50 ring-1 ring-gray-200 p-4">
          <p className="text-xs text-gray-600 whitespace-pre-wrap max-h-40 overflow-y-auto">
            {form.consent.body}
          </p>
          <label className="flex items-start gap-2 mt-3 text-sm">
            <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>I have read and accept the consent statement (v{form.consent.version}).</span>
          </label>
        </div>

        <ErrorText error={error} />
        <button className="btn-primary w-full" disabled={submitting} style={{ backgroundColor: primary }}>
          {submitting ? 'Submitting…' : 'Submit for verification'}
        </button>
      </form>
    </CenteredCard>
  );
}

function CenteredCard({ children }) {
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-lg card">{children}</div>
    </div>
  );
}
