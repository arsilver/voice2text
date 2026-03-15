import { cleanTranscriptText, mergeTranscriptText } from "./transcript-merge";

interface SegmentEntry {
  index: number;
  text: string;
  status: "pending" | "completed" | "failed";
}

export class SegmentLedger {
  private readonly segments = new Map<number, SegmentEntry>();

  markPending(index: number) {
    const existing = this.segments.get(index);
    this.segments.set(index, {
      index,
      text: existing?.text ?? "",
      status: existing?.status ?? "pending",
    });
  }

  setText(index: number, text: string) {
    this.segments.set(index, {
      index,
      text: cleanTranscriptText(text),
      status: "completed",
    });
  }

  appendText(index: number, text: string) {
    const existing = this.segments.get(index);
    this.segments.set(index, {
      index,
      text: cleanTranscriptText(`${existing?.text ?? ""} ${text}`),
      status: existing?.status ?? "pending",
    });
  }

  markFailed(index: number) {
    const existing = this.segments.get(index);
    this.segments.set(index, {
      index,
      text: existing?.text ?? "",
      status: "failed",
    });
  }

  getPendingCount() {
    let pendingCount = 0;

    for (const segment of this.segments.values()) {
      if (segment.status === "pending") {
        pendingCount += 1;
      }
    }

    return pendingCount;
  }

  buildTranscript() {
    return [...this.segments.values()]
      .sort((left, right) => left.index - right.index)
      .map((segment) => segment.text)
      .filter(Boolean)
      .reduce((merged, nextText) => mergeTranscriptText(merged, nextText), "")
      .trim();
  }
}
