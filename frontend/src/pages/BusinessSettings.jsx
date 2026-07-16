import { useEffect, useState } from 'react';
import { api } from '../api';
import { ErrorText, PageHeader, Spinner } from '../components/common';

export default function BusinessSettings() {
  const [biz, setBiz] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { api.get('/api/admin/business').then(setBiz).catch(setError); }, []);

  if (error && !biz) return <ErrorText error={error} />;
  if (!biz) return <Spinner />;

  const colors = biz.branding?.colors || {};

  async function save(e) {
    e.preventDefault();
    setError(null); setSaved(false);
    try {
      const updated = await api.patch('/api/admin/business', {
        name: biz.name,
        industry: biz.industry,
        jurisdiction: biz.jurisdiction,
        branding: biz.branding,
      });
      setBiz(updated);
      setSaved(true);
    } catch (err) { setError(err); }
  }

  const set = (patch) => setBiz((b) => ({ ...b, ...patch }));
  const setColor = (key, val) =>
    setBiz((b) => ({ ...b, branding: { ...b.branding, colors: { ...(b.branding?.colors || {}), [key]: val } } }));

  return (
    <div>
      <PageHeader title="Business profile" subtitle="Name, jurisdiction and branding for this tenant." />
      <form onSubmit={save} className="card space-y-4 max-w-2xl">
        <div>
          <label className="label">Name</label>
          <input className="input" value={biz.name || ''} onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Industry</label>
            <input className="input" value={biz.industry || ''} onChange={(e) => set({ industry: e.target.value })} />
          </div>
          <div>
            <label className="label">Jurisdiction</label>
            <input className="input" value={biz.jurisdiction || ''} onChange={(e) => set({ jurisdiction: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="label">Logo URL</label>
          <input className="input" value={biz.branding?.logo_url || ''}
            onChange={(e) => set({ branding: { ...biz.branding, logo_url: e.target.value } })} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Primary color</label>
            <input className="input" value={colors.primary || ''} onChange={(e) => setColor('primary', e.target.value)} placeholder="#1f6feb" />
          </div>
          <div>
            <label className="label">Accent color</label>
            <input className="input" value={colors.accent || ''} onChange={(e) => setColor('accent', e.target.value)} placeholder="#0abf53" />
          </div>
        </div>
        <ErrorText error={error} />
        <div className="flex items-center gap-3">
          <button className="btn-primary">Save changes</button>
          {saved && <span className="text-sm text-green-600">Saved.</span>}
        </div>
      </form>
    </div>
  );
}
