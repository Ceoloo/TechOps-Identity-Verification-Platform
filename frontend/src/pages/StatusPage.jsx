import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { ErrorText, Spinner, StatusBadge } from '../components/common';

const MESSAGES = {
  approved: 'Your identity has been verified. Thank you.',
  rejected: 'We were unable to verify your identity.',
  manual_review: 'Your submission is under review. We will be in touch.',
  pending: 'Your submission is being processed.',
};

export default function StatusPage() {
  const { businessId, verificationId } = useParams();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/api/public/verifications/${businessId}/${verificationId}/status`, { auth: false })
      .then(setStatus)
      .catch(setError);
  }, [businessId, verificationId]);

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md card text-center">
        <h1 className="text-lg font-semibold text-gray-900 mb-4">Verification status</h1>
        {error && <ErrorText error={error} />}
        {!error && !status && <Spinner />}
        {status && (
          <>
            <div className="mb-4"><StatusBadge status={status.status} /></div>
            <p className="text-sm text-gray-600">{MESSAGES[status.status] || 'Status unavailable.'}</p>
            <p className="text-xs text-gray-400 mt-6">Reference: {status.verification_id}</p>
          </>
        )}
      </div>
    </div>
  );
}
