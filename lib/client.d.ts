
//#region src/client/index.d.ts
/** 客户端所需服务（M1 无需额外服务） */
declare const inject: string[];
declare function apply(ctx: {
  effect(fn: () => (() => void) | void, label?: string): void;
}): void;
//#endregion
export { apply, inject };
