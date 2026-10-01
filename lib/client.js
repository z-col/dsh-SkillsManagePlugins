window.__ModuleLoader__.load({
	id: "dsh-skills-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/state.ts
		/** Factory: one store instance per plugin activation. */
		function createSkillsPanelStore() {
			let state = {
				root: "user",
				view: "list",
				selectedName: ""
			};
			const listeners = /* @__PURE__ */ new Set();
			const emit = () => {
				for (const listener of listeners) listener();
			};
			const set = (patch) => {
				state = {
					...state,
					...patch
				};
				emit();
			};
			return {
				getSnapshot: () => state,
				subscribe(fn) {
					listeners.add(fn);
					return () => {
						listeners.delete(fn);
					};
				},
				actions: {
					switchRoot(root) {
						set({
							root,
							view: "list",
							selectedName: ""
						});
					},
					showList() {
						set({
							view: "list",
							selectedName: ""
						});
					},
					showDetail(name) {
						set({
							view: "detail",
							selectedName: name
						});
					}
				}
			};
		}
		//#endregion
		//#region src/client/api.ts
		/**
		* Typed fetch wrapper over the /skills JSON API. Every call posts to
		* `/skills/api/<method>` with the sessionId and — when known — the session's
		* cwd from the client's own list summary. Failures surface as
		* {@link SkillsApiError} with the wire code.
		*/
		/** One wire failure. */
		var SkillsApiError = class extends Error {
			code;
			constructor(code, message) {
				super(message);
				this.code = code;
			}
		};
		/** Fold a scope into a JSON payload ({cwd} only when present). */
		function scopePayload(scope, extra) {
			return {
				sessionId: scope.sessionId,
				...scope.cwd !== void 0 && scope.cwd !== "" ? { cwd: scope.cwd } : {},
				...extra
			};
		}
		async function call(method, payload, signal) {
			let response;
			try {
				response = await fetch(`/skills/api/${method}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payload),
					signal
				});
			} catch (error) {
				throw new SkillsApiError("network", error instanceof Error ? error.message : String(error));
			}
			const parsed = await response.json().catch(() => null);
			if (!response.ok || parsed === null || parsed.ok !== true || parsed.value === void 0) throw new SkillsApiError(parsed?.error?.code ?? "http", parsed?.error?.message ?? `HTTP ${response.status}`);
			return parsed.value;
		}
		/** The skills API surface (session scope threaded through every call). */
		const api = {
			rootsInfo: (scope, signal) => call("roots.info", scopePayload(scope, {}), signal),
			/** List one level root (user or project). */
			list: (scope, root, signal) => call("skills.list", scopePayload(scope, { root }), signal),
			/** Read one skill from a level root or the library canonical. */
			get: (scope, root, name, signal) => call("skills.get", scopePayload(scope, {
				root,
				name
			}), signal),
			/** Replace the content of a skill (level copy or library canonical). */
			update: (scope, root, name, content) => call("skills.update", scopePayload(scope, {
				root,
				name,
				content
			})),
			/** Delete a skill everywhere (library canonical + all level copies). */
			delete: (scope, name) => call("skills.delete", scopePayload(scope, { name })),
			/** Rename a skill everywhere (library canonical + all level copies). */
			rename: (scope, name, newName) => call("skills.rename", scopePayload(scope, {
				name,
				newName
			})),
			/** Recycle a skill from one level (remove that copy only). */
			recycle: (scope, root, name) => call("skills.recycle", scopePayload(scope, {
				root,
				name
			})),
			/** List the library (canonical skills + assignments + indexed projects). */
			libraryList: (scope, signal) => call("skills.library.list", scopePayload(scope, {}), signal),
			/** 移至 a library skill to the user/global level or the current project
			*  (copy the canonical; an existing copy is overwritten). */
			libraryAssign: (scope, name, to) => call("skills.library.assign", scopePayload(scope, {
				name,
				to
			})),
			/** Open the selected level's folder in the OS file manager. */
			openFolder: (scope, root) => call("skills.openFolder", scopePayload(scope, { root }))
		};
		//#endregion
		//#region src/client/locales.ts
		/**
		* Minimal zh/en copy for the skills manager. The copy follows the DSH i18n
		* system: the client apply attaches the locale service (`ctx.locale`) and
		* `t()`/`isZh()` resolve the active locale from it. The dictionaries are
		* also registered into the DSH locale registry under {@link LOCALE_NS}.
		*/
		const LOCALE_NS = "dsh-skills-manager";
		/** The zh dictionary (also registered into the DSH locale registry). */
		const zh = {
			panelTitle: "Skills 管理器",
			userTab: "全局",
			projectTab: "项目级",
			libraryTab: "Skill 库",
			emptyUser: "全局还没有任何 skill",
			emptyProject: "该项目还没有任何 skill",
			libraryEmpty: "Skill 库还没有任何 skill",
			libraryCount: "共 {count} 个 skill",
			ops: "操作",
			rename: "重命名",
			delete: "删除",
			moveToGlobal: "移至全局",
			moveToProject: "移至项目级",
			openFolder: "打开文件夹",
			badgeGlobal: "全局",
			recycle: "回收",
			recycleConfirm: "仅从当前层级移除该 skill（Skill 库与其它分配位置不受影响）。确定？",
			loading: "加载中…",
			loadFailed: "加载失败",
			back: "返回",
			edit: "编辑",
			save: "保存",
			close: "关闭",
			noSession: "暂无会话，请先打开一个会话",
			deleteConfirm: "将同时删除 Skill 库原件和所有分配副本（全局、各项目），不可恢复。确定？",
			renameTo: "重命名为：",
			namePlaceholder: "kebab-case，例如 my-skill",
			cancel: "取消",
			confirm: "确认",
			pathOf: "路径",
			wireError: "请求失败"
		};
		/** The en dictionary (also registered into the DSH locale registry). */
		const en = {
			panelTitle: "Skills Manager",
			userTab: "Global",
			projectTab: "Project",
			libraryTab: "Skill Library",
			emptyUser: "No global skills yet",
			emptyProject: "No project skills yet",
			libraryEmpty: "The skill library is empty",
			libraryCount: "{count} skills",
			ops: "Actions",
			rename: "Rename",
			delete: "Delete",
			moveToGlobal: "Move to global",
			moveToProject: "Move to project",
			openFolder: "Open folder",
			badgeGlobal: "Global",
			recycle: "Recycle",
			recycleConfirm: "Remove this skill from the current level only (the library and other assignments stay). Sure?",
			loading: "Loading…",
			loadFailed: "Load failed",
			back: "Back",
			edit: "Edit",
			save: "Save",
			close: "Close",
			noSession: "No active session — open a conversation first",
			deleteConfirm: "Delete this skill everywhere (library canonical + all assigned levels)? This cannot be undone.",
			renameTo: "Rename to:",
			namePlaceholder: "kebab-case, e.g. my-skill",
			cancel: "Cancel",
			confirm: "Confirm",
			pathOf: "Path",
			wireError: "Request failed"
		};
		/** The DSH locale service attached by the client apply (absent → browser detection). */
		let localeService;
		/**
		* Attach (or detach, with undefined) the DSH locale service. Components keep
		* calling the plain `t()` function; the panel subscribes to locale snapshot
		* changes and re-renders on switches.
		*/
		function attachLocale(service) {
			localeService = service;
		}
		/** The active locale id ('zh' | 'en'): the DSH locale service's snapshot when
		*  attached, else the browser language. */
		function activeLocale() {
			return localeService?.getSnapshot().active ?? (typeof navigator !== "undefined" ? navigator.language : "") ?? "en";
		}
		/** Translate a copy key; `{name}` placeholders interpolate from `params`. */
		function t(key, params) {
			let text = (activeLocale().toLowerCase().startsWith("zh") ? zh : en)[key];
			if (params !== void 0) for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value));
			return text;
		}
		//#endregion
		//#region \0dsh-css:/Users/zcol/Project/SkillsManagePlugins/src/client/SkillsPanel.module.css.mjs
		const css = "._3Ocfeq_viewRoot{box-sizing:border-box;flex-direction:column;flex:1;align-items:center;height:100%;min-height:0;display:flex;overflow:hidden}._3Ocfeq_viewInner{flex-direction:column;flex:1;width:100%;max-width:880px;min-height:0;padding:0 24px;display:flex}._3Ocfeq_toolbar{flex:none;justify-content:space-between;align-items:center;gap:8px;padding:8px 14px 0;display:flex}._3Ocfeq_tabs{gap:6px;min-width:0;display:flex}._3Ocfeq_actions{flex:none;align-items:center;gap:8px;margin-left:auto;display:flex}._3Ocfeq_iconButton{border:1px solid var(--dsw-alias-border-l2,#0000001a);width:26px;height:26px;color:var(--dsw-alias-label-secondary,#555);cursor:pointer;background:0 0;border-radius:8px;justify-content:center;align-items:center;padding:0;display:inline-flex}._3Ocfeq_iconButton:hover{background:var(--dsw-alias-interactive-bg-hover,#0000000d)}._3Ocfeq_iconButton:disabled{opacity:.5;cursor:default}._3Ocfeq_tab{border:1px solid var(--dsw-alias-border-l2,#0000001a);color:var(--dsw-alias-label-secondary,#555);cursor:pointer;background:0 0;border-radius:999px;padding:5px 12px;font-size:12px;line-height:18px}._3Ocfeq_tabActive{background:var(--dsw-alias-button-primary-fill,#1664ff);border-color:var(--dsw-alias-button-primary-fill,#1664ff);color:var(--dsw-alias-label-primary-inverted,#fff)}._3Ocfeq_primaryButton{background:var(--dsw-alias-button-primary-fill,#1664ff);color:var(--dsw-alias-label-primary-inverted,#fff);cursor:pointer;border:none;border-radius:8px;align-items:center;gap:6px;padding:5px 12px;font-size:12px;line-height:18px;display:inline-flex}._3Ocfeq_primaryButton:hover{background:var(--dsw-alias-button-primary-hover,#0d53d9)}._3Ocfeq_ghostButton{border:1px solid var(--dsw-alias-border-l2,#0000001a);color:var(--dsw-alias-label-secondary,#555);cursor:pointer;background:0 0;border-radius:8px;align-items:center;gap:6px;padding:5px 10px;font-size:12px;line-height:18px;display:inline-flex}._3Ocfeq_ghostButton:hover{background:var(--dsw-alias-interactive-bg-hover,#0000000d)}._3Ocfeq_dangerButton{border-color:var(--dsw-alias-state-error-primary,#d93838);color:var(--dsw-alias-state-error-primary,#d93838)}._3Ocfeq_dangerButton:hover{background:var(--dsw-alias-state-error-primary,#d93838);color:var(--dsw-alias-label-primary-inverted,#fff)}._3Ocfeq_body{flex:1;min-height:0;padding:4px 14px 16px;overflow-y:auto}._3Ocfeq_status{text-align:center;color:var(--dsw-alias-label-tertiary,#888);padding:24px 0;font-size:13px}._3Ocfeq_error{border:1px solid var(--dsw-alias-state-error-primary,#d93838);color:var(--dsw-alias-state-error-primary,#d93838);white-space:pre-wrap;word-break:break-all;border-radius:8px;margin:8px 0;padding:12px;font-size:12px;line-height:18px}._3Ocfeq_skillList{flex-direction:column;gap:8px;display:flex}._3Ocfeq_skillCard{border:1px solid var(--dsw-alias-border-l2,#0000001a);background:var(--dsw-alias-bg-layer-2,#fff);text-align:left;border-radius:10px;align-items:flex-start;gap:8px;padding:10px 12px;display:flex;position:relative}._3Ocfeq_skillCard:hover,._3Ocfeq_skillCardActive{background:var(--dsw-alias-interactive-bg-hover-accent,#1664ff0f)}._3Ocfeq_skillCardMain{cursor:pointer;text-align:left;background:0 0;border:none;flex-direction:column;flex:1;gap:2px;min-width:0;padding:0;display:flex}._3Ocfeq_skillName{color:var(--dsw-alias-label-primary,#1a1a1a);text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;line-height:20px;overflow:hidden}._3Ocfeq_skillNameRow{align-items:center;gap:6px;min-width:0;display:flex}._3Ocfeq_skillNameRow ._3Ocfeq_skillName{min-width:0}._3Ocfeq_badgeGlobal{background:var(--dsw-alias-button-primary-fill,#1664ff);color:var(--dsw-alias-label-primary-inverted,#fff);white-space:nowrap;border-radius:999px;flex:none;align-items:center;padding:0 8px;font-size:10px;font-weight:500;line-height:16px;display:inline-flex}._3Ocfeq_skillDesc{color:var(--dsw-alias-label-secondary,#555);text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;overflow:hidden}._3Ocfeq_libraryWrap{flex-direction:column;gap:8px;display:flex}._3Ocfeq_libraryHeader{padding:2px 2px 0}._3Ocfeq_libraryCount{color:var(--dsw-alias-label-tertiary,#888);font-size:12px;line-height:18px}._3Ocfeq_opsButton{border:1px solid var(--dsw-alias-border-l2,#0000001a);background:var(--dsw-alias-interactive-bg-active,#0000000f);color:var(--dsw-alias-label-secondary,#555);cursor:pointer;border-radius:999px;flex:none;padding:2px 10px;font-size:11px;line-height:16px}._3Ocfeq_opsButton:hover,._3Ocfeq_opsButtonActive{background:var(--dsw-alias-button-primary-fill,#1664ff);border-color:var(--dsw-alias-button-primary-fill,#1664ff);color:var(--dsw-alias-label-primary-inverted,#fff)}._3Ocfeq_cardMenu{z-index:50;border:1px solid var(--dsw-alias-border-l2,#0000001a);background:var(--dsw-alias-bg-layer-2,#fff);border-radius:10px;flex-direction:column;gap:2px;min-width:140px;padding:4px;display:flex;position:absolute;top:calc(100% - 4px);right:8px;box-shadow:0 6px 20px #00000024}._3Ocfeq_menuItem{text-align:left;color:var(--dsw-alias-label-primary,#1a1a1a);cursor:pointer;background:0 0;border:none;border-radius:6px;padding:7px 10px;font-size:12px;line-height:18px}._3Ocfeq_menuItem:hover{background:var(--dsw-alias-interactive-bg-hover,#0000000d)}._3Ocfeq_menuItem:disabled{opacity:.55;cursor:default}._3Ocfeq_menuDanger{color:var(--dsw-alias-state-error-primary,#d93838)}._3Ocfeq_menuLabel{color:var(--dsw-alias-label-secondary,#555);padding:2px 4px 0;font-size:11px;font-weight:600;line-height:16px}._3Ocfeq_menuInput{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,#0000001a);background:var(--dsw-alias-bg-layer-2,#fff);width:100%;color:var(--dsw-alias-label-primary,#1a1a1a);border-radius:6px;outline:none;padding:6px 8px;font-size:12px;line-height:18px}._3Ocfeq_menuInput:focus{border-color:var(--dsw-alias-brand-primary,#1664ff)}._3Ocfeq_menuActions{gap:6px;padding:2px 4px 4px;display:flex}._3Ocfeq_menuText{color:var(--dsw-alias-label-primary,#1a1a1a);padding:2px 4px;font-size:12px;line-height:18px}._3Ocfeq_menuError{color:var(--dsw-alias-state-error-primary,#d93838);word-break:break-all;padding:4px 4px 2px;font-size:11px;line-height:16px}._3Ocfeq_detail{flex-direction:column;gap:10px;display:flex}._3Ocfeq_detailHeader{align-items:center;gap:8px;display:flex}._3Ocfeq_detailMeta{color:var(--dsw-alias-label-tertiary,#888);word-break:break-all;flex-direction:column;gap:2px;font-size:11px;line-height:16px;display:flex}._3Ocfeq_editor{border:1px solid var(--dsw-alias-border-l2,#0000001a);background:var(--dsw-alias-bg-layer-2,#fff);width:100%;min-height:300px;color:var(--dsw-alias-label-primary,#1a1a1a);resize:vertical;border-radius:8px;outline:none;padding:10px 12px;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}._3Ocfeq_editor:focus{border-color:var(--dsw-alias-brand-primary,#1664ff)}._3Ocfeq_form{flex-direction:column;gap:10px;display:flex}._3Ocfeq_field{flex-direction:column;gap:4px;display:flex}._3Ocfeq_fieldLabel{color:var(--dsw-alias-label-secondary,#555);font-size:12px;font-weight:600;line-height:18px}._3Ocfeq_fieldInput{border:1px solid var(--dsw-alias-border-l2,#0000001a);background:var(--dsw-alias-bg-layer-2,#fff);width:100%;color:var(--dsw-alias-label-primary,#1a1a1a);box-sizing:border-box;border-radius:8px;outline:none;padding:7px 10px;font-size:13px;line-height:20px}._3Ocfeq_fieldInput:focus{border-color:var(--dsw-alias-brand-primary,#1664ff)}._3Ocfeq_fieldError{color:var(--dsw-alias-state-error-primary,#d93838);font-size:12px;line-height:18px}._3Ocfeq_formActions{align-items:center;gap:8px;display:flex}._3Ocfeq_confirmBar{border-top:1px solid var(--dsw-alias-border-l1,#0000000f);align-items:center;gap:8px;padding:10px 14px;display:flex}._3Ocfeq_confirmText{color:var(--dsw-alias-label-primary,#1a1a1a);flex:1;font-size:13px;line-height:20px}";
		const tagId = "dsh-skills-manager/SkillsPanel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-skills-manager";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var SkillsPanel_module_css_default = {
			"field": "_3Ocfeq_field",
			"viewRoot": "_3Ocfeq_viewRoot",
			"fieldInput": "_3Ocfeq_fieldInput",
			"error": "_3Ocfeq_error",
			"skillCardMain": "_3Ocfeq_skillCardMain",
			"formActions": "_3Ocfeq_formActions",
			"menuDanger": "_3Ocfeq_menuDanger",
			"skillNameRow": "_3Ocfeq_skillNameRow",
			"status": "_3Ocfeq_status",
			"opsButton": "_3Ocfeq_opsButton",
			"skillName": "_3Ocfeq_skillName",
			"opsButtonActive": "_3Ocfeq_opsButtonActive",
			"skillDesc": "_3Ocfeq_skillDesc",
			"confirmText": "_3Ocfeq_confirmText",
			"detail": "_3Ocfeq_detail",
			"fieldError": "_3Ocfeq_fieldError",
			"detailMeta": "_3Ocfeq_detailMeta",
			"tab": "_3Ocfeq_tab",
			"primaryButton": "_3Ocfeq_primaryButton",
			"cardMenu": "_3Ocfeq_cardMenu",
			"libraryCount": "_3Ocfeq_libraryCount",
			"iconButton": "_3Ocfeq_iconButton",
			"skillCard": "_3Ocfeq_skillCard",
			"menuActions": "_3Ocfeq_menuActions",
			"ghostButton": "_3Ocfeq_ghostButton",
			"menuText": "_3Ocfeq_menuText",
			"menuError": "_3Ocfeq_menuError",
			"tabs": "_3Ocfeq_tabs",
			"detailHeader": "_3Ocfeq_detailHeader",
			"viewInner": "_3Ocfeq_viewInner",
			"libraryHeader": "_3Ocfeq_libraryHeader",
			"fieldLabel": "_3Ocfeq_fieldLabel",
			"libraryWrap": "_3Ocfeq_libraryWrap",
			"confirmBar": "_3Ocfeq_confirmBar",
			"actions": "_3Ocfeq_actions",
			"dangerButton": "_3Ocfeq_dangerButton",
			"skillList": "_3Ocfeq_skillList",
			"body": "_3Ocfeq_body",
			"menuLabel": "_3Ocfeq_menuLabel",
			"toolbar": "_3Ocfeq_toolbar",
			"skillCardActive": "_3Ocfeq_skillCardActive",
			"badgeGlobal": "_3Ocfeq_badgeGlobal",
			"menuInput": "_3Ocfeq_menuInput",
			"menuItem": "_3Ocfeq_menuItem",
			"editor": "_3Ocfeq_editor",
			"form": "_3Ocfeq_form",
			"tabActive": "_3Ocfeq_tabActive"
		};
		//#endregion
		//#region src/client/SkillsPanel.tsx
		/**
		* The Skills manager views: browse the user-level, project-level, and Skill
		* library surfaces, open a skill's full SKILL.md (raw frontmatter + body),
		* edit and save it, create new skills, and manage assignments.
		*
		* Skill model: the library (<$DSH_HOME>/skill-library) is the canonical home
		* of every skill; the user/project tabs show the COPIES assigned to those
		* levels. Assigning copies a library skill to a level, recycling removes one
		* copy, rename/delete operate everywhere (canonical + all copies), and sync
		* pushes the canonical to every copy.
		*
		* The views are mounted by the conversation-view tab ({@link SkillsView}); the
		* {@link SkillsManagerBody} receives the request scope explicitly so the view
		* supplies the session its tab belongs to.
		*/
		/** Map a wire failure to an inline message. */
		function messageOf(error) {
			if (error instanceof SkillsApiError) return `${t("wireError")}: ${error.message}`;
			return error instanceof Error ? error.message : String(error);
		}
		/**
		* The shared manager body: root tabs (用户级 / 项目级 / Skill 库), the action
		* row, and the list/detail/create views. `scope` is the request scope the
		* body's API calls ride (session id + cwd), supplied by the mounting page.
		*/
		function SkillsManagerBody(props) {
			const { store, scope } = props;
			const state = store.getSnapshot();
			const [, force] = (0, react.useState)(0);
			(0, react.useEffect)(() => store.subscribe(() => force((v) => v + 1)), [store]);
			const sessionId = scope.sessionId;
			const cwd = scope.cwd;
			/** The entries currently shown for a LEVEL root, tagged with its kind. */
			const [loaded, setLoaded] = (0, react.useState)(null);
			/** The library payload (canonical skills + assignments + projects). */
			const [libraryData, setLibraryData] = (0, react.useState)(null);
			const [loading, setLoading] = (0, react.useState)(true);
			const [error, setError] = (0, react.useState)(null);
			const [openingFolder, setOpeningFolder] = (0, react.useState)(false);
			const requestSeq = (0, react.useRef)(0);
			const loadLevel = (0, react.useCallback)(async (root, sessionId0, cwd0) => {
				const seq = ++requestSeq.current;
				setLoading(true);
				setError(null);
				try {
					const next = await api.list({
						sessionId: sessionId0,
						cwd: cwd0
					}, root);
					if (seq !== requestSeq.current) return;
					setLoaded({
						root,
						entries: next
					});
					setLoading(false);
				} catch (cause) {
					if (seq !== requestSeq.current) return;
					setError(messageOf(cause));
					setLoading(false);
				}
			}, []);
			const loadLibrary = (0, react.useCallback)(async (sessionId0, cwd0) => {
				const seq = ++requestSeq.current;
				setLoading(true);
				setError(null);
				try {
					const next = await api.libraryList({
						sessionId: sessionId0,
						cwd: cwd0
					});
					if (seq !== requestSeq.current) return;
					setLibraryData(next);
					setLoading(false);
				} catch (cause) {
					if (seq !== requestSeq.current) return;
					setError(messageOf(cause));
					setLoading(false);
				}
			}, []);
			(0, react.useEffect)(() => {
				if (state.root === "library") loadLibrary(sessionId, cwd);
				else loadLevel(state.root, sessionId, cwd);
			}, [
				state.root,
				sessionId,
				cwd,
				loadLevel,
				loadLibrary
			]);
			const reload = (0, react.useCallback)(() => {
				if (state.root === "library") loadLibrary(sessionId, cwd);
				else loadLevel(state.root, sessionId, cwd);
			}, [
				state.root,
				sessionId,
				cwd,
				loadLevel,
				loadLibrary
			]);
			/** Open the currently selected level's folder in the OS file manager. */
			const openCurrentFolder = (0, react.useCallback)(async () => {
				setOpeningFolder(true);
				setError(null);
				try {
					await api.openFolder({
						sessionId,
						cwd
					}, state.root);
				} catch (cause) {
					setError(messageOf(cause));
				} finally {
					setOpeningFolder(false);
				}
			}, [
				sessionId,
				cwd,
				state.root
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: SkillsPanel_module_css_default.toolbar,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SkillsPanel_module_css_default.tabs,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: `${SkillsPanel_module_css_default.tab} ${state.root === "library" ? SkillsPanel_module_css_default.tabActive : ""}`,
								onClick: () => store.actions.switchRoot("library"),
								children: t("libraryTab")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: `${SkillsPanel_module_css_default.tab} ${state.root === "user" ? SkillsPanel_module_css_default.tabActive : ""}`,
								onClick: () => store.actions.switchRoot("user"),
								children: t("userTab")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: `${SkillsPanel_module_css_default.tab} ${state.root === "project" ? SkillsPanel_module_css_default.tabActive : ""}`,
								onClick: () => store.actions.switchRoot("project"),
								children: t("projectTab")
							})
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SkillsPanel_module_css_default.actions,
						children: [state.view !== "list" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: SkillsPanel_module_css_default.ghostButton,
							onClick: () => store.actions.showList(),
							children: ["← ", t("back")]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: SkillsPanel_module_css_default.iconButton,
							title: t("openFolder"),
							"aria-label": t("openFolder"),
							disabled: openingFolder,
							onClick: () => {
								openCurrentFolder();
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpenRegular, { size: 16 })
						})]
					})]
				}),
				error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: SkillsPanel_module_css_default.error,
					children: error
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: SkillsPanel_module_css_default.body,
					children: [state.view === "list" && (state.root === "library" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LibraryView, {
						data: libraryData,
						loading,
						scope,
						onOpen: (name) => store.actions.showDetail(name),
						onChanged: reload
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ListView, {
						entries: loaded !== null && loaded.root === state.root ? loaded.entries : null,
						loading,
						emptyLabel: state.root === "user" ? t("emptyUser") : t("emptyProject"),
						root: state.root,
						scope,
						onOpen: (name) => store.actions.showDetail(name),
						onChanged: reload
					})), state.view === "detail" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailView, {
						store,
						root: state.root,
						name: state.selectedName,
						scope,
						onChanged: reload
					})]
				})
			] });
		}
		/**
		* The LEVEL list view (用户级 / 项目级): skill cards with a per-card 「操作」
		* menu (rename everywhere / recycle from this level). `entries` is null only
		* while the CURRENT root has never loaded; a refresh keeps the previous
		* entries on screen (no full-panel flash).
		*/
		function ListView(props) {
			const { entries, loading, emptyLabel, root, scope, onOpen, onChanged } = props;
			const [menu, setMenu] = (0, react.useState)(null);
			const [renameValue, setRenameValue] = (0, react.useState)("");
			const [busyName, setBusyName] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const closeMenu = () => {
				setMenu(null);
				setRenameValue("");
				setError(null);
				setBusyName(null);
			};
			(0, react.useEffect)(() => {
				if (menu === null) return;
				const onPointerDown = (event) => {
					const el = event.target;
					if (el !== null && el.closest("[data-skill-card]")) return;
					closeMenu();
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") closeMenu();
				};
				document.addEventListener("pointerdown", onPointerDown);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [menu]);
			const toggleMenu = (name) => {
				if (menu?.name === name && menu.mode === "actions") {
					closeMenu();
					return;
				}
				setRenameValue("");
				setError(null);
				setMenu({
					name,
					mode: "actions"
				});
			};
			const startRename = (name) => {
				setRenameValue(name);
				setError(null);
				setMenu({
					name,
					mode: "rename"
				});
			};
			const doRename = async () => {
				if (menu === null || menu.mode !== "rename") return;
				const name = menu.name;
				const next = renameValue.trim();
				if (next === "" || next === name) {
					closeMenu();
					return;
				}
				setBusyName(name);
				setError(null);
				try {
					await api.rename(scope, name, next);
					closeMenu();
					onChanged();
				} catch (cause) {
					setError(messageOf(cause));
					setBusyName(null);
				}
			};
			const doRecycle = async () => {
				if (menu === null || menu.mode !== "confirm-recycle") return;
				const name = menu.name;
				setBusyName(name);
				setError(null);
				try {
					await api.recycle(scope, root, name);
					closeMenu();
					onChanged();
				} catch (cause) {
					setError(messageOf(cause));
					setBusyName(null);
				}
			};
			if (entries === null) return loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: SkillsPanel_module_css_default.status,
				children: t("loading")
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: SkillsPanel_module_css_default.status,
				children: t("loadFailed")
			});
			if (entries.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: SkillsPanel_module_css_default.status,
				children: emptyLabel
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: SkillsPanel_module_css_default.skillList,
				children: entries.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: `${SkillsPanel_module_css_default.skillCard} ${menu?.name === entry.name ? SkillsPanel_module_css_default.skillCardActive : ""}`,
					"data-skill-card": true,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: SkillsPanel_module_css_default.skillCardMain,
							onClick: () => {
								closeMenu();
								onOpen(entry.name);
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: SkillsPanel_module_css_default.skillName,
								children: entry.name
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: SkillsPanel_module_css_default.skillDesc,
								children: entry.description
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: `${SkillsPanel_module_css_default.opsButton} ${menu?.name === entry.name ? SkillsPanel_module_css_default.opsButtonActive : ""}`,
							"aria-label": t("ops"),
							onClick: (event) => {
								event.stopPropagation();
								toggleMenu(entry.name);
							},
							children: t("ops")
						}),
						menu?.name === entry.name && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: SkillsPanel_module_css_default.cardMenu,
							onClick: (event) => event.stopPropagation(),
							children: [menu.mode === "rename" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
									className: SkillsPanel_module_css_default.menuLabel,
									children: t("renameTo")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: SkillsPanel_module_css_default.menuInput,
									value: renameValue,
									onChange: (e) => setRenameValue(e.target.value),
									placeholder: t("namePlaceholder"),
									disabled: busyName !== null,
									autoFocus: true
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: SkillsPanel_module_css_default.menuActions,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: SkillsPanel_module_css_default.primaryButton,
										disabled: busyName !== null,
										onClick: () => {
											doRename();
										},
										children: busyName !== null ? "…" : t("confirm")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: SkillsPanel_module_css_default.ghostButton,
										disabled: busyName !== null,
										onClick: closeMenu,
										children: t("cancel")
									})]
								})
							] }) : menu.mode === "confirm-recycle" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: SkillsPanel_module_css_default.menuText,
								children: t("recycleConfirm")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: SkillsPanel_module_css_default.menuActions,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: `${SkillsPanel_module_css_default.ghostButton} ${SkillsPanel_module_css_default.dangerButton}`,
									disabled: busyName !== null,
									onClick: () => {
										doRecycle();
									},
									children: busyName !== null ? "…" : t("recycle")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: SkillsPanel_module_css_default.ghostButton,
									disabled: busyName !== null,
									onClick: closeMenu,
									children: t("cancel")
								})]
							})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: SkillsPanel_module_css_default.menuItem,
								disabled: busyName !== null,
								onClick: () => startRename(entry.name),
								children: t("rename")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: `${SkillsPanel_module_css_default.menuItem} ${SkillsPanel_module_css_default.menuDanger}`,
								disabled: busyName !== null,
								onClick: () => setMenu({
									name: entry.name,
									mode: "confirm-recycle"
								}),
								children: t("recycle")
							})] }), error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: SkillsPanel_module_css_default.menuError,
								children: error
							})]
						})
					]
				}, entry.name))
			});
		}
		/**
		* The Skill library view: every canonical skill with a per-card menu —
		* 移至全局 / 移至项目级 / 重命名 / 删除. 移至 copies the canonical into the
		* target level (the library original stays); rename/delete operate
		* everywhere (canonical + all copies). Clicking a card opens its canonical.
		*/
		function LibraryView(props) {
			const { data, loading, scope, onOpen, onChanged } = props;
			const [menu, setMenu] = (0, react.useState)(null);
			const [renameValue, setRenameValue] = (0, react.useState)("");
			const [busyName, setBusyName] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const closeMenu = () => {
				setMenu(null);
				setRenameValue("");
				setError(null);
				setBusyName(null);
			};
			(0, react.useEffect)(() => {
				if (menu === null) return;
				const onPointerDown = (event) => {
					const el = event.target;
					if (el !== null && el.closest("[data-skill-card]")) return;
					closeMenu();
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") closeMenu();
				};
				document.addEventListener("pointerdown", onPointerDown);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [menu]);
			if (data === null) return loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: SkillsPanel_module_css_default.status,
				children: t("loading")
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: SkillsPanel_module_css_default.status,
				children: t("loadFailed")
			});
			const toggleMenu = (name) => {
				if (menu?.name === name && menu.mode === "actions") {
					closeMenu();
					return;
				}
				setRenameValue("");
				setError(null);
				setMenu({
					name,
					mode: "actions"
				});
			};
			/** 移至 a level: copy the canonical there (upsert — an existing copy is
			*  refreshed from the library). */
			const doMoveTo = async (to) => {
				if (menu === null) return;
				const name = menu.name;
				setBusyName(name);
				setError(null);
				try {
					await api.libraryAssign(scope, name, to);
					closeMenu();
					onChanged();
				} catch (cause) {
					setError(messageOf(cause));
					setBusyName(null);
				}
			};
			const startRename = (name) => {
				setRenameValue(name);
				setError(null);
				setMenu({
					name,
					mode: "rename"
				});
			};
			const doRename = async () => {
				if (menu === null || menu.mode !== "rename") return;
				const name = menu.name;
				const next = renameValue.trim();
				if (next === "" || next === name) {
					closeMenu();
					return;
				}
				setBusyName(name);
				setError(null);
				try {
					await api.rename(scope, name, next);
					closeMenu();
					onChanged();
				} catch (cause) {
					setError(messageOf(cause));
					setBusyName(null);
				}
			};
			const doDelete = async () => {
				if (menu === null || menu.mode !== "confirm-delete") return;
				const name = menu.name;
				setBusyName(name);
				setError(null);
				try {
					await api.delete(scope, name);
					closeMenu();
					onChanged();
				} catch (cause) {
					setError(messageOf(cause));
					setBusyName(null);
				}
			};
			if (data.skills.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: SkillsPanel_module_css_default.status,
				children: t("libraryEmpty")
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: SkillsPanel_module_css_default.libraryWrap,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: SkillsPanel_module_css_default.libraryHeader,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: SkillsPanel_module_css_default.libraryCount,
						children: t("libraryCount", { count: data.skills.length })
					})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: SkillsPanel_module_css_default.skillList,
					children: data.skills.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: `${SkillsPanel_module_css_default.skillCard} ${menu?.name === entry.name ? SkillsPanel_module_css_default.skillCardActive : ""}`,
						"data-skill-card": true,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: SkillsPanel_module_css_default.skillCardMain,
								onClick: () => {
									closeMenu();
									onOpen(entry.name);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: SkillsPanel_module_css_default.skillNameRow,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: SkillsPanel_module_css_default.skillName,
										children: entry.name
									}), entry.assignments.includes("user") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: SkillsPanel_module_css_default.badgeGlobal,
										children: t("badgeGlobal")
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: SkillsPanel_module_css_default.skillDesc,
									children: entry.description
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: `${SkillsPanel_module_css_default.opsButton} ${menu?.name === entry.name ? SkillsPanel_module_css_default.opsButtonActive : ""}`,
								"aria-label": t("ops"),
								onClick: (event) => {
									event.stopPropagation();
									toggleMenu(entry.name);
								},
								children: t("ops")
							}),
							menu?.name === entry.name && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: SkillsPanel_module_css_default.cardMenu,
								onClick: (event) => event.stopPropagation(),
								children: [menu.mode === "rename" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										className: SkillsPanel_module_css_default.menuLabel,
										children: t("renameTo")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: SkillsPanel_module_css_default.menuInput,
										value: renameValue,
										onChange: (e) => setRenameValue(e.target.value),
										placeholder: t("namePlaceholder"),
										disabled: busyName !== null,
										autoFocus: true
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: SkillsPanel_module_css_default.menuActions,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: SkillsPanel_module_css_default.primaryButton,
											disabled: busyName !== null,
											onClick: () => {
												doRename();
											},
											children: busyName !== null ? "…" : t("confirm")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: SkillsPanel_module_css_default.ghostButton,
											disabled: busyName !== null,
											onClick: closeMenu,
											children: t("cancel")
										})]
									})
								] }) : menu.mode === "confirm-delete" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: SkillsPanel_module_css_default.menuText,
									children: t("deleteConfirm")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: SkillsPanel_module_css_default.menuActions,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: `${SkillsPanel_module_css_default.ghostButton} ${SkillsPanel_module_css_default.dangerButton}`,
										disabled: busyName !== null,
										onClick: () => {
											doDelete();
										},
										children: busyName !== null ? "…" : t("delete")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: SkillsPanel_module_css_default.ghostButton,
										disabled: busyName !== null,
										onClick: closeMenu,
										children: t("cancel")
									})]
								})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: SkillsPanel_module_css_default.menuItem,
										disabled: busyName !== null,
										onClick: () => {
											doMoveTo("user");
										},
										children: busyName !== null ? "…" : t("moveToGlobal")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: SkillsPanel_module_css_default.menuItem,
										disabled: busyName !== null,
										onClick: () => {
											doMoveTo({ project: data.currentProject });
										},
										children: busyName !== null ? "…" : t("moveToProject")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: SkillsPanel_module_css_default.menuItem,
										disabled: busyName !== null,
										onClick: () => startRename(entry.name),
										children: t("rename")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: `${SkillsPanel_module_css_default.menuItem} ${SkillsPanel_module_css_default.menuDanger}`,
										disabled: busyName !== null,
										onClick: () => setMenu({
											name: entry.name,
											mode: "confirm-delete"
										}),
										children: t("delete")
									})
								] }), error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: SkillsPanel_module_css_default.menuError,
									children: error
								})]
							})
						]
					}, entry.name))
				})]
			});
		}
		/** The detail view: full SKILL.md editor with save / delete / rename. The
		*  root may be a level (user/project) or the library canonical. */
		function DetailView(props) {
			const { store, root, name, scope, onChanged } = props;
			const [file, setFile] = (0, react.useState)(null);
			const [draft, setDraft] = (0, react.useState)("");
			const [loading, setLoading] = (0, react.useState)(true);
			const [error, setError] = (0, react.useState)(null);
			const [saving, setSaving] = (0, react.useState)(false);
			const [deleting, setDeleting] = (0, react.useState)(false);
			const [renaming, setRenaming] = (0, react.useState)(false);
			const [renameTo, setRenameTo] = (0, react.useState)("");
			const [renamingBusy, setRenamingBusy] = (0, react.useState)(false);
			const [confirmDelete, setConfirmDelete] = (0, react.useState)(false);
			const sessionId = scope.sessionId;
			const cwd = scope.cwd;
			(0, react.useEffect)(() => {
				let alive = true;
				setLoading(true);
				setError(null);
				api.get({
					sessionId,
					cwd
				}, root, name).then((next) => {
					if (!alive) return;
					setFile(next);
					setDraft(next.raw);
					setLoading(false);
				}).catch((cause) => {
					if (!alive) return;
					setError(messageOf(cause));
					setLoading(false);
				});
				return () => {
					alive = false;
				};
			}, [
				sessionId,
				cwd,
				root,
				name
			]);
			if (loading) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: SkillsPanel_module_css_default.status,
				children: t("loading")
			});
			if (error !== null || file === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: SkillsPanel_module_css_default.error,
				children: error ?? t("loadFailed")
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: SkillsPanel_module_css_default.ghostButton,
				onClick: () => store.actions.showList(),
				children: ["← ", t("back")]
			})] });
			const save = async () => {
				setSaving(true);
				setError(null);
				try {
					await api.update(scope, root, name, draft);
					setFile({
						...file,
						raw: draft
					});
					setSaving(false);
					onChanged();
				} catch (cause) {
					setError(messageOf(cause));
					setSaving(false);
				}
			};
			const doDelete = async () => {
				setDeleting(true);
				setError(null);
				try {
					await api.delete(scope, name);
					setDeleting(false);
					setConfirmDelete(false);
					store.actions.showList();
					onChanged();
				} catch (cause) {
					setError(messageOf(cause));
					setDeleting(false);
					setConfirmDelete(false);
				}
			};
			const doRename = async () => {
				if (renameTo.trim() === "") return;
				setRenamingBusy(true);
				setError(null);
				try {
					const next = await api.rename(scope, name, renameTo.trim());
					setRenaming(false);
					setRenameTo("");
					setRenamingBusy(false);
					store.actions.showDetail(next.name);
					onChanged();
				} catch (cause) {
					setError(messageOf(cause));
					setRenamingBusy(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: SkillsPanel_module_css_default.detail,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SkillsPanel_module_css_default.detailHeader,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: SkillsPanel_module_css_default.skillName,
								children: file.name
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: SkillsPanel_module_css_default.ghostButton,
								onClick: () => setRenaming((v) => !v),
								children: t("rename")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: `${SkillsPanel_module_css_default.ghostButton} ${SkillsPanel_module_css_default.dangerButton}`,
								onClick: () => setConfirmDelete(true),
								children: t("delete")
							})
						]
					}),
					renaming && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SkillsPanel_module_css_default.form,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: SkillsPanel_module_css_default.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
								className: SkillsPanel_module_css_default.fieldLabel,
								children: t("renameTo")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: SkillsPanel_module_css_default.fieldInput,
								value: renameTo,
								onChange: (e) => setRenameTo(e.target.value),
								placeholder: t("namePlaceholder"),
								disabled: renamingBusy
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: SkillsPanel_module_css_default.formActions,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: SkillsPanel_module_css_default.primaryButton,
								disabled: renamingBusy,
								onClick: () => {
									doRename();
								},
								children: t("confirm")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: SkillsPanel_module_css_default.ghostButton,
								onClick: () => setRenaming(false),
								children: t("cancel")
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: SkillsPanel_module_css_default.detailMeta,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							t("pathOf"),
							": ",
							file.path
						] })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						className: SkillsPanel_module_css_default.editor,
						value: draft,
						onChange: (e) => setDraft(e.target.value),
						spellCheck: false,
						"aria-label": t("edit")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: SkillsPanel_module_css_default.formActions,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: SkillsPanel_module_css_default.primaryButton,
							disabled: saving,
							onClick: () => {
								save();
							},
							children: saving ? "…" : t("save")
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						open: confirmDelete,
						onClose: () => setConfirmDelete(false),
						title: t("delete"),
						headless: true,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: SkillsPanel_module_css_default.confirmBar,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: SkillsPanel_module_css_default.confirmText,
									children: t("deleteConfirm")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: SkillsPanel_module_css_default.ghostButton,
									onClick: () => setConfirmDelete(false),
									children: t("cancel")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: `${SkillsPanel_module_css_default.ghostButton} ${SkillsPanel_module_css_default.dangerButton}`,
									disabled: deleting,
									onClick: () => {
										doDelete();
									},
									children: deleting ? "…" : t("delete")
								})
							]
						})
					})
				]
			});
		}
		//#endregion
		//#region src/client/SkillsView.tsx
		/**
		* The Skills manager as a conversation view tab — the same seat 对话 (chat) and
		* 轨迹 (trajectory) occupy: the tab strip in the session header selects it and
		* the centre column renders the manager body in place of the transcript.
		*
		* The seat is SESSION-scoped, so its `inject` factory hands this component the
		* session it belongs to; the request scope is never guessed from a global
		* "current session" field. (DSH ≤0.1.x carried one at
		* `ctx.sessions.list.getSnapshot().current`; 0.2 removed it, so a panel that
		* reads it renders 「暂无会话」 on every 0.2 client.)
		*/
		/**
		* One session's Skills manager view.
		* @param props - the injected context, manager store, and owning session.
		* @returns the manager body sized to the conversation's view area.
		*/
		function SkillsView(props) {
			const { ctx, store, sessionId } = props;
			const [, force] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				const offSessions = ctx.sessions.list.subscribe(() => force((v) => v + 1));
				const offLocale = ctx.locale.subscribe(() => force((v) => v + 1));
				return () => {
					offSessions();
					offLocale();
				};
			}, [ctx]);
			const scope = {
				sessionId,
				cwd: ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: SkillsPanel_module_css_default.viewRoot,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: SkillsPanel_module_css_default.viewInner,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillsManagerBody, {
						store,
						scope
					})
				})
			});
		}
		//#endregion
		//#region src/client/index.tsx
		/** Services required before mounting (provided by the client runtime). */
		const inject = [
			"slots",
			"locale",
			"sessions"
		];
		/** The view tab id: unique among the session's views (chat, trajectory, …). */
		const SKILLS_VIEW_ID = "skills";
		/** Row order in the view tab strip: chat 0, trajectory 10, skills 20. */
		const SKILLS_VIEW_ORDER = 20;
		/**
		* Client plugin body.
		* @param ctx - the client cordis context (slots / locale / sessions).
		*/
		function apply(ctx) {
			attachLocale(ctx.locale);
			ctx.effect(() => {
				const offZh = ctx.locale.register(LOCALE_NS, "zh", zh);
				const offEn = ctx.locale.register(LOCALE_NS, "en", en);
				return () => {
					offZh();
					offEn();
				};
			}, "dsh-skills-manager: dictionaries");
			const store = createSkillsPanelStore();
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: SKILLS_VIEW_ID,
				order: SKILLS_VIEW_ORDER,
				label: () => t("panelTitle"),
				inject: (sessionId) => ({
					ctx,
					store,
					sessionId
				})
			}, SkillsView));
		}
		//#endregion
		exports.SKILLS_VIEW_ID = SKILLS_VIEW_ID;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map