"use client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { trpc } from "@/utils/trpc";
import { useMutation } from "@tanstack/react-query";

export default function Home() {
  const { data, isPending, mutate } = useMutation(
    trpc.detection.detect.mutationOptions()
  );

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-2">
      <Card className="flex max-w-3xl w-full">
        <CardHeader>
          <CardTitle>Sign Language Detection</CardTitle>
          <CardDescription>
            Test the sign language detection API with fake data
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={() =>
              mutate({
                imageData: "https://example.com/image.jpg",
              })
            }
            disabled={isPending}
            className="w-full"
          >
            {isPending ? "Detecting..." : "Detect Sign Language"}
          </Button>

          {data && (
            <div className="space-y-2">
              <h3 className="font-medium">Detection Result:</h3>
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">
                    Detected Sign:
                  </span>
                  <span className="font-mono font-bold text-lg">
                    {data.detectedSign}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">
                    Confidence:
                  </span>
                  <span className="font-mono">
                    {(data.confidence * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">
                    Processing Time:
                  </span>
                  <span className="font-mono">{data.processingTime}ms</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">
                    Model Version:
                  </span>
                  <span className="font-mono">{data.modelVersion}</span>
                </div>
                {data.boundingBox && (
                  <div className="pt-2 border-t">
                    <div className="text-sm text-muted-foreground mb-1">
                      Bounding Box:
                    </div>
                    <div className="font-mono text-xs">
                      x: {data.boundingBox.x.toFixed(1)}, y:{" "}
                      {data.boundingBox.y.toFixed(1)}, w:{" "}
                      {data.boundingBox.width.toFixed(1)}, h:{" "}
                      {data.boundingBox.height.toFixed(1)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

