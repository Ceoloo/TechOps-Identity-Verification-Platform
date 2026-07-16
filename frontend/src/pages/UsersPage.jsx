import { useEffect, useState } from 'react';
import { api } from '../api';
import { ErrorText, PageHeader, Spinner } from '../components/common';

export default function UsersPage() {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ email: '', password: '', role: 'reviewer', fullName: '' });
  const [msg, setMsg] = useState(null);

  const load = () => api.get('/api/admin/users').then(setUsers).catch(setError);
  useEffect(() => { load(); }, []);

  if (error && !users) return <ErrorText error={error} />;
  if (!users) return <Spinner />;

  async function create(e) {
    e.preventDefault();
    setError(null); setMsg(null);
    try {
      await api.post('/api/admin/users', form);
      setMsg('User created.');
      setForm({ email: '', password: '', role: 'reviewer', fullName: '' });
      await load();
    } catch (err) { setError(err); }
  }

  return (
    <div>
      <PageHeader title="Users" subtitle="Internal admin and reviewer accounts." />
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-7 card">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b"><th className="py-2">Email</th><th>Role</th><th>Active</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b last:border-0">
                  <td className="py-2">{u.email}</td>
                  <td><span className="badge bg-brand-50 text-brand-700">{u.role}</span></td>
                  <td>{u.is_active ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form onSubmit={create} className="col-span-12 lg:col-span-5 card space-y-3">
          <h3 className="font-medium">Add user</h3>
          <input className="input" placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <input className="input" placeholder="Full name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          <input className="input" placeholder="Password (min 8 chars)" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="reviewer">reviewer</option>
            <option value="admin">admin</option>
          </select>
          <ErrorText error={error} />
          {msg && <p className="text-sm text-green-600">{msg}</p>}
          <button className="btn-primary w-full">Create user</button>
        </form>
      </div>
    </div>
  );
}
