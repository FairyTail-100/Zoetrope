import { FrameFetchRequest } from './types.js';

export class PriorityQueue {
  private queue: FrameFetchRequest[] = [];

  public enqueue(item: FrameFetchRequest): void {
    // Insert sorted by priority descending
    let inserted = false;
    for (let i = 0; i < this.queue.length; i++) {
      if (item.priority > this.queue[i].priority) {
        this.queue.splice(i, 0, item);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      this.queue.push(item);
    }
  }

  public dequeue(): FrameFetchRequest | undefined {
    return this.queue.shift();
  }

  public peek(): FrameFetchRequest | undefined {
    return this.queue[0];
  }

  public remove(frameId: number): FrameFetchRequest | undefined {
    const index = this.queue.findIndex((r) => r.frameId === frameId);
    if (index !== -1) {
      return this.queue.splice(index, 1)[0];
    }
    return undefined;
  }

  public reprioritize(calculatePriority: (frameId: number) => number): void {
    for (const req of this.queue) {
      req.priority = calculatePriority(req.frameId);
    }
    this.queue.sort((a, b) => b.priority - a.priority);
  }

  public purgeBeyond(isOutOfHorizon: (frameId: number) => boolean): number {
    const remaining: FrameFetchRequest[] = [];
    let purgedCount = 0;
    for (const req of this.queue) {
      if (isOutOfHorizon(req.frameId)) {
        purgedCount++;
        req.abortController.abort();
        req.reject(new DOMException(`Frame ${req.frameId} request aborted: out of horizon`, 'AbortError'));
      } else {
        remaining.push(req);
      }
    }
    this.queue = remaining;
    return purgedCount;
  }

  public size(): number {
    return this.queue.length;
  }

  public clear(): void {
    for (const req of this.queue) {
      req.abortController.abort();
      req.reject(new DOMException('Queue cleared', 'AbortError'));
    }
    this.queue = [];
  }
}
