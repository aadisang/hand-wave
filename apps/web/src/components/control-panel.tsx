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
import { useSharingStore } from "@/stores/sharing-store";
import { Settings, Share2, Square, Video } from "lucide-react";

export function ControlPanel() {
  const { isSharing, streamType, startScreenShare, startCamera, stopSharing } =
    useSharingStore();

  return (
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

        {/* Action Buttons */}
        <div className="space-y-3 pt-4">
          {!isSharing ? (
            <>
              <Button onClick={startScreenShare} className="w-full" size="lg">
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
  );
}

