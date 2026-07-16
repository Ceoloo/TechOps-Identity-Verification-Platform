import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

const adminNav = [
  { to: '/app/business', label: 'Business' },
  { to: '/app/tiers', label: 'Verification tiers' },
  { to: '/app/integrations', label: 'Integrations' },
  { to: '/app/consent', label: 'Consent' },
  { to: '/app/retention', label: 'Retention' },
  { to: '/app/notifications', label: 'Notifications' },
  { to: '/app/users', label: 'Users' },
  { to: '/app/audit', label: 'Audit log' },
  { to: '/app/data-subjects', label: 'Data subjects' },
];
const reviewerNav = [{ to: '/app/review', label: 'Review queue' }];

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';
  const nav = [...reviewerNav, ...(isAdmin ? adminNav : [])];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="font-semibold text-gray-900">TechOps Verify</div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-500">{user?.email}</span>
            <span className="badge bg-brand-50 text-brand-700">{user?.role}</span>
            <button
              className="btn-secondary"
              onClick={() => { logout(); navigate('/login'); }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-12 gap-6">
        <nav className="col-span-12 md:col-span-3 lg:col-span-2">
          <ul className="space-y-1">
            {nav.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    `block rounded-md px-3 py-2 text-sm ${
                      isActive ? 'bg-brand-50 text-brand-700 font-medium' : 'text-gray-700 hover:bg-gray-100'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main className="col-span-12 md:col-span-9 lg:col-span-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
