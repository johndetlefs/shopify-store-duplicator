/**
 * Progress bar utility for tracking long-running operations.
 * Provides a simple, dependency-free progress bar for CLI operations.
 */

export interface ProgressBarOptions {
  total: number;
  width?: number;
  format?: string;
  clear?: boolean;
}

export class ProgressBar {
  private total: number;
  private current: number;
  private width: number;
  private format: string;
  private clear: boolean;
  private startTime: number;
  private lastRender: string;

  constructor(options: ProgressBarOptions) {
    this.total = options.total;
    this.current = 0;
    this.width = options.width || 40;
    this.format = options.format || ":bar :percent :current/:total :eta";
    this.clear = options.clear ?? false;
    this.startTime = Date.now();
    this.lastRender = "";
  }

  /**
   * Update the progress bar by incrementing the current value
   */
  tick(delta: number = 1): void {
    this.current = Math.min(this.current + delta, this.total);
    this.render();
  }

  /**
   * Set the current progress value directly
   */
  update(current: number): void {
    this.current = Math.min(current, this.total);
    this.render();
  }

  /**
   * Complete the progress bar
   */
  complete(): void {
    this.current = this.total;
    this.render();
    if (this.clear) {
      this.clearLine();
    } else {
      process.stdout.write("\n");
    }
  }

  /**
   * Render the progress bar to stdout
   */
  private render(): void {
    const percent = this.total === 0 ? 100 : (this.current / this.total) * 100;
    const filled = Math.round((this.width * this.current) / this.total);
    const empty = this.width - filled;

    const bar = "█".repeat(filled) + "░".repeat(empty);

    // Calculate ETA
    const elapsed = Date.now() - this.startTime;
    const rate = this.current / elapsed; // items per ms
    const remaining = this.total - this.current;
    const eta = rate > 0 ? this.formatTime(remaining / rate) : "calculating...";

    let output = this.format
      .replace(":bar", bar)
      .replace(":percent", `${percent.toFixed(1)}%`)
      .replace(":current", this.current.toString())
      .replace(":total", this.total.toString())
      .replace(":eta", `ETA: ${eta}`)
      .replace(":elapsed", this.formatTime(elapsed));

    // Only render if changed (avoid flickering)
    if (output !== this.lastRender) {
      this.clearLine();
      process.stdout.write(output);
      this.lastRender = output;
    }
  }

  /**
   * Clear the current line
   */
  private clearLine(): void {
    process.stdout.write("\r");
    process.stdout.write(" ".repeat(this.lastRender.length));
    process.stdout.write("\r");
  }

  /**
   * Format milliseconds to human-readable time
   */
  private formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}

/**
 * Create a simple progress bar
 */
export function createProgressBar(
  total: number,
  options?: Partial<ProgressBarOptions>
): ProgressBar {
  return new ProgressBar({
    total,
    ...options,
  });
}
