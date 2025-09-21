// Web Worker for handling heavy ML inference off the main thread
import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

let objectModel: cocoSsd.ObjectDetection | null = null;
let isInitialized = false;

interface WorkerMessage {
  type: string;
  data?: any;
  id?: string;
}

interface DetectionResult {
  class: string;
  confidence: number;
  bbox: [number, number, number, number];
}

// Initialize TensorFlow.js and models
async function initializeModels() {
  try {
    // Set backend to WebGL for better performance
    await tf.setBackend('webgl');
    await tf.ready();
    
    // Load object detection model
    objectModel = await cocoSsd.load({
      base: 'mobilenet_v2'
    });
    
    isInitialized = true;
    
    self.postMessage({
      type: 'modelLoaded',
      data: { success: true, model: 'objectDetection' }
    });
    
  } catch (error) {
    console.error('Model initialization failed:', error);
    
    self.postMessage({
      type: 'modelLoaded',
      data: { success: false, model: 'objectDetection', error: error.message }
    });
  }
}

// Process object detection on a frame
async function processObjectDetection(imageData: ImageData, id: string) {
  if (!objectModel || !isInitialized) {
    self.postMessage({
      type: 'detectionResult',
      data: { objects: [], error: 'Model not initialized' },
      id
    });
    return;
  }

  try {
    // Convert ImageData to tensor
    const tensor = tf.browser.fromPixels(imageData);
    
    // Run detection
    const predictions = await objectModel.detect(tensor);
    
    // Filter for prohibited objects
    const prohibitedItems = [
      'cell phone', 'laptop', 'book', 'keyboard', 
      'mouse', 'tablet', 'remote', 'person'
    ];
    
    const detectedObjects: DetectionResult[] = predictions
      .filter(pred => {
        const isProhibited = prohibitedItems.some(item => 
          pred.class.toLowerCase().includes(item) || 
          item.includes(pred.class.toLowerCase())
        );
        return isProhibited && pred.score > 0.45;
      })
      .map(pred => ({
        class: pred.class,
        confidence: pred.score,
        bbox: pred.bbox
      }));

    // Clean up tensor
    tensor.dispose();

    self.postMessage({
      type: 'detectionResult',
      data: { objects: detectedObjects },
      id
    });

  } catch (error) {
    console.error('Object detection error:', error);
    
    self.postMessage({
      type: 'detectionResult',
      data: { objects: [], error: error.message },
      id
    });
  }
}

// Handle messages from main thread
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type, data, id } = event.data;

  switch (type) {
    case 'initialize':
      await initializeModels();
      break;

    case 'detectObjects':
      if (data && data.imageData && id) {
        await processObjectDetection(data.imageData, id);
      }
      break;

    case 'setBackend':
      if (data && data.backend) {
        try {
          await tf.setBackend(data.backend);
          console.log(`TensorFlow.js backend set to: ${data.backend}`);
        } catch (error) {
          console.error('Failed to set backend:', error);
        }
      }
      break;

    case 'cleanup':
      if (objectModel) {
        objectModel = null;
      }
      tf.disposeVariables();
      isInitialized = false;
      break;

    default:
      console.warn('Unknown message type:', type);
  }
};

// Handle worker errors
self.onerror = (error: ErrorEvent) => {
  console.error('Worker error:', error);
  self.postMessage({
    type: 'error',
    data: { message: error.message || 'Unknown worker error' }
  });
};

// Log that worker is ready
console.log('Inference worker initialized');