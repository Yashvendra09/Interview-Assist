import { useState } from "react";
import VideoProctoring from "../components/VideoProctoring";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import StorageManager from "../utils/StorageManager";

const Index = () => {
  const [candidateName, setCandidateName] = useState("");
  const [uniqueId, setUniqueId] = useState("");
  const [sessionStarted, setSessionStarted] = useState(false);
  const [loadingStart, setLoadingStart] = useState(false);

  const startSession = async () => {
    if (!candidateName.trim() || !uniqueId.trim()) return;

    setLoadingStart(true);

    try {
      // Configure backend URL (Vite env var) — fallback to localhost
      const base = (import.meta as any).env?.VITE_API_BASE_URL || "http://localhost:4000";
      StorageManager.getInstance().setBackendBaseUrl(base);

      // Try to create or get the user on backend.
      const backendUser = await StorageManager.getInstance().createOrGetUser(uniqueId.trim(), candidateName.trim());

      // Save user info locally
      if (backendUser) {
        try {
          localStorage.setItem('focustrack_user', JSON.stringify(backendUser));
        } catch (e) {
          console.warn('Could not persist backend user locally', e);
        }
      } else {
        try { localStorage.removeItem('focustrack_user'); } catch {}
      }

      // Start session locally (StorageManager will attempt remote session creation too)
      const session = await StorageManager.getInstance().startSession(uniqueId.trim(), candidateName.trim(), { frontend: "focus-track-live" });

      // Persist the returned local session so VideoProctoring or other components can find it reliably
      try {
        localStorage.setItem('focustrack_session', JSON.stringify(session));
      } catch (e) {
        console.warn('Could not persist focustrack_session locally', e);
      }

      setSessionStarted(true);
    } catch (err) {
      console.error('Failed to start session (continuing offline):', err);
      // fallback: still create a local session
      try {
        const session = await StorageManager.getInstance().startSession(uniqueId.trim(), candidateName.trim(), { frontend: "focus-track-live" });
        try {
          localStorage.setItem('focustrack_session', JSON.stringify(session));
        } catch {}
        setSessionStarted(true);
      } catch (_) {
        // if even local fails — show no UI failure here (dev can inspect console)
        setSessionStarted(true);
      }
    } finally {
      setLoadingStart(false);
    }
  };

  if (sessionStarted) {
    return (
      <VideoProctoring 
        candidateName={candidateName} 
        onEndSession={() => setSessionStarted(false)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold text-primary">
            Video Interview Proctoring
          </CardTitle>
          <CardDescription>
            Advanced AI-powered proctoring system with real-time monitoring
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="candidate-name" className="text-sm font-medium">
              Candidate Name
            </label>
            <Input
              id="candidate-name"
              placeholder="Enter candidate's full name"
              value={candidateName}
              onChange={(e) => setCandidateName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && startSession()}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="unique-id" className="text-sm font-medium">
              Unique ID (from email)
            </label>
            <Input
              id="unique-id"
              placeholder="Enter unique ID provided in email"
              value={uniqueId}
              onChange={(e) => setUniqueId(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && startSession()}
            />
          </div>

          <Button 
            onClick={startSession} 
            disabled={!candidateName.trim() || !uniqueId.trim() || loadingStart}
            className="w-full py-3 text-lg"
          >
            {loadingStart ? 'Starting...' : 'Start Proctored Interview'}
          </Button>

          <div className="text-xs text-muted-foreground space-y-1">
            <p>• Continuous video recording and monitoring</p>
            <p>• Real-time face and object detection</p>
            <p>• Automatic violation logging</p>
            <p>• Downloadable reports and recordings</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Index;
