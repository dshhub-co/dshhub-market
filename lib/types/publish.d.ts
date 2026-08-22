/**
 * Publish flow: scan local profile for publishable items (presets/skills),
 * package them into a manifest v2 zip, and upload to dshhub.co.
 *
 * The creator picks items from the scan result, the client generates a thin
 * manifest.json (kind=preset or kind=skill), zips everything, and POSTs it
 * to the platform's /api/creator/upload endpoint.
 */
import type { ScannedItem } from './preset-scan.ts';
export interface PublishResult {
    ok: boolean;
    pluginId?: string;
    id?: string;
    name?: string;
    version?: string;
    kind?: string;
    error?: string;
    /** 一次发布多项时，每项的成功结果（bridge 逐项调用后汇总） */
    published?: Array<{
        name: string;
        id: string;
        kind: string;
        version: string;
    }>;
}
/**
 * Build a manifest.json object for the selected item.
 */
export declare function buildManifest(item: ScannedItem, accountId: string, authorName: string): Record<string, unknown>;
/**
 * Package the selected item(s) into a zip and upload to the platform.
 */
export declare function publishItems(items: ScannedItem[], opts: {
    apiBase: string;
    token?: string;
    accountId: string;
    authorName: string;
    demoUrl?: string;
}): Promise<PublishResult>;
