declare module "react-native-live-audio-stream" {
  type InitOptions = {
    sampleRate?: number;
    channels?: number;
    bitsPerSample?: number;
    audioSource?: number;
    bufferSize?: number;
    wavFile?: string;
  };

  type LiveAudioStreamModule = {
    init(options: InitOptions): void;
    start(): void;
    stop(): void;
    on(event: "data", listener: (data: string) => void): void;
    removeAllListeners?(event: "data"): void;
  };

  const LiveAudioStream: LiveAudioStreamModule;
  export default LiveAudioStream;
}
