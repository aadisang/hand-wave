"use client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  Settings,
  Share2,
  Square,
  Video,
  VideoOff,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import Webcam from "react-webcam";
import { toast } from "sonner";

export default function Home() {
  const [isSharing, setIsSharing] = useState(false);
  const [isAudioEnabled, setIsAudioEnabled] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [streamType, setStreamType] = useState<"screen" | "camera" | null>(
    null
  );
  const videoRef = useRef<HTMLVideoElement>(null);
  const webcamRef = useRef<Webcam>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startScreenShare = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "monitor",
        },
        audio: isAudioEnabled,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setIsSharing(true);
        setStreamType("screen");

        // Handle stream end
        stream.getVideoTracks()[0].onended = () => {
          stopSharing();
        };

        toast.success("Screen sharing started successfully!");
      }
    } catch (error) {
      console.error("Error starting screen share:", error);
      toast.error("Failed to start screen sharing");
    }
  }, [isAudioEnabled]);

  const startCamera = useCallback(async () => {
    try {
      setIsSharing(true);
      setStreamType("camera");
      toast.success("Camera started successfully!");
    } catch (error) {
      console.error("Error starting camera:", error);
      toast.error("Failed to start camera");
    }
  }, []);

  const stopSharing = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsSharing(false);
    setStreamType(null);
    toast.info("Sharing stopped");
  }, []);

  const toggleAudio = useCallback(() => {
    setIsAudioEnabled(!isAudioEnabled);
  }, [isAudioEnabled]);

  const toggleVideo = useCallback(() => {
    setIsVideoEnabled(!isVideoEnabled);
  }, [isVideoEnabled]);

  const videoConstraints = {
    width: 1280,
    height: 720,
    facingMode: "user",
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-2 ">
      <div className="w-full max-w-6xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold text-neutral-900 dark:text-neutral-100">
            Sign Language Detection
          </h1>
          <p className="text-neutral-600 dark:text-neutral-400">
            Share your screen or camera to detect sign language in real-time
          </p>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Control Panel */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Controls
              </CardTitle>
              <CardDescription>
                Manage your sharing session and settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Status */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Status</span>
                <Badge variant={isSharing ? "default" : "secondary"}>
                  {isSharing ? "Sharing" : "Idle"}
                </Badge>
              </div>

              {/* Stream Type */}
              {streamType && (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Stream Type</span>
                  <Badge variant="outline">
                    {streamType === "screen" ? "Screen Share" : "Camera"}
                  </Badge>
                </div>
              )}

              {/* Audio Toggle */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Audio</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleAudio}
                  className="w-20"
                >
                  {isAudioEnabled ? (
                    <>
                      <Mic className="h-4 w-4 mr-2" />
                      On
                    </>
                  ) : (
                    <>
                      <MicOff className="h-4 w-4 mr-2" />
                      Off
                    </>
                  )}
                </Button>
              </div>

              {/* Video Toggle */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Video</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleVideo}
                  className="w-20"
                >
                  {isVideoEnabled ? (
                    <>
                      <Video className="h-4 w-4 mr-2" />
                      On
                    </>
                  ) : (
                    <>
                      <VideoOff className="h-4 w-4 mr-2" />
                      Off
                    </>
                  )}
                </Button>
              </div>

              {/* Action Buttons */}
              <div className="space-y-3 pt-4">
                {!isSharing ? (
                  <>
                    <Button
                      onClick={startScreenShare}
                      className="w-full"
                      size="lg"
                    >
                      <Share2 className="h-5 w-5 mr-2" />
                      Share Screen
                    </Button>
                    <Button
                      onClick={startCamera}
                      variant="outline"
                      className="w-full"
                      size="lg"
                    >
                      <Video className="h-5 w-5 mr-2" />
                      Start Camera
                    </Button>
                  </>
                ) : (
                  <Button
                    onClick={stopSharing}
                    variant="destructive"
                    className="w-full"
                    size="lg"
                  >
                    <Square className="h-5 w-5 mr-2" />
                    Stop Sharing
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Video Display */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {streamType === "screen" ? (
                  <Monitor className="h-5 w-5" />
                ) : streamType === "camera" ? (
                  <Video className="h-5 w-5" />
                ) : (
                  <MonitorOff className="h-5 w-5" />
                )}
                {streamType === "screen"
                  ? "Screen Share"
                  : streamType === "camera"
                  ? "Camera Feed"
                  : "Preview"}
              </CardTitle>
              <CardDescription>
                {isSharing
                  ? "Your shared content will appear here for sign language detection"
                  : "Start sharing to see your content here"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative aspect-video bg-neutral-100 dark:bg-neutral-800 rounded-lg overflow-hidden">
                {isSharing && streamType === "screen" ? (
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-contain"
                  />
                ) : isSharing && streamType === "camera" ? (
                  <Webcam
                    ref={webcamRef}
                    audio={isAudioEnabled}
                    videoConstraints={videoConstraints}
                    className="w-full h-full object-contain"
                    mirrored={true}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center space-y-4">
                      <MonitorOff className="h-16 w-16 mx-auto text-neutral-400" />
                      <div className="space-y-2">
                        <p className="text-neutral-600 dark:text-neutral-400 font-medium">
                          No active stream
                        </p>
                        <p className="text-sm text-neutral-500 dark:text-neutral-500">
                          Click "Share Screen" or "Start Camera" to begin
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Detection Results */}
        {isSharing && (
          <Card>
            <CardHeader>
              <CardTitle>Detection Results</CardTitle>
              <CardDescription>
                Real-time sign language detection will appear here
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-neutral-500 dark:text-neutral-400">
                <p>
                  Detection results will appear here when signs are detected
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

