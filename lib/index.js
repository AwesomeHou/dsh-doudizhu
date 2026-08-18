//#region src/index.ts
const name = "dsh-doudizhu";
/** 本插件需要的主机服务（M1 无额外依赖） */
const inject = [];
function apply(ctx) {
	const log = ctx.logger("dsh-doudizhu");
	ctx.on("ready", () => {
		log.info("斗地主插件已加载（M1 本地模式）");
	});
}
//#endregion
export { apply, inject, name };
