/**
 * 终端命令里有没有直接调飞书 CLI（工具前钩子用，纯函数）。
 *
 * 飞书只能经插件的 feishu_* 工具读写：权限闸在工具里。官方 lark Skill 会教 Agent 直接在终端敲 lark-cli，
 * 那样就绕过了「只读你给的链接」。命令里出现可执行名就拦，宁可多拦（例如 echo 里提到它）也不漏：
 * 多拦的那一次用户在放行卡上点一下就过了
 */

/** 可执行名：lark-cli、lark-cli.exe / .cmd，npm 包名 @larksuite/cli（npx 调用），带路径的也算 */
const PATTERNS = [/(^|[\s/\\'"`;&|(=])lark-cli(\.exe|\.cmd|\.ps1)?(?=$|[\s'"`;&|)])/i, /@larksuite\/cli\b/i]

/** 命令文本里调了飞书 CLI 吗 */
export const callsLarkCli = (command: string) => PATTERNS.some((re) => re.test(command))
