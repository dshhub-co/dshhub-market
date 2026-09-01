/**
 * Cloud bridge: the publish channel that goes through the dshhub.co platform
 * instead of a browser-to-localhost HTTP socket.
 *
 * Why: browsers block https-page → http://127.0.0.1 fetches (Safari local
 * network policy, Chrome Private Network Access preflight). The publish page
 * used to probe http://127.0.0.1:3750 directly; creators would have had to
 * change browser security settings — unacceptable. Instead this bridge
 * registers with the platform on startup (getting a per-session secret),
 * then polls an HTTPS task queue. The website creates tasks (scan / upload)
 * and polls their results. Zero browser-to-localhost traffic.
 *
 * The local HTTP bridge (bridge.ts) stays for in-DSH install / update flows,
 * which are process-internal and unaffected by browser policies.
 *
 * Lifecycle: register → poll loop (each poll doubles as heartbeat; the
 * platform marks a session offline after 15 min without one) → execute
 * tasks → report results. On 403 (secret invalidated) re-register.
 */
/**
 * 把本机桥接会话绑定到 dshhub 账号（配对码方案，0.8.47）：
 * 遍历本机各 profile 的桥接状态文件，用网页端生成的 6 位配对码调用
 * /api/bridge/bind 绑定。一次绑定永久生效——之后会话列表/任务派发按账号
 * 隔离，不再依赖 IP（代理/VPN 无影响）。
 */
export declare function bindToAccount(code: string): Promise<{
    ok: boolean;
    error?: string;
}>;
/** 在系统文件管理器中打开目录（「打开文件夹」任务；安全：只允许存在的目录，无提权） */
export declare function openInFileManager(dir: string): {
    ok: boolean;
    error?: string;
};
/**
 * 打开 DSH 标准目录（发布页「一键打开」按钮用，2026-09-02）：
 *   'presets' → ~/.dsh/.agent-presets；'skills' → ~/.dsh/skills。
 * 目录不存在时返回提示（不报错）。
 */
export declare function openStandardDir(which: 'presets' | 'skills'): {
    ok: boolean;
    dir?: string;
    error?: string;
};
interface BridgeState {
    sessionId: string;
    secret: string;
    profile: string;
}
type PollOutcome = 'ok' | 'task' | 'rejected' | 'upgrade-required';
export declare function register(profile: string, version: string): Promise<BridgeState>;
/** 单轮轮询：取任务并执行。返回 'task'（执行了任务）/ 'ok'（空轮询）/ 'rejected'（凭据失效）。 */
export declare function pollOnce(state: BridgeState): Promise<PollOutcome>;
/**
 * 停止云端发布通道（2026-09-02，0.8.56）：市场界面关闭即停止轮询——
 * 不打开市场界面 = 0 轮询、0 平台请求（极致资源优化）。再次 startCloudBridge
 * 会重新启动（界面重新打开时）。
 */
export declare function stopCloudBridge(): void;
/**
 * 启动云端发布通道：注册 + 自适应退避轮询（随市场界面生命周期运行）。
 * 所有失败（网络抖动 / 平台短时不可用）都静默等待下一轮，不抛错不退出。
 *
 * 退避逻辑：work（有任务/重新注册）→ 间隔复位到基础值；
 * 空闲 → 间隔 ×2 递增，封顶 120s。
 */
export declare function startCloudBridge(profile: string): Promise<void>;
export {};
