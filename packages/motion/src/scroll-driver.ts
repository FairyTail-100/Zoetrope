export interface ScrollDriverOptions {
  container?: Window | HTMLElement;
  triggerElement?: HTMLElement;
  /** Custom scroll height multiplier, e.g. 300vh */
  scrollMultiplier?: number;
}

export class ScrollDriver {
  private container: Window | HTMLElement;
  private triggerElement?: HTMLElement;
  private onScrollCallback?: (progress: number) => void;
  private isDestroyed: boolean = false;

  constructor(options?: ScrollDriverOptions) {
    this.container = options?.container ?? (typeof window !== 'undefined' ? window : ({} as Window));
    this.triggerElement = options?.triggerElement;
    this.handleScroll = this.handleScroll.bind(this);
  }

  public init(callback: (progress: number) => void): void {
    this.onScrollCallback = callback;
    if (typeof window === 'undefined') return;

    if (this.container === window) {
      window.addEventListener('scroll', this.handleScroll, { passive: true });
      window.addEventListener('resize', this.handleScroll, { passive: true });
    } else if (this.container instanceof HTMLElement) {
      this.container.addEventListener('scroll', this.handleScroll, { passive: true });
    }

    // Initial check
    this.handleScroll();
  }

  private handleScroll(): void {
    if (this.isDestroyed || !this.onScrollCallback) return;

    let progress = 0;

    if (this.triggerElement) {
      const rect = this.triggerElement.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const totalDist = rect.height - windowHeight;

      if (totalDist > 0) {
        // Starts when top hits top of viewport
        const scrolled = -rect.top;
        progress = Math.max(0, Math.min(1, scrolled / totalDist));
      } else {
        progress = 0;
      }
    } else if (this.container === window) {
      const doc = document.documentElement;
      const body = document.body;
      const scrollTop = window.scrollY || doc.scrollTop || body.scrollTop || 0;
      const scrollHeight = Math.max(
        body.scrollHeight,
        doc.scrollHeight,
        body.offsetHeight,
        doc.offsetHeight
      );
      const clientHeight = window.innerHeight || doc.clientHeight;
      const maxScroll = scrollHeight - clientHeight;

      progress = maxScroll > 0 ? Math.max(0, Math.min(1, scrollTop / maxScroll)) : 0;
    } else if (this.container instanceof HTMLElement) {
      const maxScroll = this.container.scrollHeight - this.container.clientHeight;
      progress = maxScroll > 0 ? Math.max(0, Math.min(1, this.container.scrollTop / maxScroll)) : 0;
    }

    this.onScrollCallback(progress);
  }

  public destroy(): void {
    this.isDestroyed = true;
    if (typeof window === 'undefined') return;

    if (this.container === window) {
      window.removeEventListener('scroll', this.handleScroll);
      window.removeEventListener('resize', this.handleScroll);
    } else if (this.container instanceof HTMLElement) {
      this.container.removeEventListener('scroll', this.handleScroll);
    }
  }
}
