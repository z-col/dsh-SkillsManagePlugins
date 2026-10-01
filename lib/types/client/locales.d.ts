/**
 * Minimal zh/en copy for the skills manager. The copy follows the DSH i18n
 * system: the client apply attaches the locale service (`ctx.locale`) and
 * `t()`/`isZh()` resolve the active locale from it. The dictionaries are
 * also registered into the DSH locale registry under {@link LOCALE_NS}.
 */
export declare const LOCALE_NS = "dsh-skills-manager";
/** The zh dictionary (also registered into the DSH locale registry). */
export declare const zh: {
    panelTitle: string;
    userTab: string;
    projectTab: string;
    libraryTab: string;
    emptyUser: string;
    emptyProject: string;
    libraryEmpty: string;
    libraryCount: string;
    ops: string;
    rename: string;
    delete: string;
    moveToGlobal: string;
    moveToProject: string;
    openFolder: string;
    badgeGlobal: string;
    recycle: string;
    recycleConfirm: string;
    loading: string;
    loadFailed: string;
    back: string;
    edit: string;
    save: string;
    close: string;
    noSession: string;
    deleteConfirm: string;
    renameTo: string;
    namePlaceholder: string;
    cancel: string;
    confirm: string;
    pathOf: string;
    wireError: string;
};
/** The en dictionary (also registered into the DSH locale registry). */
export declare const en: Record<string, string>;
/** The zh/en dictionary pair keyed by locale for the client. */
export declare const dictionaries: {
    zh: {
        panelTitle: string;
        userTab: string;
        projectTab: string;
        libraryTab: string;
        emptyUser: string;
        emptyProject: string;
        libraryEmpty: string;
        libraryCount: string;
        ops: string;
        rename: string;
        delete: string;
        moveToGlobal: string;
        moveToProject: string;
        openFolder: string;
        badgeGlobal: string;
        recycle: string;
        recycleConfirm: string;
        loading: string;
        loadFailed: string;
        back: string;
        edit: string;
        save: string;
        close: string;
        noSession: string;
        deleteConfirm: string;
        renameTo: string;
        namePlaceholder: string;
        cancel: string;
        confirm: string;
        pathOf: string;
        wireError: string;
    };
    en: Record<string, string>;
};
/**
 * Attach (or detach, with undefined) the DSH locale service. Components keep
 * calling the plain `t()` function; the panel subscribes to locale snapshot
 * changes and re-renders on switches.
 */
export declare function attachLocale(service: {
    getSnapshot(): {
        active: string;
    };
} | undefined): void;
/** Translate a copy key in the active locale (zh → zh, else en). */
export type CopyKey = keyof typeof zh;
/** Translate a copy key; `{name}` placeholders interpolate from `params`. */
export declare function t(key: CopyKey, params?: Record<string, string | number>): string;
/** Whether the active locale is Chinese (used for selectors). */
export declare function isZh(): boolean;
/** Resolve the active locale (zh-cn → zh). */
export declare function activeLocaleId(preference: string): 'zh' | 'en';
