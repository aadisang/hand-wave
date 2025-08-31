"use client";
import { ControlPanel } from "@/components/control-panel";
import { DetectionResults } from "@/components/detection-results";
import { VideoDisplay } from "@/components/video-display";
import { useSharingStore } from "@/stores/sharing-store";

export default function Home() {
  const { isSharing } = useSharingStore();

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-2">
      <div className="w-full max-w-6xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold text-neutral-900 dark:text-neutral-100">
            Hand Wave
          </h1>
          <p className="text-neutral-600 dark:text-neutral-400">
            Share your screen or camera to detect sign language in real-time
          </p>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <ControlPanel />
          <VideoDisplay />
        </div>

        {/* Detection Results */}
        {isSharing && <DetectionResults />}
      </div>
    </div>
  );
}

