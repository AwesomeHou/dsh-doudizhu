
import { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
//#region src/client/index.d.ts
/** 独立工作区只需要客户端运行时挂载能力。 */
declare const inject: string[];
declare function apply(ctx: ClientContext): void;
//#endregion
export { apply, inject };
