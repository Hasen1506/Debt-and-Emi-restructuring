'use client';
import { useEffect, useState } from 'react';
import { flushPendingState, getSyncStatus, SYNC_CHANGED_EVENT } from '@/lib/server-sync';

export function AccountSyncNotice() {
  const [status, setStatus] = useState(getSyncStatus);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    const update = () => setStatus(getSyncStatus());
    window.addEventListener(SYNC_CHANGED_EVENT, update);
    update();
    return () => window.removeEventListener(SYNC_CHANGED_EVENT, update);
  }, []);
  if (status === 'saved') return null;
  return <div className="app-shell" role={status === 'failed' ? 'alert' : 'status'} style={{ marginTop: 12, fontSize: 13 }}>
    {status === 'failed' ? 'Changes have not reached your account. Keep this tab open and retry when connected.' : 'Saving changes to your account…'}
    {status === 'failed' && <button type="button" className="l-hit" disabled={retrying} onClick={async () => {
      setRetrying(true);
      try { await flushPendingState(); } finally { setRetrying(false); }
    }} style={{ marginLeft: 12 }}>{retrying ? 'Retrying…' : 'Retry save'}</button>}
  </div>;
}
