import * as tf from "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";

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

  private faceMesh: any = null; // will be loaded from CDN
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
    noFaceViolationLogged: false,
  };

  private faceDetectionInterval: number | null = null;
  private objectDetectionInterval: number | null = null;

  constructor(video: HTMLVideoElement, canvas: HTMLCanvasElement, callbacks: DetectionCallbacks) {
    this.video = video;
    this.canvas = canvas;
    this.callbacks = callbacks;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas context");
    this.ctx = ctx;
  }

  async initialize(): Promise<void> {
    await tf.ready();
    console.log("TensorFlow.js initialized");

    await Promise.all([this.initializeFaceMesh(), this.initializeObjectDetection()]);
  }

  private async initializeFaceMesh(): Promise<void> {
    try {
      // ✅ Use FaceMesh from global (CDN-loaded)
      const FaceMeshCtor = (window as any).FaceMesh;
      if (!FaceMeshCtor) throw new Error("FaceMesh not found on window. CDN failed?");

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
      this.callbacks.onModelLoad("faceDetection", true);
      console.log("Face mesh model loaded successfully (via CDN)");
    } catch (err) {
      console.error("Face mesh initialization failed:", err);
      this.callbacks.onModelLoad("faceDetection", false);
    }
  }

  private async initializeObjectDetection(): Promise<void> {
    try {
      this.objectModel = await cocoSsd.load({ base: "mobilenet_v2" });
      this.callbacks.onModelLoad("objectDetection", true);
      console.log("Object detection model loaded successfully");
    } catch (err) {
      console.error("Object detection initialization failed:", err);
      this.callbacks.onModelLoad("objectDetection", false);
    }
  }

  startDetection(): void {
    if (this.detectionActive) return;
    this.detectionActive = true;

    this.faceDetectionInterval = window.setInterval(() => this.runFaceDetection(), 200); // 5 FPS
    this.objectDetectionInterval = window.setInterval(() => this.runObjectDetection(), 1000); // 1 FPS
  }

  stopDetection(): void {
    this.detectionActive = false;
    if (this.faceDetectionInterval) clearInterval(this.faceDetectionInterval);
    if (this.objectDetectionInterval) clearInterval(this.objectDetectionInterval);
    this.faceDetectionInterval = null;
    this.objectDetectionInterval = null;
  }

  private async runFaceDetection(): Promise<void> {
    if (!this.faceMesh || !this.detectionActive || this.video.readyState < 2) return;
    try {
      await this.faceMesh.send({ image: this.video });
    } catch (err) {
      console.error("Face detection error:", err);
    }
  }

  private async runObjectDetection(): Promise<void> {
    if (!this.objectModel || !this.detectionActive || this.video.readyState < 2) return;
    try {
      const smallCanvas = document.createElement("canvas");
      const smallCtx = smallCanvas.getContext("2d");
      if (!smallCtx) return;

      const scale = 0.3;
      smallCanvas.width = this.video.videoWidth * scale;
      smallCanvas.height = this.video.videoHeight * scale;
      smallCtx.drawImage(this.video, 0, 0, smallCanvas.width, smallCanvas.height);

      const predictions = await this.objectModel.detect(smallCanvas);
      const detectedObjects: DetectedObject[] = predictions
        .filter((p) => this.isProhibitedObject(p.class) && p.score > 0.45)
        .map((p) => ({ class: p.class, confidence: p.score, bbox: p.bbox }));

      if (detectedObjects.length > 0) {
        this.callbacks.onObjectDetection(detectedObjects);
        this.drawObjectDetections(detectedObjects, scale);
      } else {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      }
    } catch (err) {
      console.error("Object detection error:", err);
    }
  }

  private onFaceMeshResults(results: any): void {
    if (!this.detectionActive) return;

    const now = Date.now();
    const faceCount = results.multiFaceLandmarks?.length || 0;
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

      if (results.multiFaceLandmarks[0]) {
        const landmarks = results.multiFaceLandmarks[0];
        lookingAway = this.analyzeLookingAway(landmarks);
        this.drawFaceLandmarks(landmarks, lookingAway);
      }

      if (multipleFaces) this.drawMultipleFaceWarning();
    } else {
      this.gazeState.hasFace = false;
      if (!this.gazeState.noFaceStart) this.gazeState.noFaceStart = now;
      noFaceDuration = (now - this.gazeState.noFaceStart) / 1000;
    }

    this.callbacks.onFaceDetection({
      multipleFaces,
      noFace: !hasFace,
      lookingAway,
      noFaceDuration,
      lookAwayDuration,
      faceCount,
    });
  }

  private analyzeLookingAway(landmarks: any[]): boolean {
    if (!landmarks?.length) return false;
    try {
      const nose = landmarks[1];
      return nose.x < 0.3 || nose.x > 0.7;
    } catch {
      return false;
    }
  }

  private drawFaceLandmarks(landmarks: any[], lookingAway: boolean) {
    const color = lookingAway ? "#ef4444" : "#22c55e";
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(landmarks[1].x * this.canvas.width, landmarks[1].y * this.canvas.height, 4, 0, 2 * Math.PI);
    this.ctx.fill();
  }

  private drawMultipleFaceWarning() {
    this.ctx.fillStyle = "#ef4444";
    this.ctx.font = "bold 20px Arial";
    this.ctx.fillText("MULTIPLE FACES DETECTED", this.canvas.width / 2 - 100, 50);
  }

  private drawObjectDetections(objects: DetectedObject[], scale: number) {
    objects.forEach((obj) => {
      const [x, y, w, h] = obj.bbox;
      this.ctx.strokeStyle = "#ef4444";
      this.ctx.strokeRect(x / scale, y / scale, w / scale, h / scale);
    });
  }

  private isProhibitedObject(className: string): boolean {
    return ["cell phone", "laptop", "book", "mouse", "keyboard"].some((i) =>
      className.toLowerCase().includes(i)
    );
  }
}

export default DetectionEngine;
