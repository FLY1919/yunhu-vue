declare module 'gifenc' {
  export function GIFEncoder(): { writeFrame(index: Uint8Array, width: number, height: number, options: Record<string, any>): void; finish(): void; bytes(): Uint8Array }
  export function quantize(data: Uint8Array | Uint8ClampedArray, count: number, options?: Record<string, any>): number[][]
  export function applyPalette(data: Uint8Array | Uint8ClampedArray, palette: number[][], format?: string): Uint8Array
}
