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
interface BridgeState {
    sessionId: string;
    secret: string;
    profile: string;
}
export declare function register(profile: string, version: string): Promise<BridgeState>;
/** 单轮轮询：取任务并执行。返回 'ok'（正常结束）或 'rejected'（凭据失效，需重注册）。 */
export declare function pollOnce(state: BridgeState): Promise<'ok' | 'rejected'>;
/**
 * 启动云端发布通道：注册 + 无限轮询（随 DSH 进程生命周期运行）。
 * 所有失败（网络抖动 / 平台短时不可用）都静默等待下一轮，不抛错不退出。
 */
export declare function startCloudBridge(profile: string): Promise<void>;
export {};
