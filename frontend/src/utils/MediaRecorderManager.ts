import localforage from 'localforage';

interface RecordingChunk {
  data: Blob;
  timestamp: number;
}

class MediaRecorderManager {
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: RecordingChunk[] = [];
  private stream: MediaStream;
  private chunkCount = 0;
  private storageKey: string;

  constructor(stream: MediaStream, sessionId?: string) {
    this.stream = stream;
    this.storageKey = `proctoring_session_${sessionId || Date.now()}`;
    
    // Configure localforage for IndexedDB storage
    localforage.config({
      driver: localforage.INDEXEDDB,
      name: 'ProctoringApp',
      version: 1.0,
      storeName: 'recordings'
    });
  }

  async startRecording(): Promise<void> {
    try {
      // Clear any existing chunks
      this.recordedChunks = [];
      await localforage.removeItem(this.storageKey);

      const options: MediaRecorderOptions = {
        mimeType: this.getSupportedMimeType(),
        videoBitsPerSecond: 2500000, // 2.5 Mbps for good quality
        audioBitsPerSecond: 128000   // 128 kbps for audio
      };

      this.mediaRecorder = new MediaRecorder(this.stream, options);

      this.mediaRecorder.ondataavailable = async (event) => {
        if (event.data && event.data.size > 0) {
          const chunk: RecordingChunk = {
            data: event.data,
            timestamp: Date.now()
          };
          
          this.recordedChunks.push(chunk);
          
          // Store chunk in IndexedDB to prevent memory issues
          await this.storeChunk(chunk);
        }
      };

      this.mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event);
        throw new Error('Recording failed');
      };

      this.mediaRecorder.onstart = () => {
        console.log('Recording started');
      };

      this.mediaRecorder.onstop = () => {
        console.log('Recording stopped');
      };

      // Start recording with 3-second chunks to prevent memory issues
      this.mediaRecorder.start(3000);

    } catch (error) {
      console.error('Failed to start recording:', error);
      throw error;
    }
  }

  async stopRecording(): Promise<void> {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      return new Promise((resolve) => {
        this.mediaRecorder!.onstop = () => {
          console.log('Recording stopped successfully');
          resolve();
        };
        this.mediaRecorder!.stop();
      });
    }
  }

  async getRecordingBlob(): Promise<Blob> {
    try {
      // Retrieve all chunks from storage
      const allChunks = await localforage.getItem<RecordingChunk[]>(this.storageKey);
      
      if (!allChunks || allChunks.length === 0) {
        // Fallback to in-memory chunks
        if (this.recordedChunks.length === 0) {
          throw new Error('No recording data available');
        }
        return new Blob(
          this.recordedChunks.map(chunk => chunk.data),
          { type: this.getSupportedMimeType() }
        );
      }

      // Sort chunks by timestamp to ensure proper order
      allChunks.sort((a, b) => a.timestamp - b.timestamp);
      
      return new Blob(
        allChunks.map(chunk => chunk.data),
        { type: this.getSupportedMimeType() }
      );
    } catch (error) {
      console.error('Failed to create recording blob:', error);
      throw error;
    }
  }

  private async storeChunk(chunk: RecordingChunk): Promise<void> {
    try {
      let existingChunks = await localforage.getItem<RecordingChunk[]>(this.storageKey);
      if (!existingChunks) {
        existingChunks = [];
      }
      
      existingChunks.push(chunk);
      await localforage.setItem(this.storageKey, existingChunks);
      
      this.chunkCount++;
      
      // Log storage info every 10 chunks
      if (this.chunkCount % 10 === 0) {
        console.log(`Stored ${this.chunkCount} recording chunks`);
      }
      
    } catch (error) {
      console.error('Failed to store chunk:', error);
      // Continue recording even if storage fails
    }
  }

  private getSupportedMimeType(): string {
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm',
      'video/mp4'
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return 'video/webm'; // Fallback
  }

  getRecordingStats(): { chunkCount: number; duration: number } {
    const duration = this.recordedChunks.length > 0 ? 
      (Date.now() - this.recordedChunks[0].timestamp) / 1000 : 0;
    
    return {
      chunkCount: this.recordedChunks.length,
      duration
    };
  }

  async cleanup(): Promise<void> {
    try {
      await localforage.removeItem(this.storageKey);
      this.recordedChunks = [];
    } catch (error) {
      console.error('Cleanup failed:', error);
    }
  }
}

export default MediaRecorderManager;