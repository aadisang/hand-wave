import {
  CardFrame,
  CardFrameHeader,
  CardFrameTitle,
} from "@/components/ui/card";
import { useDetectionsStore } from "@/stores/detections-store";
import { DetectionEmpty } from "./DetectionEmpty";
import { DetectionTable } from "./DetectionTable";

export function DetectionResults() {
  const history = useDetectionsStore((s) => s.history);
  const hasHistory = history.length > 0;

  return (
    <CardFrame>
      <CardFrameHeader className="pb-2">
        <CardFrameTitle>Detection History</CardFrameTitle>
      </CardFrameHeader>

      {hasHistory ? (
        <div className="px-4 pb-4">
          <DetectionTable />
        </div>
      ) : (
        <DetectionEmpty />
      )}
    </CardFrame>
  );
}
