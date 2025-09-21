import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

interface DetectionCallbacks {
  onFaceDetection: (results: FaceDetectionResult) => void;
  onObjectDetection: (objects: DetectedObject[]) => void;
  onModelLoad: (type: string, success: boolean) => void;
}

interface FaceDetectionResult {
  multipleFaces: boolean;
  noFace: boolean;
  lookingAway: boolean;
  noFaceDuration: number;
  lookAwayDuration: number;
  faceCount: number;
}

interface DetectedObject {
  class: string;
  confidence: number;
  bbox: [number, number, number, number];
}

interface GazeState {
  lastFaceTime: number;
  lastGazeTime: number;
  noFaceStart: number | null;
  lookAwayStart: number | null;
  isLookingAway: boolean;
  hasFace: boolean;
  gazeHistory: boolean[];
  lookAwayViolationLogged: boolean;
  noFaceViolationLogged: boolean;
}

class DetectionEngine {
  private video: HTMLVideoElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private callbacks: DetectionCallbacks;
  
  private faceMesh: any = null; // runtime-loaded
  private objectModel: cocoSsd.ObjectDetection | null = null;
  
  private detectionActive = false;
  public gazeState: GazeState = {
    lastFaceTime: Date.now(),
    lastGazeTime: Date.now(),
    noFaceStart: null,
    lookAwayStart: null,
    isLookingAway: false,
    hasFace: false,
    gazeHistory: [],
    lookAwayViolationLogged: false,
    noFaceViolationLogged: false
  };
  
  private faceDetectionInterval: number | null = null;
  private objectDetectionInterval: number | null = null;
  
  constructor(video: HTMLVideoElement, canvas: HTMLCanvasElement, callbacks: DetectionCallbacks) {
    this.video = video;
    this.canvas = canvas;
    this.callbacks = callbacks;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not get canvas context');
    }
    this.ctx = ctx;
  }

  async initialize(): Promise<void> {
    try {
      await tf.ready();
      console.log('TensorFlow.js initialized');

      await Promise.all([
        this.initializeFaceMesh(),
        this.initializeObjectDetection()
      ]);

    } catch (error) {
      console.error('Detection engine initialization failed:', error);
      throw error;
    }
  }

  /** 
   * Try to locate FaceMesh constructor in all possible global places after CDN load 
   */
  private async loadFaceMeshConstructorFromCDN(): Promise<any> {
    const anyWindow = window as any;

    const findConstructor = () => {
      if (anyWindow.FaceMesh && typeof anyWindow.FaceMesh === 'function') return anyWindow.FaceMesh;
      if (anyWindow.faceMesh && typeof anyWindow.faceMesh.FaceMesh === 'function') return anyWindow.faceMesh.FaceMesh;
      if (anyWindow.default?.FaceMesh && typeof anyWindow.default.FaceMesh === 'function') return anyWindow.default.FaceMesh;
      if (anyWindow.__mediapipe_face_mesh__?.FaceMesh) return anyWindow.__mediapipe_face_mesh__.FaceMesh;
      if (anyWindow.mediapipe?.FaceMesh) return anyWindow.mediapipe.FaceMesh;
      if (anyWindow.default?.default?.FaceMesh) return anyWindow.default.default.FaceMesh;
      return null;
    };

    let ctor = findConstructor();
    if (ctor) return ctor;

    const CDN_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js';

    // Inject if not loaded
    if (!document.querySelector(`script[src="${CDN_URL}"]`)) {
      const script = document.createElement('script');
      script.src = CDN_URL;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);

      await new Promise<void>((resolve, reject) => {
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load FaceMesh from CDN'));
        setTimeout(() => reject(new Error('Timeout loading FaceMesh CDN')), 10000);
      });
    } else {
      await new Promise((r) => setTimeout(r, 100));
    }

    ctor = findConstructor();
    if (ctor) return ctor;

    console.error('DEBUG: window keys sample', Object.keys(anyWindow).slice(0, 50));
    console.error('DEBUG: window.FaceMesh', anyWindow.FaceMesh);
    console.error('DEBUG: window.faceMesh', anyWindow.faceMesh);
    console.error('DEBUG: window.__mediapipe_face_mesh__', anyWindow.__mediapipe_face_mesh__);
    console.error('DEBUG: window.mediapipe', anyWindow.mediapipe);

    throw new Error('FaceMesh constructor not found after CDN load.');
  }

  private async initializeFaceMesh(): Promise<void> {
    try {
      const FaceMeshCtor = await this.loadFaceMeshConstructorFromCDN();

      this.faceMesh = new FaceMeshCtor({
        locateFile: (file: string) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
      });

      this.faceMesh.setOptions({
        maxNumFaces: 3,
        refineLandmarks: false,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7,
      });

      this.faceMesh.onResults(this.onFaceMeshResults.bind(this));

      this.callbacks.onModelLoad('faceDetection', true);
      console.log('Face mesh model loaded successfully (via CDN)');
    } catch (error) {
      console.error('Face mesh initialization failed:', error);
      this.callbacks.onModelLoad('faceDetection', false);
      throw error;
    }
  }

  private async initializeObjectDetection(): Promise<void> {
    try {
      this.objectModel = await cocoSsd.load({ base: 'mobilenet_v2' });
      this.callbacks.onModelLoad('objectDetection', true);
      console.log('Object detection model loaded successfully');
    } catch (error) {
      console.error('Object detection initialization failed:', error);
      this.callbacks.onModelLoad('objectDetection', false);
      throw error;
    }
  }

  startDetection(): void {
    if (this.detectionActive) return;
    this.detectionActive = true;

    this.faceDetectionInterval = window.setInterval(() => this.runFaceDetection(), 200);
    this.objectDetectionInterval = window.setInterval(() => this.runObjectDetection(), 1000);

    console.log('Detection started');
  }

  stopDetection(): void {
    this.detectionActive = false;
    if (this.faceDetectionInterval) clearInterval(this.faceDetectionInterval);
    if (this.objectDetectionInterval) clearInterval(this.objectDetectionInterval);
    this.faceDetectionInterval = null;
    this.objectDetectionInterval = null;
    console.log('Detection stopped');
  }

  private async runFaceDetection(): Promise<void> {
    if (!this.faceMesh || !this.detectionActive || this.video.readyState < 2) return;
    try {
      await this.faceMesh.send({ image: this.video });
    } catch (error) {
      console.error('Face detection error:', error);
    }
  }

  private async runObjectDetection(): Promise<void> {
    if (!this.objectModel || !this.detectionActive || this.video.readyState < 2) return;
    try {
      const smallCanvas = document.createElement('canvas');
      const smallCtx = smallCanvas.getContext('2d');
      if (!smallCtx) return;

      const scale = 0.3;
      smallCanvas.width = this.video.videoWidth * scale;
      smallCanvas.height = this.video.videoHeight * scale;
      smallCtx.drawImage(this.video, 0, 0, smallCanvas.width, smallCanvas.height);

      const predictions = await this.objectModel.detect(smallCanvas);
      const detectedObjects: DetectedObject[] = predictions
        .filter(pred => this.isProhibitedObject(pred.class) && pred.score > 0.45)
        .map(pred => ({ class: pred.class, confidence: pred.score, bbox: pred.bbox }));

      if (detectedObjects.length > 0) {
        this.callbacks.onObjectDetection(detectedObjects);
        this.drawObjectDetections(detectedObjects, scale);
      } else {
        this.clearObjectOverlays();
      }
    } catch (error) {
      console.error('Object detection error:', error);
    }
  }

  private onFaceMeshResults(results: any): void {
    if (!this.detectionActive) return;
    const now = Date.now();
    const faceCount = results.multiFaceLandmarks ? results.multiFaceLandmarks.length : 0;
    const hasFace = faceCount > 0;
    const multipleFaces = faceCount > 1;

    this.canvas.width = this.video.videoWidth;
    this.canvas.height = this.video.videoHeight;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    let lookingAway = false;
    let noFaceDuration = 0;
    let lookAwayDuration = 0;

    if (hasFace) {
      this.gazeState.hasFace = true;
      this.gazeState.lastFaceTime = now;
      if (this.gazeState.noFaceStart) {
        this.gazeState.noFaceStart = null;
        this.gazeState.noFaceViolationLogged = false;
      }
      if (results.multiFaceLandmarks?.[0]) {
        const landmarks = results.multiFaceLandmarks[0];
        const currentLookingAway = this.analyzeLookingAway(landmarks);
        this.gazeState.gazeHistory.push(currentLookingAway);
        if (this.gazeState.gazeHistory.length > 10) this.gazeState.gazeHistory.shift();
        const lookingAwayCount = this.gazeState.gazeHistory.filter(Boolean).length;
        lookingAway = lookingAwayCount >= 7;
        if (lookingAway) {
          if (!this.gazeState.lookAwayStart) {
            this.gazeState.lookAwayStart = now;
            this.gazeState.lookAwayViolationLogged = false;
          }
          lookAwayDuration = (now - this.gazeState.lookAwayStart) / 1000;
        } else {
          this.gazeState.lookAwayStart = null;
          this.gazeState.lookAwayViolationLogged = false;
        }
        this.drawFaceLandmarks(landmarks, lookingAway);
      }
      if (multipleFaces) this.drawMultipleFaceWarning();
    } else {
      this.gazeState.hasFace = false;
      if (!this.gazeState.noFaceStart) {
        this.gazeState.noFaceStart = now;
        this.gazeState.noFaceViolationLogged = false;
      }
      noFaceDuration = (now - this.gazeState.noFaceStart) / 1000;
      this.gazeState.lookAwayStart = null;
      this.gazeState.lookAwayViolationLogged = false;
    }

    const faceResult: FaceDetectionResult = {
      multipleFaces,
      noFace: !hasFace,
      lookingAway,
      noFaceDuration,
      lookAwayDuration,
      faceCount
    };
    this.callbacks.onFaceDetection(faceResult);
  }

  private analyzeLookingAway(landmarks: any[]): boolean {
    if (!landmarks || landmarks.length < 468) return false;
    try {
      const leftEyeInner = landmarks[133], rightEyeInner = landmarks[362];
      const noseTip = landmarks[1], leftEyeOuter = landmarks[33], rightEyeOuter = landmarks[263];
      const leftEyeCenter = { x: (leftEyeInner.x + leftEyeOuter.x) / 2, y: (leftEyeInner.y + leftEyeOuter.y) / 2 };
      const rightEyeCenter = { x: (rightEyeInner.x + rightEyeOuter.x) / 2, y: (rightEyeInner.y + rightEyeOuter.y) / 2 };
      const faceCenter = { x: (leftEyeCenter.x + rightEyeCenter.x) / 2, y: (leftEyeCenter.y + rightEyeCenter.y) / 2 };
      const noseEyeAlignmentX = Math.abs(noseTip.x - faceCenter.x);
      const eyeDistance = Math.abs(rightEyeCenter.x - leftEyeCenter.x);
      const normalizedDeviationX = noseEyeAlignmentX / eyeDistance;
      const verticalDeviation = Math.abs(faceCenter.y - 0.5);
      return normalizedDeviationX > 0.25 || verticalDeviation > 0.2;
    } catch (error) {
      console.error('Gaze analysis error:', error);
      return false;
    }
  }

  private drawFaceLandmarks(landmarks: any[], lookingAway: boolean): void {
    const color = lookingAway ? '#ef4444' : '#22c55e';
    this.ctx.fillStyle = color;
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1;
    [1, 33, 263, 61, 291, 199].forEach(i => {
      if (landmarks[i]) {
        const p = landmarks[i];
        this.ctx.beginPath();
        this.ctx.arc(p.x * this.canvas.width, p.y * this.canvas.height, 2, 0, 2 * Math.PI);
        this.ctx.fill();
      }
    });
    this.ctx.font = '16px Arial';
    this.ctx.fillStyle = color;
    this.ctx.fillText(lookingAway ? 'Looking Away' : 'Focused', 10, 30);
  }

  private drawMultipleFaceWarning(): void {
    this.ctx.fillStyle = '#ef4444';
    this.ctx.font = 'bold 20px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('MULTIPLE FACES DETECTED', this.canvas.width / 2, 50);
    this.ctx.textAlign = 'left';
  }

  private drawObjectDetections(objects: DetectedObject[], scale: number): void {
    objects.forEach(obj => {
      const [x, y, w, h] = obj.bbox;
      const sx = x / scale, sy = y / scale, sw = w / scale, sh = h / scale;
      this.ctx.strokeStyle = '#ef4444';
      this.ctx.lineWidth = 3;
      this.ctx.strokeRect(sx, sy, sw, sh);
      this.ctx.fillStyle = '#ef4444';
      this.ctx.fillRect(sx, sy - 25, sw, 25);
      this.ctx.fillStyle = '#fff';
      this.ctx.font = '14px Arial';
      this.ctx.fillText(`${obj.class} (${(obj.confidence * 100).toFixed(0)}%)`, sx + 5, sy - 8);
    });
  }

  private clearObjectOverlays(): void {}

  private isProhibitedObject(className: string): boolean {
    return ['cell phone','laptop','book','keyboard','mouse','tablet','remote']
      .some(item => className.toLowerCase().includes(item) || item.includes(className.toLowerCase()));
  }

  cleanup(): void {
    this.stopDetection();
    if (this.faceMesh) { try { this.faceMesh.close?.(); } catch {} this.faceMesh = null; }
    this.objectModel = null;
    console.log('Detection engine cleaned up');
  }
}

export default DetectionEngine;
