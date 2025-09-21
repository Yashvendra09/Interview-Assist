import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { FaceMesh } from '@mediapipe/face_mesh';

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
  
  private faceMesh: FaceMesh | null = null;
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
      // Initialize TensorFlow.js
      await tf.ready();
      console.log('TensorFlow.js initialized');

      // Load models concurrently
      await Promise.all([
        this.initializeFaceMesh(),
        this.initializeObjectDetection()
      ]);

    } catch (error) {
      console.error('Detection engine initialization failed:', error);
      throw error;
    }
  }

  private async initializeFaceMesh(): Promise<void> {
    try {
      this.faceMesh = new FaceMesh({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
      });

      this.faceMesh.setOptions({
        maxNumFaces: 3,
        refineLandmarks: false, // Disable refinement for better performance
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7
      });

      this.faceMesh.onResults(this.onFaceMeshResults.bind(this));
      
      this.callbacks.onModelLoad('faceDetection', true);
      console.log('Face mesh model loaded successfully');
      
    } catch (error) {
      console.error('Face mesh initialization failed:', error);
      this.callbacks.onModelLoad('faceDetection', false);
      throw error;
    }
  }

  private async initializeObjectDetection(): Promise<void> {
    try {
      // Load COCO-SSD model
      this.objectModel = await cocoSsd.load({
        base: 'mobilenet_v2' // Faster but less accurate
      });
      
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
    
    // Start face detection at 5 FPS for better performance
    this.faceDetectionInterval = window.setInterval(() => {
      this.runFaceDetection();
    }, 200); // 5 FPS
    
    // Start object detection at 1 FPS to reduce CPU load
    this.objectDetectionInterval = window.setInterval(() => {
      this.runObjectDetection();
    }, 1000); // 1 FPS

    console.log('Detection started');
  }

  stopDetection(): void {
    this.detectionActive = false;
    
    if (this.faceDetectionInterval) {
      clearInterval(this.faceDetectionInterval);
      this.faceDetectionInterval = null;
    }
    
    if (this.objectDetectionInterval) {
      clearInterval(this.objectDetectionInterval);
      this.objectDetectionInterval = null;
    }

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
      // Create a smaller canvas for object detection to improve performance
      const smallCanvas = document.createElement('canvas');
      const smallCtx = smallCanvas.getContext('2d');
      if (!smallCtx) return;

      const scale = 0.3; // Scale down for performance
      smallCanvas.width = this.video.videoWidth * scale;
      smallCanvas.height = this.video.videoHeight * scale;
      
      smallCtx.drawImage(this.video, 0, 0, smallCanvas.width, smallCanvas.height);

      const predictions = await this.objectModel.detect(smallCanvas);
      
      const detectedObjects: DetectedObject[] = predictions
        .filter(pred => this.isProhibitedObject(pred.class) && pred.score > 0.45)
        .map(pred => ({
          class: pred.class,
          confidence: pred.score,
          bbox: pred.bbox
        }));

      if (detectedObjects.length > 0) {
        this.callbacks.onObjectDetection(detectedObjects);
        this.drawObjectDetections(detectedObjects, scale);
      } else {
        // Clear object detection overlays
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

    // Update canvas size to match video
    this.canvas.width = this.video.videoWidth;
    this.canvas.height = this.video.videoHeight;

    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    let lookingAway = false;
    let noFaceDuration = 0;
    let lookAwayDuration = 0;

    if (hasFace) {
      this.gazeState.hasFace = true;
      this.gazeState.lastFaceTime = now;
      
      if (this.gazeState.noFaceStart) {
        this.gazeState.noFaceStart = null;
        this.gazeState.noFaceViolationLogged = false; // Reset when face is detected
      }

      // Draw face landmarks and check gaze
      if (results.multiFaceLandmarks && results.multiFaceLandmarks[0]) {
        const landmarks = results.multiFaceLandmarks[0];
        const currentLookingAway = this.analyzeLookingAway(landmarks);
        
        // Add to gaze history for smoothing
        this.gazeState.gazeHistory.push(currentLookingAway);
        if (this.gazeState.gazeHistory.length > 10) {
          this.gazeState.gazeHistory.shift();
        }
        
        // Consider looking away only if consistently detected over multiple frames
        const lookingAwayCount = this.gazeState.gazeHistory.filter(Boolean).length;
        lookingAway = lookingAwayCount >= 7; // 70% of recent frames
        
        if (lookingAway) {
          if (!this.gazeState.lookAwayStart) {
            this.gazeState.lookAwayStart = now;
            this.gazeState.lookAwayViolationLogged = false; // Reset log flag for new looking away session
          }
          lookAwayDuration = (now - this.gazeState.lookAwayStart) / 1000;
        } else {
          // User is looking at camera - reset looking away state
          if (this.gazeState.lookAwayStart) {
            this.gazeState.lookAwayStart = null;
            this.gazeState.lookAwayViolationLogged = false;
          }
          lookAwayDuration = 0;
        }

        this.drawFaceLandmarks(landmarks, lookingAway);
      }

      // Draw multiple face warning
      if (multipleFaces) {
        this.drawMultipleFaceWarning();
      }

    } else {
      this.gazeState.hasFace = false;
      
      if (!this.gazeState.noFaceStart) {
        this.gazeState.noFaceStart = now;
        this.gazeState.noFaceViolationLogged = false; // Reset log flag for new no face session
      }
      
      noFaceDuration = (now - this.gazeState.noFaceStart) / 1000;
      
      if (this.gazeState.lookAwayStart) {
        this.gazeState.lookAwayStart = null;
        this.gazeState.lookAwayViolationLogged = false;
      }
    }

    // Send detection results
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
      // Use more reliable landmarks for gaze detection
      const leftEyeInner = landmarks[133]; // Left eye inner corner
      const rightEyeInner = landmarks[362]; // Right eye inner corner
      const noseTip = landmarks[1]; // Nose tip
      const leftEyeOuter = landmarks[33]; // Left eye outer corner
      const rightEyeOuter = landmarks[263]; // Right eye outer corner

      // Calculate eye centers
      const leftEyeCenter = {
        x: (leftEyeInner.x + leftEyeOuter.x) / 2,
        y: (leftEyeInner.y + leftEyeOuter.y) / 2
      };
      
      const rightEyeCenter = {
        x: (rightEyeInner.x + rightEyeOuter.x) / 2,
        y: (rightEyeInner.y + rightEyeOuter.y) / 2
      };

      // Calculate face center
      const faceCenter = {
        x: (leftEyeCenter.x + rightEyeCenter.x) / 2,
        y: (leftEyeCenter.y + rightEyeCenter.y) / 2
      };

      // Calculate nose-to-eye alignment (should be centered when looking forward)
      const noseEyeAlignmentX = Math.abs(noseTip.x - faceCenter.x);
      const eyeDistance = Math.abs(rightEyeCenter.x - leftEyeCenter.x);
      
      // Normalize by eye distance to account for different face sizes
      const normalizedDeviationX = noseEyeAlignmentX / eyeDistance;
      
      // Calculate vertical alignment
      const verticalDeviation = Math.abs(faceCenter.y - 0.5);

      // More lenient thresholds - only flag extreme looking away
      const horizontalThreshold = 0.25; // More lenient horizontal threshold
      const verticalThreshold = 0.20; // More lenient vertical threshold

      return normalizedDeviationX > horizontalThreshold || verticalDeviation > verticalThreshold;

    } catch (error) {
      console.error('Gaze analysis error:', error);
      return false;
    }
  }

  private drawFaceLandmarks(landmarks: any[], lookingAway: boolean): void {
    const color = lookingAway ? '#ef4444' : '#22c55e'; // red if looking away, green if focused
    
    this.ctx.fillStyle = color;
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1;

    // Draw key landmarks
    const keyPoints = [1, 33, 263, 61, 291, 199]; // nose, eyes, mouth corners
    keyPoints.forEach(pointIndex => {
      if (landmarks[pointIndex]) {
        const point = landmarks[pointIndex];
        const x = point.x * this.canvas.width;
        const y = point.y * this.canvas.height;
        
        this.ctx.beginPath();
        this.ctx.arc(x, y, 2, 0, 2 * Math.PI);
        this.ctx.fill();
      }
    });

    // Draw status text
    this.ctx.font = '16px Arial';
    this.ctx.fillStyle = color;
    this.ctx.fillText(
      lookingAway ? 'Looking Away' : 'Focused',
      10,
      30
    );
  }

  private drawMultipleFaceWarning(): void {
    this.ctx.fillStyle = '#ef4444';
    this.ctx.font = 'bold 20px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(
      'MULTIPLE FACES DETECTED',
      this.canvas.width / 2,
      50
    );
    this.ctx.textAlign = 'left';
  }

  private drawObjectDetections(objects: DetectedObject[], scale: number): void {
    objects.forEach(obj => {
      const [x, y, width, height] = obj.bbox;
      
      // Scale back up to full resolution
      const scaledX = x / scale;
      const scaledY = y / scale;
      const scaledWidth = width / scale;
      const scaledHeight = height / scale;

      // Draw bounding box
      this.ctx.strokeStyle = '#ef4444';
      this.ctx.lineWidth = 3;
      this.ctx.strokeRect(scaledX, scaledY, scaledWidth, scaledHeight);

      // Draw label
      this.ctx.fillStyle = '#ef4444';
      this.ctx.fillRect(scaledX, scaledY - 25, scaledWidth, 25);
      
      this.ctx.fillStyle = '#ffffff';
      this.ctx.font = '14px Arial';
      this.ctx.fillText(
        `${obj.class} (${(obj.confidence * 100).toFixed(0)}%)`,
        scaledX + 5,
        scaledY - 8
      );
    });
  }

  private clearObjectOverlays(): void {
    // Object overlays are cleared when canvas is cleared in the next frame
  }

  private isProhibitedObject(className: string): boolean {
    const prohibitedItems = [
      'cell phone',
      'laptop',
      'book',
      'keyboard',
      'mouse',
      'tablet',
      'remote'
    ];
    
    return prohibitedItems.some(item => 
      className.toLowerCase().includes(item) || 
      item.includes(className.toLowerCase())
    );
  }

  cleanup(): void {
    this.stopDetection();
    
    if (this.faceMesh) {
      this.faceMesh.close();
      this.faceMesh = null;
    }
    
    this.objectModel = null;
    console.log('Detection engine cleaned up');
  }
}

export default DetectionEngine;