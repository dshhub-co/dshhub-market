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
 * 开发者→买家沟通字段（manifest v2，全部可选；非空才写入 zip 的 manifest.json）。
 * 多行字段统一用换行分隔字符串，与口令卡（bundles 表、解锁卡渲染）的既有约定一致。
 */
export interface PublishItemInfo {
    /** 教程/演示视频链接（preset/skill 平台硬必填，抖音/B站/YouTube 均可） */
    demo?: string;
    /** 使用指南链接，每行一条 */
    teachingLinks?: string;
    /** 上手步骤，每行一步 */
    gettingStarted?: string;
    /** 常见问题，每行一条 Q：/A： */
    faq?: string;
    /** 联系方式，每行一条（微信/群/邮箱） */
    contact?: string;
    /** 更新说明 */
    changelog?: string;
}
/** 从任意原始条目提取六个沟通字段（空值丢弃；供 bridge/routes 复用）。 */
export declare function buildPublishInfo(raw: Record<string, unknown>): PublishItemInfo;
/**
 * Build a manifest.json object for the selected item.
 * @param info - 开发者→买家沟通字段，非空字符串才写入（空值整字段丢弃）。
 */
export declare function buildManifest(item: ScannedItem, accountId: string, authorName: string, info?: PublishItemInfo): Record<string, unknown>;
/**
 * Package the selected item(s) into a zip and upload to the platform.
 * 同一内容重复发布时平台会 409「该版本已存在」：自动把补丁版本号 +1 重试
 * 一次（如 1.0.0 → 1.0.1），让「修复后重新发布」不要求用户改任何文件。
 */
export declare function publishItems(items: ScannedItem[], opts: {
    apiBase: string;
    token?: string;
    accountId: string;
    authorName: string;
    /** 开发者→买家沟通字段（demo 并入此对象；旧接口的顶层 demoUrl 由调用方转成 { demo }） */
    info?: PublishItemInfo;
}): Promise<PublishResult>;
/** 补丁版本号 +1：1.0.0 → 1.0.1；非标准格式时追加 .1 兜底。 */
export declare function bumpPatch(version: string): string;
