declare const Bun: {
    spawnSync(args: string[], options?: Record<string, unknown>): { exitCode: number | null; stdout: Uint8Array };
};

declare const process: {
    execPath: string;
    exit(code?: number): never;
    pid: number;
    platform: string;
    arch: string;
    env: Record<string, string | undefined>;
};

declare interface ImportMeta {
    readonly main?: boolean;
}

declare module "node:fs" {
    export function existsSync(path: string): boolean;
    export function chmodSync(path: string, mode: number): void;
    export function copyFileSync(source: string, destination: string): void;
    export function renameSync(oldPath: string, newPath: string): void;
    export function unlinkSync(path: string): void;
    export function writeFileSync(path: string, data: string | Uint8Array): void;
    export function mkdtempSync(prefix: string): string;
}

declare module "node:fs/promises" {
    export function readFile(path: string, encoding: string): Promise<string>;
    export function writeFile(path: string, data: string, encoding: string): Promise<void>;
}

declare module "node:path" {
    export function resolve(...paths: string[]): string;
    export function join(...paths: string[]): string;
    export function dirname(path: string): string;
}

declare module "node:url" {
    export function fileURLToPath(url: string | URL): string;
}