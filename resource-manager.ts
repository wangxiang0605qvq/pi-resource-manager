import { existsSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
	CONFIG_DIR_NAME,
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const DISABLED = ".disabled";
const PAGE = 8;
const WIDTH = 54;

interface Row {
	kind: "skill" | "ext";
	name: string;
	desc: string;
	/** 入口文件路径（可能带 .disabled 后缀） */
	path: string;
	/** 是否是已重命名的遗留文件（当前未加载） */
	stale: boolean;
}

export default function (pi: ExtensionAPI) {
	let opened = false;

	const extDirs = () => [
		join(getAgentDir(), "extensions"),
		join(process.cwd(), CONFIG_DIR_NAME, "extensions"),
	];
	const skillDirs = () => [
		join(getAgentDir(), "skills"),
		join(process.cwd(), CONFIG_DIR_NAME, "skills"),
	];

	function collectRenamed(dir: string, out: string[], depth = 0): void {
		if (depth > 3 || !existsSync(dir)) return;
		let entries: ReturnType<typeof readdirSync>;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			const p = join(dir, e.name);
			if (e.isDirectory()) collectRenamed(p, out, depth + 1);
			else if (e.name.endsWith(DISABLED)) out.push(p);
		}
	}

	function buildRows(): Row[] {
		const cmds = pi.getCommands();
		const rows: Row[] = [];

		for (const c of cmds.filter((c) => c.source === "skill")) {
			const path = c.sourceInfo?.path ?? "";
			if (!path) continue;
			rows.push({
				kind: "skill",
				name: c.name.replace(/^skill:/, ""),
				desc: c.description?.trim() || "（无描述）",
				path,
				stale: false,
			});
		}

		const exts = new Map<string, string[]>();
		for (const t of pi.getAllTools()) {
			const p = t.sourceInfo?.path;
			if (!p || p.startsWith("<")) continue;
			exts.set(p, [...(exts.get(p) ?? []), t.name]);
		}
		const extCmds = new Map<string, string[]>();
		for (const c of cmds) {
			if (c.source !== "extension") continue;
			const p = c.sourceInfo?.path;
			if (!p || p.startsWith("<")) continue;
			exts.set(p, exts.get(p) ?? []);
			extCmds.set(p, [...(extCmds.get(p) ?? []), `/${c.name}`]);
		}
		for (const [path, tools] of exts) {
			const parts: string[] = [];
			if (tools.length) parts.push(`工具 ${tools.join("/")}`);
			const cs = extCmds.get(path);
			if (cs?.length) parts.push(`命令 ${cs.join(" ")}`);
			rows.push({
				kind: "ext",
				name: basename(path).replace(/\.[cm]?[jt]s$/, ""),
				desc: parts.join(" · ") || "无工具与命令",
				path,
				stale: false,
			});
		}

		// 历史遗留的 *.disabled 文件，只能删除
		const found: string[] = [];
		for (const d of [...extDirs(), ...skillDirs()]) collectRenamed(d, found);
		const seen = new Set(rows.map((r) => r.path));
		for (const p of found) {
			if (seen.has(p) || seen.has(p.slice(0, -DISABLED.length))) continue;
			const base = basename(p);
			if (base === "SKILL.md" + DISABLED) {
				rows.push({
					kind: "skill",
					name: basename(dirname(p)),
					desc: "遗留的停用文件（SKILL.md.disabled），可删除",
					path: p,
					stale: true,
				});
			} else if (/\.(ts|js|mts|mjs)\.disabled$/.test(base)) {
				rows.push({
					kind: "ext",
					name: base.replace(/\.(ts|js|mts|mjs)\.disabled$/, ""),
					desc: "遗留的停用文件，可删除",
					path: p,
					stale: true,
				});
			}
		}
		return rows;
	}

	function removeEntry(row: Row): string | undefined {
		const base = basename(row.path);
		try {
			if (base.startsWith("SKILL.md") || /^index\.[cm]?[jt]s(\.disabled)?$/.test(base)) {
				rmSync(dirname(row.path), { recursive: true, force: true });
			} else {
				rmSync(row.path, { force: true });
			}
			return undefined;
		} catch (err) {
			return String(err);
		}
	}

	async function openPanel(ctx: ExtensionContext): Promise<void> {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("需要 TUI 模式", "error");
			return;
		}
		if (opened) return;
		opened = true;

		try {
			await ctx.ui.custom(
				(tui, theme, _kb, done) => {
					let rows = buildRows();
					let index = 0;
					let askDelete = false;
					let message = "";

					const refresh = (keepName: string) => {
						rows = buildRows();
						const found = rows.findIndex((r) => r.name === keepName);
						index = found >= 0 ? found : Math.min(index, Math.max(0, rows.length - 1));
					};

					return {
						invalidate() {},
						render(width: number) {
							const inner = Math.max(10, width - 4);
							const body: string[] = [
								`${theme.fg("accent", theme.bold("资源管理"))}${theme.fg(
									"dim",
									"  Alt+J/K 移动 · d 删除 · Esc 关闭",
								)}`,
								message ? theme.fg("warning", message) : "",
							];
							if (rows.length === 0) body.push(theme.fg("dim", "没有 skill 或扩展"));

							const start = Math.max(0, Math.min(index - Math.floor(PAGE / 2), rows.length - PAGE));
							rows.slice(start, start + PAGE).forEach((row, i) => {
								const pos = start + i;
								const selected = pos === index;
								const cursor = selected ? theme.fg("accent", "▸ ") : "  ";
								const tag = row.kind === "skill" ? "[技能]" : "[扩展]";
								const suffix = row.stale ? theme.fg("warning", "（已重命名）") : "";
								body.push(
									truncateToWidth(
										`${cursor}${theme.fg("muted", tag)} ${row.name}${suffix}`,
										inner,
									),
								);
								body.push(
									truncateToWidth(
										selected && askDelete
											? theme.fg("error", "   删除文件？y 确认 / n 取消")
											: theme.fg("dim", `   ${row.desc}`),
										inner,
									),
								);
							});

							const edge = theme.fg("border", "│");
							const line = (s: string) =>
								`${edge} ${s}${" ".repeat(Math.max(0, inner - visibleWidth(s)))}${edge}`;
							return [
								theme.fg("border", `┌${"─".repeat(inner + 2)}┐`),
								...body.map(line),
								theme.fg("border", `└${"─".repeat(inner + 2)}┘`),
							];
						},
						handleInput(data: string) {
							if (askDelete) {
								if (data === "y" || data === "Y") {
									const row = rows[index];
									if (row) {
										const err = removeEntry(row);
										message = err ? `删除失败: ${err}` : `已删除 ${row.name}，/reload 后彻底生效`;
										refresh(row.name);
									}
									askDelete = false;
								} else if (data === "n" || data === "N" || matchesKey(data, Key.escape)) {
									askDelete = false;
								}
								tui.requestRender();
								return;
							}

							if (rows.length > 0 && matchesKey(data, Key.alt("j"))) {
								index = (index - 1 + rows.length) % rows.length;
							} else if (rows.length > 0 && matchesKey(data, Key.alt("k"))) {
								index = (index + 1) % rows.length;
							} else if ((data === "d" || data === "D") && rows.length > 0) {
								askDelete = true;
							} else if (matchesKey(data, Key.escape)) {
								done(undefined);
								return;
							}
							tui.requestRender();
						},
					};
				},
				{ overlay: true, overlayOptions: { width: WIDTH, maxHeight: "60%", anchor: "center" } },
			);
		} finally {
			opened = false;
		}
	}

	pi.registerCommand("res", {
		description: "资源管理：查看并删除 skill 与扩展",
		handler: async (_args, ctx) => openPanel(ctx),
	});
}
