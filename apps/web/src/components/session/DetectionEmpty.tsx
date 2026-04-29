import { Hand } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export function DetectionEmpty() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Hand />
        </EmptyMedia>
        <EmptyTitle>No detections yet</EmptyTitle>
        <EmptyDescription>
          Start the camera and show an ASL sign to build the history.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
