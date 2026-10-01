import type { SkillsPanelStore, SkillsScope } from './state.ts';
/**
 * The shared manager body: root tabs (用户级 / 项目级 / Skill 库), the action
 * row, and the list/detail/create views. `scope` is the request scope the
 * body's API calls ride (session id + cwd), supplied by the mounting page.
 */
export declare function SkillsManagerBody(props: {
    store: SkillsPanelStore;
    scope: SkillsScope;
}): import("react").JSX.Element;
