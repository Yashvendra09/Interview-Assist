# Video Interview Proctoring System

A comprehensive AI-powered video interview proctoring solution with real-time face detection, gaze tracking, and object detection capabilities. Built with React, TypeScript, and advanced ML models for reliable monitoring.

## 🚀 Features

### Core Proctoring Capabilities
- **Continuous Video Recording**: Chunked recording with IndexedDB storage for sessions > 10 minutes
- **Real-time Face Detection**: MediaPipe Face Mesh for robust face tracking
- **Gaze Tracking**: Advanced head pose estimation to detect when candidates look away
- **Object Detection**: TensorFlow.js COCO-SSD model to identify prohibited items
- **Multi-face Detection**: Instant alerts when multiple people are detected
- **Event Logging**: Comprehensive timestamped event system with severity levels

### Performance & Reliability
- **Web Worker Architecture**: Heavy ML inference offloaded from main thread
- **Adaptive Frame Rates**: Face detection at 8 FPS, object detection at 2 FPS
- **Graceful Degradation**: Fallback mechanisms when models fail to load
- **Memory Management**: Chunked video storage prevents memory overflow
- **Cross-browser Support**: WebRTC and MediaRecorder API compatibility

### Reporting & Analytics
- **Live Event Dashboard**: Real-time violation monitoring with severity indicators
- **Downloadable Reports**: CSV and PDF export with detailed analytics
- **Professional Formatting**: Branded PDF reports with event summaries
- **Data Persistence**: IndexedDB storage for offline capability

## 🛠️ Technology Stack

- **Frontend**: React 18 + TypeScript + Tailwind CSS
- **ML Models**: 
  - MediaPipe Face Mesh (face/gaze detection)
  - TensorFlow.js + COCO-SSD (object detection)
- **Recording**: WebRTC getUserMedia + MediaRecorder API
- **Storage**: IndexedDB via LocalForage
- **Reports**: jsPDF for PDF generation
- **UI Components**: Shadcn/ui with custom design system

## 📋 Detection Algorithms

### Face & Gaze Detection
- **No Face Threshold**: 10 seconds
- **Looking Away Threshold**: 5 seconds  
- **Multiple Face Detection**: Instant alert
- **Gaze Estimation**: Head pose analysis using facial landmarks
- **Smoothing**: Rolling average over 0.5s to reduce jitter

### Object Detection
- **Prohibited Items**: Cell phones, laptops, books, tablets, keyboards
- **Confidence Threshold**: 45%
- **Debouncing**: Prevents duplicate alerts for persistent objects
- **Performance**: 2-3 FPS inference rate for optimal CPU usage

## 🎯 Usage Instructions

### Starting a Session
1. Enter candidate name on the landing page
2. Click "Start Proctored Interview"
3. Grant camera and microphone permissions
4. Wait for AI models to load (progress indicators shown)
5. Click "Start Interview" to begin recording and monitoring

### During the Session
- **Live Video**: Real-time feed with detection overlays
- **Event Log**: Timestamped violations and system events
- **Model Status**: Green indicators when detection is active
- **Recording Status**: Red "RECORDING" badge when active

### Ending a Session
1. Click "Stop Interview" to end recording
2. Download video file (.webm format)
3. Download CSV report with event details
4. Download PDF report with formatted summary
5. Click "End Session" to return to home

## 🔧 Installation & Setup

```bash
# Clone the repository
git clone <your-repo-url>
cd video-proctoring-system

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

### Browser Requirements
- Chrome 88+ (recommended)
- Firefox 85+
- Safari 14+
- Edge 88+

## 📊 Event Types & Severity Levels

### Violation Events (High Severity)
- **Multiple Faces**: More than one person detected
- **No Face**: Face absent for > 10 seconds
- **Phone Detected**: Cell phone in camera view

### Behavior Events (Medium Severity)  
- **Looking Away**: Gaze diverted for > 5 seconds
- **Object Detected**: Books, laptops, or other items

### System Events (Low Severity)
- **Recording Started/Stopped**
- **Model Loading Status**
- **Camera Initialization**

## 🎛️ Configuration Options

### Detection Thresholds (Configurable)
```typescript
const settings = {
  lookAwayThreshold: 5,        // seconds
  noFaceThreshold: 10,         // seconds
  objectConfidence: 0.45,      // 45% minimum
  faceDetectionFPS: 8,         // frames per second
  objectDetectionFPS: 2        // frames per second
};
```

### Recording Settings
```typescript
const recordingOptions = {
  mimeType: 'video/webm;codecs=vp9,opus',
  videoBitsPerSecond: 2500000,  // 2.5 Mbps
  audioBitsPerSecond: 128000,   // 128 kbps
  chunkInterval: 3000          // 3 second chunks
};
```

## 🧪 Testing & Quality Assurance

### Acceptance Test Checklist
- [ ] 12+ minute continuous recording without failure
- [ ] Looking away detection triggers after 5 seconds
- [ ] No-face detection triggers after 10 seconds  
- [ ] Multiple face detection is instantaneous
- [ ] Phone detection works within 1 second of appearance
- [ ] CSV export contains all required fields
- [ ] PDF report generates successfully
- [ ] Models load with progress indication
- [ ] Graceful handling of camera permission denial

### Performance Benchmarks
- **Model Load Time**: < 10 seconds on average connection
- **Detection Latency**: < 200ms for face detection
- **Memory Usage**: < 500MB for 30-minute session
- **CPU Usage**: < 30% on modern hardware

## 🔒 Privacy & Security

- **Local-Only Processing**: No data sent to external servers
- **Client-Side ML**: All detection runs in browser
- **Secure Storage**: IndexedDB with automatic cleanup
- **No Network Dependencies**: Works offline after initial load

## 🚧 Known Limitations

1. **Model Loading**: Requires stable internet for initial model download
2. **Browser Support**: Limited to modern browsers with WebRTC support
3. **Lighting Conditions**: Face detection accuracy depends on lighting
4. **Mobile Performance**: Resource-intensive on mobile devices
5. **Storage Limits**: Browser quota limits for very long sessions

## 🛣️ Future Enhancements

- [ ] Advanced eye-tracking with pupil detection
- [ ] Custom object training for specific items
- [ ] Cloud storage integration for enterprise
- [ ] Real-time streaming to proctor dashboard
- [ ] Advanced analytics and behavior scoring
- [ ] Multi-language support for reports

## 📈 Demo & Sample Data

Check the `/demo` folder for:
- Sample proctoring session recording
- Example CSV report with realistic data
- Screenshots of the interface
- Performance benchmarks

## 📞 Support & Contributions

For issues, feature requests, or contributions, please refer to:
- GitHub Issues for bug reports
- Documentation wiki for detailed guides
- Contributing guidelines for code submissions

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

Built using React, TypeScript, and cutting-edge web ML technologies.