'use client';

import * as React from 'react';
import AppShell from '@/components/insightiq/AppShell';
import DashboardView from '@/components/insightiq/DashboardView';
import UploadView from '@/components/insightiq/UploadView';
import AnalyzeView from '@/components/insightiq/AnalyzeView';
import CleanView from '@/components/insightiq/CleanView';
import CompareView from '@/components/insightiq/CompareView';
import ChatView from '@/components/insightiq/ChatView';
import MediaView from '@/components/insightiq/MediaView';
import { useInsightStore, persistSession, restoreSession } from '@/lib/insightiq/store';
import { listFiles } from '@/lib/insightiq/api';

export default function InsightIQApp() {
  const { view, setView, activeFileId, setActiveFile, setFiles, filesLoadedOnce } = useInsightStore();
  const hydratedRef = React.useRef(false);

  // Load dataset list once on mount + restore last session (non-blocking)
  React.useEffect(() => {
    listFiles()
      .then((files) => {
        setFiles(files);
        const session = restoreSession();
        if (session) {
          if (session.activeFileId && files.some((f) => f.fileId === session.activeFileId)) {
            setActiveFile(session.activeFileId);
          }
          if (session.view) setView(session.view);
        }
      })
      .catch(() => {
        /* backend may still be starting; views show their own errors */
      })
      .finally(() => {
        hydratedRef.current = true;
      });
  }, []);

  // Persist active dataset + view (only after the initial restore, so we never
  // overwrite a saved session with the pre-hydration defaults)
  React.useEffect(() => {
    if (hydratedRef.current) persistSession({ activeFileId, view });
  }, [activeFileId, view]);

  return (
    <AppShell>
      {view === 'dashboard' && <DashboardView />}
      {view === 'upload' && <UploadView />}
      {view === 'analyze' && <AnalyzeView />}
      {view === 'clean' && <CleanView />}
      {view === 'compare' && <CompareView />}
      {view === 'chat' && <ChatView />}
      {view === 'media' && <MediaView />}
    </AppShell>
  );
}
