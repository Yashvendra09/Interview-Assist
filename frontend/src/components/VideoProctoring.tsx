import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { 
  Camera, 
  StopCircle, 
  Download, 
  Eye, 
  Smartphone, 
  AlertTriangle,
  CheckCircle,
  Loader2
} from "lucide-react";
import MediaRecorderManager from "../utils/MediaRecorderManager";
import DetectionEngine from "../utils/DetectionEngine";
import ReportGenerator from "../utils/ReportGenerator";
import StorageManager from "../utils/StorageManager";

interface Event {
  id: string;
  type: string;
  timestamp: string;
  duration?: number;
  details: string;
  confidence?: number;
  severity: 'low' | 'medium' | 'high';
}

interface VideoProctoringProps {
  candidateName: string;
  onEndSession: () => void;
}

const VideoProctoring = ({ candidateName, onEndSession }: VideoProctoringProps) => {
  const [isRecording, setIsRecording] = useState(false);
  const [events, setEvents] = useState<Event[]>([]);
  const [modelStatus, setModelStatus] = useState({
    faceDetection: 'loading' as 'loading' | 'ready' | 'error',
    objectDetection: 'loading' as 'loading' | 'ready' | 'error'
  });
  const [detectionSettings, setDetectionSettings] = useState({
    faceDetectionEnabled: true,
    objectDetectionEnabled: true,
    lookAwayThreshold: 5,
    noFaceThreshold: 10
  });

  // NEW: localSessionId tracked for saving logs to StorageManager
  const [localSessionId, setLocalSessionId] = useState<string | null>(null);

  // Track detected objects to prevent duplicate logging
  const detectedObjectsRef = useRef<Map<string, number>>(new Map());

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorderManager | null>(null);
  const detectionRef = useRef<DetectionEngine | null>(null);
  const animationRef = useRef<number | null>(null);

  const { toast } = useToast();

  /**
   * addEvent: creates event locally and also persists via StorageManager.
   * We call saveEvent which will both append locally and attempt to send to backend.
   */
  const addEvent = useCallback((
    type: string, 
    details: string, 
    severity: 'low' | 'medium' | 'high' = 'medium',
    duration?: number,
    confidence?: number
  ) => {
    const event: Event = {
      id: Date.now().toString(),
      type,
      timestamp: new Date().toISOString(),
      details,
      severity,
      duration,
      confidence
    };
    
    setEvents(prev => [event, ...prev]);
    
    // Show toast for high severity events
    if (severity === 'high') {
      toast({
        title: "Proctoring Alert",
        description: details,
        variant: "destructive"
      });
    }

    // Persist the event using StorageManager
    // If localSessionId is not yet found, we still push locally into StorageManager in a best-effort way.
    (async () => {
      try {
        if (localSessionId) {
          await StorageManager.getInstance().saveEvent(localSessionId, {
            type: event.type,
            timestamp: event.timestamp,
            payload: {
              details: event.details,
              severity: event.severity,
              duration: event.duration,
              confidence: event.confidence
            }
          });
        } else {
          // fallback: if no session id, attempt to find or create a session for this candidate.
          const sessions = await StorageManager.getInstance().getAllSessions();
          // find the most recent matching candidateName
          const matched = sessions.find(s => s.candidateName === candidateName);
          if (matched) {
            setLocalSessionId(matched.id);
            await StorageManager.getInstance().saveEvent(matched.id, {
              type: event.type,
              timestamp: event.timestamp,
              payload: {
                details: event.details,
                severity: event.severity,
                duration: event.duration,
                confidence: event.confidence
              }
            });
          } else {
            // No existing session found — create a local session (this will also attempt to create remote if backend configured)
            const newSession = await StorageManager.getInstance().startSession((localStorage.getItem('focustrack_user') ? JSON.parse(localStorage.getItem('focustrack_user') as string).uniqueId : candidateName), candidateName, { frontend: "focus-track-live", autoCreated: true });
            setLocalSessionId(newSession.id);
            await StorageManager.getInstance().saveEvent(newSession.id, {
              type: event.type,
              timestamp: event.timestamp,
              payload: {
                details: event.details,
                severity: event.severity,
                duration: event.duration,
                confidence: event.confidence
              }
            });
          }
        }
      } catch (err) {
        console.warn('Failed to persist event to StorageManager:', err);
      }
    })();
  }, [toast, localSessionId, candidateName]);

  const initializeCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          width: { ideal: 1280 }, 
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: true
      });
      
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      
      addEvent('system', 'Camera initialized successfully', 'low');
      return true;
    } catch (error) {
      console.error('Camera initialization failed:', error);
      addEvent('system', 'Camera initialization failed', 'high');
      toast({
        title: "Camera Error",
        description: "Unable to access camera. Please check permissions.",
        variant: "destructive"
      });
      return false;
    }
  };

  const initializeDetection = async () => {
    if (!streamRef.current || !videoRef.current || !canvasRef.current) return;

    try {
      detectionRef.current = new DetectionEngine(
        videoRef.current,
        canvasRef.current,
        {
          onFaceDetection: (results) => {
            // Handle face detection results
            if (results.multipleFaces) {
              addEvent('violation', 'Multiple faces detected', 'high');
            }
            if (results.noFace && results.noFaceDuration > detectionSettings.noFaceThreshold) {
              // Only log once per no-face session
              if (!detectionRef.current?.gazeState?.noFaceViolationLogged) {
                addEvent('violation', `No face detected for ${results.noFaceDuration.toFixed(1)}s`, 'high', results.noFaceDuration);
                if (detectionRef.current?.gazeState) {
                  detectionRef.current.gazeState.noFaceViolationLogged = true;
                }
              }
            }
            if (results.lookingAway && results.lookAwayDuration > detectionSettings.lookAwayThreshold) {
              // Only log once per looking-away session
              if (!detectionRef.current?.gazeState?.lookAwayViolationLogged) {
                addEvent('violation', `Looking away for ${results.lookAwayDuration.toFixed(1)}s`, 'medium', results.lookAwayDuration);
                if (detectionRef.current?.gazeState) {
                  detectionRef.current.gazeState.lookAwayViolationLogged = true;
                }
              }
            }
          },
          onObjectDetection: (objects) => {
            const now = Date.now();
            const currentObjects = new Set<string>();
            
            objects.forEach(obj => {
              if (obj.confidence > 0.45) {
                currentObjects.add(obj.class);
                const lastDetected = detectedObjectsRef.current.get(obj.class);
                
                // Only log if object wasn't detected recently (debounce for 3 seconds)
                if (!lastDetected || (now - lastDetected) > 3000) {
                  const severity = obj.class === 'cell phone' ? 'high' : 'medium';
                  addEvent('object_detected', `${obj.class} detected`, severity, undefined, obj.confidence);
                  detectedObjectsRef.current.set(obj.class, now);
                }
              }
            });
            
            // Clean up objects that are no longer detected (after 5 seconds)
            detectedObjectsRef.current.forEach((timestamp, objectClass) => {
              if (!currentObjects.has(objectClass) && (now - timestamp) > 5000) {
                detectedObjectsRef.current.delete(objectClass);
              }
            });
          },
          onModelLoad: (type, success) => {
            setModelStatus(prev => ({
              ...prev,
              [type]: success ? 'ready' : 'error'
            }));
            addEvent('system', `${type} model ${success ? 'loaded' : 'failed'}`, success ? 'low' : 'high');
          }
        }
      );

      await detectionRef.current.initialize();
    } catch (error) {
      console.error('Detection initialization failed:', error);
      addEvent('system', 'Detection engine initialization failed', 'high');
    }
  };

  const startRecording = async () => {
    if (!streamRef.current) return;

    try {
      recorderRef.current = new MediaRecorderManager(streamRef.current);
      await recorderRef.current.startRecording();
      
      setIsRecording(true);
      addEvent('system', 'Recording started', 'low');
      
      // Start detection
      if (detectionRef.current) {
        detectionRef.current.startDetection();
      }
      
      toast({
        title: "Recording Started",
        description: "Interview session is now being recorded and monitored.",
      });
    } catch (error) {
      console.error('Recording start failed:', error);
      addEvent('system', 'Recording start failed', 'high');
    }
  };

  const stopRecording = async () => {
    if (recorderRef.current) {
      await recorderRef.current.stopRecording();
    }
    
    if (detectionRef.current) {
      detectionRef.current.stopDetection();
    }
    
    setIsRecording(false);
    addEvent('system', 'Recording stopped', 'low');
    
    toast({
      title: "Recording Stopped",
      description: "Interview session ended. You can now download the recordings and reports.",
    });
  };

  const downloadVideo = async () => {
    if (recorderRef.current) {
      try {
        const blob = await recorderRef.current.getRecordingBlob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `interview_${candidateName}_${new Date().toISOString().split('T')[0]}.webm`;
        a.click();
        URL.revokeObjectURL(url);
        
        addEvent('system', 'Video downloaded', 'low');
      } catch (error) {
        console.error('Video download failed:', error);
        toast({
          title: "Download Error",
          description: "Failed to download video recording.",
          variant: "destructive"
        });
      }
    }
  };

  const downloadCSVReport = () => {
    ReportGenerator.downloadCSV(events, candidateName);
    addEvent('system', 'CSV report downloaded', 'low');
  };

  const downloadPDFReport = () => {
    const reportData = {
      candidateName,
      sessionStart: events.length > 0 ? events[events.length - 1].timestamp : new Date().toISOString(),
      sessionEnd: new Date().toISOString(),
      events,
      summary: ReportGenerator.generateSummary(events)
    };
    
    ReportGenerator.downloadPDF(reportData);
    addEvent('system', 'PDF report downloaded', 'low');
  };

  useEffect(() => {
    const initialize = async () => {
      // Attempt to find the local session created by Index page.
      try {
        const sessions = await StorageManager.getInstance().getAllSessions();
        // pick most recent session with this candidateName
        const matched = sessions.find(s => s.candidateName === candidateName);
        if (matched) {
          setLocalSessionId(matched.id);
        } else {
          // no session found yet — it's okay; save will create one on-demand in addEvent
          setLocalSessionId(null);
        }
      } catch (err) {
        console.warn('Failed to lookup local session:', err);
      }

      const cameraInitialized = await initializeCamera();
      if (cameraInitialized) {
        await initializeDetection();
      }
    };
    
    initialize();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (detectionRef.current) {
        detectionRef.current.cleanup();
      }
    };
  }, []); // candidateName unlikely to change during mount

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'loading': return <Loader2 className="w-4 h-4 animate-spin" />;
      case 'ready': return <CheckCircle className="w-4 h-4" />;
      case 'error': return <AlertTriangle className="w-4 h-4" />;
      default: return null;
    }
  };

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'violation': return <AlertTriangle className="w-4 h-4 text-red-600" />;
      case 'object_detected': return <Smartphone className="w-4 h-4 text-yellow-500" />;
      case 'system': return <CheckCircle className="w-4 h-4 text-green-600" />;
      default: return <Eye className="w-4 h-4 text-muted-foreground" />;
    }
  };

  // Handler for End Session button — ensure session ended in StorageManager, then notify parent
  const handleEndSession = async () => {
    try {
      if (localSessionId) {
        await StorageManager.getInstance().endSession(localSessionId);
      } else {
        // If no localSessionId (unlikely), try to find one then end
        const sessions = await StorageManager.getInstance().getAllSessions();
        const matched = sessions.find(s => s.candidateName === candidateName);
        if (matched) {
          await StorageManager.getInstance().endSession(matched.id);
        }
      }
    } catch (err) {
      console.warn('Failed to mark session ended:', err);
    } finally {
      onEndSession();
    }
  };

  return (
    <div className="min-h-screen bg-background p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-primary">Interview Proctoring</h1>
          <p className="text-muted-foreground">Candidate: {candidateName}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Badge className="status-indicator flex items-center gap-2 px-2 py-1 border rounded">
              {getStatusIcon(modelStatus.faceDetection)}
              <span className="text-sm">Face Detection</span>
            </Badge>

            <Badge className="status-indicator flex items-center gap-2 px-2 py-1 border rounded">
              {getStatusIcon(modelStatus.objectDetection)}
              <span className="text-sm">Object Detection</span>
            </Badge>
          </div>
          {isRecording && (
            <Badge className="recording-indicator flex items-center gap-2 px-2 py-1 bg-red-600 text-white rounded">
              <div className="w-2 h-2 rounded-full bg-current mr-2"></div>
              RECORDING
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-140px)]">
        {/* Video Feed */}
        <div className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Camera className="w-5 h-5" />
                Live Video Feed
              </CardTitle>
            </CardHeader>
            <CardContent className="relative h-[calc(100%-80px)]">
              <div className="relative w-full h-full rounded-lg overflow-hidden bg-muted">
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                />
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 w-full h-full pointer-events-none"
                />
              </div>
              
              {/* Controls */}
              <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
                <div className="flex gap-2">
                  {!isRecording ? (
                    <Button onClick={startRecording} className="bg-green-600 hover:bg-green-700 text-white">
                      <Camera className="w-4 h-4 mr-2" />
                      Start Interview
                    </Button>
                  ) : (
                    <Button onClick={stopRecording} className="bg-red-600 hover:bg-red-700 text-white">
                      <StopCircle className="w-4 h-4 mr-2" />
                      Stop Interview
                    </Button>
                  )}
                </div>
                
                <div className="flex gap-2">
                  <Button onClick={downloadVideo} className="border border-gray-300 px-3 py-2" disabled={isRecording}>
                    <Download className="w-4 h-4 mr-2" />
                    Video
                  </Button>
                  <Button onClick={downloadCSVReport} className="border border-gray-300 px-3 py-2">
                    <Download className="w-4 h-4 mr-2" />
                    CSV
                  </Button>
                  <Button onClick={downloadPDFReport} className="border border-gray-300 px-3 py-2">
                    <Download className="w-4 h-4 mr-2" />
                    PDF
                  </Button>
                  <Button onClick={handleEndSession} className="border border-gray-300 px-3 py-2">
                    End Session
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Event Log */}
        <div className="lg:col-span-1">
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Eye className="w-5 h-5" />
                  Event Log
                </span>
                <Badge className="text-xs px-2 py-1 border rounded">{events.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[calc(100vh-240px)] scroll-area">
                <div className="p-4 space-y-2">
                  {events.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">
                      No events recorded yet
                    </p>
                  ) : (
                    events.map((event, index) => (
                      <div key={event.id} className="event-item">
                        <div className="flex items-start gap-3 p-3 rounded-lg border bg-card">
                          {getEventIcon(event.type)}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium capitalize">
                                {event.type.replace('_', ' ')}
                              </span>
                              <Badge 
                                className={`text-xs px-2 py-1 rounded ${
                                  event.severity === 'high' ? 'border border-red-600 text-red-600' :
                                  event.severity === 'medium' ? 'border border-yellow-500 text-yellow-500' :
                                  'border border-green-600 text-green-600'
                                }`}
                              >
                                {event.severity}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mb-1">
                              {event.details}
                            </p>
                            <div className="text-xs text-muted-foreground">
                              {new Date(event.timestamp).toLocaleTimeString()}
                              {event.duration && ` • ${event.duration}s`}
                              {event.confidence && ` • ${(event.confidence * 100).toFixed(0)}%`}
                            </div>
                          </div>
                        </div>
                        {index < events.length - 1 && <Separator className="my-2" />}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default VideoProctoring;
