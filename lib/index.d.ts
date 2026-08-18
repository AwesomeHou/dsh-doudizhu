import { Context } from "cordis";
//#region src/index.d.ts
declare const name = "dsh-doudizhu";
/** 本插件需要的主机服务（M1 无额外依赖） */
declare const inject: string[];
declare function apply(ctx: Context): void;
//#endregion
export { apply, inject, name };